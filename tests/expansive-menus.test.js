import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createMenu, findMenuItem } from '../common/menu-model.js';
import { createExperimentPage } from '../games/expansive-spaces/experiment-menu-data.js';

const find = (page, id) => findMenuItem(page.items, id);
const controls = items => items.flatMap(item => item.kind === 'submenu' ? controls(item.items) : ['select', 'toggle'].includes(item.kind) ? [item] : []);
function enter(menu, id) {
  const index = menu.level().items.findIndex(item => item.id === id);
  assert.ok(index >= 0, id); menu.moveFocus(index - menu.level().index); menu.forward();
}

test('every optional experiment keeps an independent first-row on/off switch', () => {
  const page = createExperimentPage(() => ({}));
  for (const id of ['steering', 'turn', 'arm', 'slide', 'jump', 'scope']) {
    const item = find(page, 'space-' + id).items[0];
    assert.equal(item.kind, 'toggle'); assert.equal(item.value, false);
  }
  for (const item of controls(page.items)) if (item.kind === 'select') {
    assert.ok(item.options.some(option => option.value === item.value), item.id);
  }
});

test('saved numeric and boolean settings synchronize into one tree shared by multiple surfaces', () => {
  const state = { worldScale: 2, gain: { maxGain: 1.4 }, redirection: { turnEnabled: true, minTurnGain: .6 },
    motion: { jumpEnabled: true, jumpVerticalGain: 8 }, scope: { enabled: true, zoom: 6 } };
  const page = createExperimentPage(() => state); page.sync();
  for (const [id, value] of [['space-world-scale', 2], ['space-max-gain', 1.4], ['space-turn-enabled', true],
    ['space-turn-min-gain', .6], ['space-jump-height', 8], ['space-scope-zoom', 6]]) assert.equal(find(page, id).value, value);
  const wrist = createMenu(page), visor = createMenu(page); wrist.open(); visor.open();
  wrist.on('commit', ({ item, value }) => { if (item.id === 'space-turn-enabled') state.redirection.turnEnabled = value; });
  enter(wrist, 'space-turn'); wrist.forward(); page.sync();
  enter(visor, 'space-turn'); assert.equal(visor.focusedRow().item.value, false);
});

test('gain choices use the shared select/commit navigation and retain typed values', () => {
  const page = createExperimentPage(() => ({})), menu = createMenu(page), commits = [];
  menu.on('commit', event => commits.push(event)); menu.open();
  enter(menu, 'space-gain'); enter(menu, 'space-max-gain');
  menu.moveFocus(1); menu.forward();
  assert.equal(commits[0].item.id, 'space-max-gain'); assert.equal(commits[0].value, 1.3);
  assert.equal(typeof commits[0].value, 'number');
});

test('all nine room shortcuts fit the same five-row menu window and emit the destination action', () => {
  const page = createExperimentPage(() => ({})), menu = createMenu(page, { windowSize: 5 }), actions = [];
  menu.on('action', event => actions.push(event.id)); menu.open();
  enter(menu, 'space-experiments'); enter(menu, 'space-rooms');
  assert.equal(menu.level().items.length, 9); assert.equal(menu.getWindow().length, 5);
  enter(menu, 'visit-space-elbow-room'); assert.deepEqual(actions, ['visit-space-elbow-room']);
});

test('sidecar summaries read live room and movement telemetry without constructing new rows', () => {
  const state = { room: { status: 'Headset boundary', activeRoom: { name: 'L chamber' } }, telemetry: { turn: 'Overlap 80% -> 95%' } };
  const page = createExperimentPage(() => state), menu = createMenu(page); menu.open();
  assert.match(menu.getInfo().text, /L chamber/); enter(menu, 'space-turn');
  assert.match(menu.getInfo().text, /80% -> 95%/);
  state.telemetry.turn = 'Overlap 95% -> 100%'; assert.match(menu.getInfo().text, /95% -> 100%/);
});

test('the lab uses shared crossbar/visor surfaces with a sidecar map and no legacy page markup', () => {
  const page = readFileSync(new URL('../games/expansive-spaces/index.html', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../games/expansive-spaces/experiment-menus.js', import.meta.url), 'utf8');
  assert.match(page, /watch-crossbar-template/); assert.match(page, /sidecarContentHeight: \.76/);
  assert.match(page, /visor-menu="page: expansive-visor; font: sourcecodepro"/);
  assert.doesNotMatch(page, /menu-option=|menu-item=|menu-chrome-slot|data-menu-page/);
  assert.match(menu, /registerMenuPage\('expansive-watch'/); assert.match(menu, /registerVisorPage\('expansive-visor'/);
});
