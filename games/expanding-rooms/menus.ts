import { registerMenuPage } from '../../common/menu-crossbar.js';
import { registerVisorPage } from '../../common/visor-page.js';
import '../../common/visor-menu.js';
import '../../common/desktop-controls.js';
import { generationSettings } from '../impossible-spaces/generation-menu.js';

const game = () => document.querySelector('[impossible-game]')?.components['impossible-game'];
const session = () => game()?.expansion;
const bindings: any[] = [];
function number(group: string, key: string, label: string, value: number, min: number, max: number, step: number, suffix = '') {
  const item = { kind: 'number', id: `expand:${group}:${key}`, label, value, min, max, step, suffix };
  bindings.push({ item, group, key }); return item;
}
function toggle(group: string, key: string, label: string, value: boolean) {
  const item = { kind: 'toggle', id: `expand:${group}:${key}`, label, value };
  bindings.push({ item, group, key }); return item;
}
const action = (id: string, label: string, info?: string) => ({ kind: 'action', id, label, info });
const status = () => [game()?.message, game()?.detail].filter(Boolean).join('\n');
const items = [
  { kind: 'submenu', id: 'boundary-calibration', label: 'Calibrate area',
    info: () => game()?.calibration()?.describe() || '', items: () => game()?.calibration()?.menuItems() || [] },
  { kind: 'submenu', id: 'generate-level', label: 'Generate level', info: status, items: [
    action('generate-current', 'Generate new rooms', 'Original growth, with a new seed. Uses the scale and generation settings below.'),
    { ...number('session', 'scale', 'World scale', 1.25, 1, 2, .05, 'x'),
      info: 'Width and depth multiplier, not area. Applied only when you generate; your real boundary never changes.' },
    { kind: 'submenu', id: 'growth-style', label: 'Original growth settings', items: [
      ...generationSettings.growth, action('generate-growth', 'Generate this seed')
    ] }
  ] },
  { kind: 'submenu', id: 'walking-effects', label: 'Walking effects',
    info: 'Live settings. Effects pause in menus, during calibration and elevator rides. Close the menu to try a setting.', items: [
      toggle('session', 'paused', 'Pause effects', false),
      { kind: 'submenu', id: 'movement-gain', label: 'Movement gain', info: 'Below 0.6 m/s, walking stays 1x. Faster steps ramp toward Max gain.', items: [
        number('gain', 'maxGain', 'Max gain', 1.2, 1, 2, .05, 'x'),
        number('gain', 'speedForMax', 'Full gain at', 2, .8, 4, .1, ' m/s')
      ] },
      { kind: 'submenu', id: 'walking-steering', label: 'Walking steering', info: 'Rotates around the head to improve overlap with the active room. Below 0.6 m/s: no walking steering.', items: [
        toggle('steering', 'steeringEnabled', 'Walking steering', true),
        number('steering', 'maxCurvature', 'Max curve', 5, 0, 20, 1, ' deg/m'),
        number('steering', 'steeringSpeed', 'Full steering at', 2, .8, 4, .1, ' m/s'),
        number('steering', 'maxSteeringRate', 'Rate cap', 6, 1, 30, 1, ' deg/s'),
        number('steering', 'lookAhead', 'Look ahead', 1.5, .5, 3, .1, ' s'),
        number('steering', 'wallMargin', 'Wall margin', .4, .1, 1, .05, ' m')
      ] },
      { kind: 'submenu', id: 'turn-gain', label: 'Turn gain', info: 'Fast head turns gain or lose yaw toward the same overlap goal. Below 30 deg/s: 1x.', items: [
        toggle('steering', 'turnEnabled', 'Turn gain', true),
        number('steering', 'minTurnGain', 'Min turn gain', .9, .5, 1, .05, 'x'),
        number('steering', 'maxTurnGain', 'Max turn gain', 200 / 180, 1, 1.5, .01, 'x'),
        number('steering', 'turnSpeed', 'Full gain at', 180, 60, 360, 10, ' deg/s'),
        number('steering', 'alignmentStrength', 'Response', 1, 0, 1, .05)
      ] }
    ] },
  { kind: 'submenu', id: 'recovery', label: 'Recovery', info: status, items: [
    action('expand-reanchor', 'Re-anchor here', 'Return to a clear spot INSIDE your real boundary first. Remaps this spot to your last valid virtual position; the room and seed stay the same.'),
    action('generate-current', 'Regenerate here', 'Start a new level at your current physical position.'),
    action('outline', 'Show / hide real boundary'),
    action('expand-ride', 'Ride elevator', 'Stand fully inside the cabin, then close the menu to let the doors move.')
  ] },
  { kind: 'submenu', id: 'debug', label: 'Debug', info: () => session()?.describe() || '', items: [
    { kind: 'info', id: 'expand-stats', label: 'Live walking stats', info: () => session()?.describe() || '' },
    action('expand-export', 'Download debug report', 'Save the boundary, level, seed, settings, movement mapping and counters as JSON. Nothing is uploaded.'),
    action('expand-clear-stats', 'Clear counters')
  ] }
];
const page = { title: 'EXPANDING ROOMS', items, info: status, onOpen(component: any) {
  const s = session();
  if (s) for (const { item, group, key } of bindings) item.value = (group === 'session' ? s : s[group])[key];
  game()?.calibration()?.focusCalibration(component);
} };
registerMenuPage('expanding-watch', page);
registerVisorPage('expanding-visor', page);
document.addEventListener('menu-commit', (event: any) => {
  const s = session(), binding = bindings.find(b => b.item.id === event.detail.id);
  if (!s || !binding) return;
  const { group, key } = binding;
  (group === 'session' ? s : s[group])[key] = event.detail.value;
  s.sync();
});
document.addEventListener('menu-action', (event: any) => {
  const s = session(); if (!s) return;
  if (event.detail.id === 'expand-reanchor') s.recover();
  if (event.detail.id === 'expand-ride') game().requestRide(1, true);
  if (event.detail.id === 'expand-export') s.exportReport();
  if (event.detail.id === 'expand-clear-stats' && s.walker) for (const key of Object.keys(s.walker.stats)) s.walker.stats[key] = 0;
});
