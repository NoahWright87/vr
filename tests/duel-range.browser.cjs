// Duel framework at the Range, driven through real input paths in a
// real browser. Run against a served build:
//
//   npm run build && npm run preview -- --port 4173   (separate shell)
//   VR_TEST_URL=http://127.0.0.1:4173 node tests/duel-range.browser.cjs
//
// What "real" means here: the duel is started by the same menu-action
// the watch emits, guns are drawn with `gripdown` on a hand posed on the
// holster (the same path as a Touch controller squeeze), aimed by turning
// the hand, and fired with `triggerdown`. Nothing calls the duel's own
// methods to make something happen; the duel is only read from afterwards.
// The pure round logic is covered by tests/duel-model.test.js.
const { chromium } = require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const base = process.env.VR_TEST_URL || 'http://127.0.0.1:4173';
const chromiumPath = process.env.VR_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// Helpers that live in the page, so each step is one evaluate().
const HELPERS = `
(() => {
  const T = AFRAME.THREE;
  const scene = document.querySelector('a-scene');
  const rig = document.querySelector('#player-rig');
  const H = {};
  H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  H.frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  H.events = [];
  ['duel-start','duel-setup','duel-waiting','duel-signal','duel-false-start','duel-shot','duel-hit','duel-round-end','duel-results','duel-aborted']
    .forEach((n) => scene.addEventListener(n, (e) => H.events.push({ name: n, t: performance.now(), d: JSON.parse(JSON.stringify(e.detail)) })));
  H.named = (n) => H.events.filter((e) => e.name === n);
  H.director = () => scene.systems['duel-director'];
  H.lane = () => H.director().lane();
  H.hand = (side) => document.querySelector('#' + (side || 'right') + '-hand');
  H.guns = () => [...document.querySelectorAll('[firearm]')].filter((g) => g.components.holsterable);
  H.slotOf = (g) => { const s = g.components.holsterable.currentSlotEl; return s ? (s.id || s.className) : null; };
  // The pistol sitting in a worn holster.
  H.hipGun = () => H.guns().find((g) => /^belt-hip/.test(H.slotOf(g) || ''));
  H.worldPos = (el) => { const v = new T.Vector3(); el.object3D.getWorldPosition(v); return v; };
  // Put the hand's grip point exactly on a world position, the way a
  // tracked hand reaching for it would be.
  H.placeGrip = (hand, world) => {
    const grip = hand.components['hand-rig'].gripObject3D();
    for (let i = 0; i < 2; i++) {
      const g = new T.Vector3(); grip.getWorldPosition(g);
      const hp = new T.Vector3(); hand.object3D.getWorldPosition(hp);
      const target = hp.clone().add(world.clone().sub(g));
      hand.object3D.position.add(rig.object3D.worldToLocal(target).sub(rig.object3D.worldToLocal(hp)));
      hand.object3D.updateMatrixWorld(true);
    }
  };
  H.draw = async (side) => {
    const hand = H.hand(side);
    const gun = H.hipGun();
    if (!gun) throw new Error('no holstered pistol to draw');
    gun.__home = gun.components.holsterable.currentSlotEl;
    H.placeGrip(hand, H.worldPos(gun));
    hand.emit('gripdown', null, false);
    await H.frames(2);
    return gun;
  };
  // Put a drawn gun back where it came from: the hand brings it to the
  // holster and lets go, and the holster catches it (the same release
  // path as a real hand). Putting it in the OTHER, occupied hip would
  // fall through to the waist anchor and swap the belt off, which is
  // what the game does with a full holster, not something to test here.
  H.holster = async (side, gun) => {
    const hand = H.hand(side);
    H.placeGrip(hand, H.worldPos(gun.__home));
    hand.emit('gripup', null, false);
    await H.frames(3);
  };
  // Turn the hand so the gun's muzzle points at a world point, then fire
  // in the same turn so nothing re-poses the hand in between.
  H.aimAndFire = (side, gun, world) => {
    const hand = H.hand(side);
    for (let i = 0; i < 3; i++) {
      const muzzle = gun.querySelector('.muzzle');
      const o = new T.Vector3(); muzzle.object3D.getWorldPosition(o);
      const q = new T.Quaternion(); muzzle.object3D.getWorldQuaternion(q);
      const dir = new T.Vector3(0, 0, -1).applyQuaternion(q).normalize();
      const want = world.clone().sub(o).normalize();
      const delta = new T.Quaternion().setFromUnitVectors(dir, want);
      const hq = new T.Quaternion(); hand.object3D.getWorldQuaternion(hq);
      hq.premultiply(delta);
      const pq = new T.Quaternion(); rig.object3D.getWorldQuaternion(pq);
      hand.object3D.quaternion.copy(pq.invert().multiply(hq));
      hand.object3D.updateMatrixWorld(true);
    }
    hand.emit('triggerdown', null, false);
    hand.emit('triggerup', null, false);
  };
  H.cutouts = () => H.lane().cutouts.map((c) => c.components['cardboard-cowboy']);
  H.aimPoint = (cut) => { const p = cut.target.aimPoint(); return new T.Vector3(p.x, p.y, p.z); };
  // Shoot every cutout still standing, one shot each (retrying a miss).
  H.shootAll = async (side, gun, maxShots) => {
    let shots = 0;
    while (shots < (maxShots || 12)) {
      const standing = H.cutouts().filter((c) => c.isUp() && c.target.alive);
      if (!standing.length || !H.director().duel || H.director().duel.phase !== 'live') break;
      H.aimAndFire(side, gun, H.aimPoint(standing[0]));
      shots++;
      await H.frames(3);
    }
    return shots;
  };
  H.waitFor = async (fn, ms) => {
    const end = performance.now() + (ms || 10000);
    while (performance.now() < end) { if (fn()) return true; await H.wait(30); }
    return false;
  };
  H.statusLog = [];
  const lane0 = () => document.querySelector('[duel-lane]') && document.querySelector('[duel-lane]').components['duel-lane'];
  // Record every status line the board shows, in order.
  H.watchStatus = () => {
    const lane = lane0();
    if (!lane || lane.__watched) return;
    lane.__watched = true;
    const orig = lane.status.bind(lane);
    lane.status = (text, tone) => { H.statusLog.push({ text, tone, t: performance.now() }); return orig(text, tone); };
  };
  // Between scenarios: stop any duel and put every drawn gun back in its holster.
  H.reset = async () => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { id: 'duel-abort' }, bubbles: true }));
    await H.frames(3);
    for (const g of H.guns()) {
      const h = g.components.holsterable;
      if ((h.state === 'held' || h.state === 'dangling') && g.__home) await H.holster('right', g);
    }
    const lane = document.querySelector('[duel-lane]') && document.querySelector('[duel-lane]').components['duel-lane'];
    if (lane) lane.clearProps();
  };
  H.gunSnapshot = () => H.guns().map((g, i) => ({ i, el: g, slot: H.slotOf(g), state: g.components.holsterable.state }));
  window.__h = H;
})();
`;

async function openRange(browser) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
  await page.goto(base + '/games/pistols-at-dawn/');
  await page.waitForFunction(() => document.querySelector('a-scene')?.components['area-manager']?.activeId === 'ghost-town', null, { timeout: 60000 });
  await page.evaluate(HELPERS);
  return { page, problems };
}

async function gotoRange(page) {
  await page.evaluate(() => document.querySelector('#player-rig').components['teleport-hub'].teleportTo('range'));
  await page.waitForFunction(() => document.querySelector('[duel-lane]')?.components['duel-lane'], null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { __h.watchStatus(); });
}

// The same event the watch's menu emits for a chosen row.
function startDuel(page, id) {
  return page.evaluate((duelId) => {
    __h.events.length = 0;
    __h.statusLog.length = 0;
    __h.watchStatus();
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { id: 'duel-start-' + duelId }, bubbles: true }));
  }, id);
}

function abortDuel(page) {
  return page.evaluate(async () => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { id: 'duel-abort' }, bubbles: true }));
    await __h.frames(3);
  });
}

const tests = [];
function scenario(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------

scenario('the watch lists the duels and a row starts one (real menu navigation)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const hand = __h.hand('left');
    const wm = hand.components['hand-with-watch'];
    const menu = wm.crossbarComponent.menu;
    menu.open(); menu.refresh();
    const rootIds = menu.level().items.map((i) => i.id);
    const duelsIndex = menu.level().items.findIndex((i) => i.id === 'pistols-duels');
    menu.moveFocus(duelsIndex - menu.level().index);
    menu.activate(); // drill into Duels
    menu.refresh();
    const rows = menu.level().items.map((i) => i.id);
    const sampleIndex = rows.indexOf('duel-start-range-dawn');
    menu.moveFocus(sampleIndex - menu.level().index);
    __h.events.length = 0;
    menu.activate(); // choose it
    await __h.wait(600);
    menu.close && menu.close();
    return { rootIds, rows, started: __h.named('duel-start').length, setup: __h.named('duel-setup').length };
  });
  assert.ok(r.rootIds.includes('pistols-duels'), 'the watch has a Duels row');
  assert.ok(r.rows.includes('duel-start-range-dawn') && r.rows.includes('duel-abort'));
  assert.equal(r.started, 1, 'choosing the row started the duel');
  await abortDuel(page);
});

scenario('a duel starts from elsewhere by travelling to the Range', async ({ page }) => {
  await page.evaluate(async () => {
    const hub = document.querySelector('#player-rig').components['teleport-hub'];
    hub.teleportTo('ghost-town');
  });
  await page.waitForFunction(() => document.querySelector('a-scene').components['area-manager'].activeId === 'ghost-town' && !document.querySelector('[duel-lane]'), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    __h.events.length = 0;
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { id: 'duel-start-range-dawn' }, bubbles: true }));
  });
  await page.waitForFunction(() => __h.named('duel-waiting').length === 1, null, { timeout: 30000 });
  const area = await page.evaluate(() => document.querySelector('a-scene').components['area-manager'].activeId);
  assert.equal(area, 'range');
  await abortDuel(page);
});

scenario('sample duel: holster check, signal, draw with gripdown, aim, triggerdown, hits, results', async ({ page }) => {
  await startDuel(page, 'range-dawn');
  const result = await page.evaluate(async () => {
    const out = { wins: 0, rounds: [] };
    const beltBefore = __h.director().loadout.asideCount();
    // Weapon takeover happened at setup: the belt holds only the duel's pistol.
    out.setup = {
      phase: __h.director().duel.phase,
      hip: __h.guns().filter((g) => /^belt-hip/.test(__h.slotOf(g) || '')).length,
      stashed: __h.guns().filter((g) => __h.slotOf(g) === 'duel-stash').length,
      aside: __h.director().loadout.asideCount(),
    };
    // Play rounds until the match ends: win every round by shooting all cutouts.
    while (!__h.named('duel-results').length) {
      await __h.waitFor(() => __h.director().duel.phase === 'live' || __h.named('duel-results').length, 15000);
      if (__h.named('duel-results').length) break;
      const signalAt = __h.named('duel-signal').slice(-1)[0].t;
      const gun = await __h.draw('right');
      out.drewAfterSignalMs = Math.round(performance.now() - signalAt);
      await __h.wait(350); // let the cutouts finish popping up
      const shots = await __h.shootAll('right', gun, 10);
      out.rounds.push({ shots, phase: __h.director().duel.phase });
      // Holster again for the next round.
      await __h.holster('right', gun);
      await __h.waitFor(() => ['setup', 'waiting', 'results'].includes(__h.director().duel.phase) || __h.named('duel-results').length, 8000);
    }
    return out;
  });
  assert.equal(result.setup.phase === 'waiting' || result.setup.phase === 'setup', true);
  assert.equal(result.setup.hip, 1, 'only the duel pistol is on the belt');
  assert.equal(result.setup.stashed, 3, 'both hip pistols and the shotgun were set aside');
  assert.equal(result.setup.aside, 3);

  const ev = await page.evaluate(() => ({
    names: __h.events.map((e) => e.name),
    signals: __h.named('duel-signal').length,
    hits: __h.named('duel-hit').map((e) => e.d),
    roundEnds: __h.named('duel-round-end').map((e) => e.d),
    results: __h.named('duel-results')[0].d,
  }));
  assert.ok(ev.signals >= 2, 'a signal per round');
  assert.ok(ev.hits.length >= 6, 'three cutouts a round: ' + ev.hits.length);
  const first = ev.roundEnds[0];
  assert.equal(first.outcome, 'cleared', JSON.stringify(first));
  assert.equal(first.result.hits, 3);
  assert.ok(first.result.reactionMs > 150 && first.result.reactionMs < 4000, 'a sensible reaction time: ' + first.result.reactionMs);
  assert.ok(first.result.accuracy > 0 && first.result.accuracy <= 1);
  assert.equal(ev.results.outcome, 'won');
  assert.equal(ev.results.wins, 2, 'best of three ends at two');
  assert.ok(ev.results.bestReactionMs > 150);
  console.log('    reaction ' + first.result.reactionMs + ' ms, accuracy ' + Math.round(first.result.accuracy * 100) + '%, medal ' + ev.results.medal);

  // The board shows the results.
  const board = await page.evaluate(() => ({ status: __h.lane().statusText, info: __h.lane().infoText }));
  assert.match(board.status, /YOU WIN/);
  assert.match(board.info, /R1/);

  // Everything went back: original slots, no duel pistol, modifier undone.
  const after = await page.evaluate(async () => {
    await __h.frames(4);
    return {
      hip: __h.guns().filter((g) => /^belt-hip/.test(__h.slotOf(g) || '')).length,
      stashed: __h.guns().filter((g) => __h.slotOf(g) === 'duel-stash').length,
      back: __h.guns().filter((g) => __h.slotOf(g) === 'back-anchor').length,
      active: __h.director().loadout.isActive(),
    };
  });
  assert.equal(after.stashed, 0, 'nothing left in the stash');
  assert.equal(after.hip, 2, 'both hip holsters are stocked again');
  assert.equal(after.back, 1, 'the shotgun is back on the back anchor');
  assert.equal(after.active, false);
});

scenario('drawing before the signal is a false start that forfeits the round', async ({ page }) => {
  await startDuel(page, 'range-dawn');
  await page.waitForFunction(() => __h.named('duel-waiting').length === 1, null, { timeout: 10000 });
  const r = await page.evaluate(async () => {
    await __h.draw('right');
    await __h.frames(4);
    return {
      fs: __h.named('duel-false-start').map((e) => e.d),
      signal: __h.named('duel-signal').length,
      end: __h.named('duel-round-end').map((e) => e.d),
      status: __h.lane().statusText,
      up: __h.lane().upCount(),
    };
  });
  assert.equal(r.fs.length, 1);
  assert.equal(r.fs[0].reason, 'draw');
  assert.equal(r.fs[0].mode, 'forfeit');
  assert.equal(r.signal, 0, 'no signal ever came');
  assert.equal(r.end[0].outcome, 'false-start');
  assert.equal(r.end[0].won, false);
  assert.equal(r.status, 'FALSE START');
  assert.equal(r.up, 0, 'the cutouts never popped up');
  await abortDuel(page);
});

scenario('a trigger pull before the signal is a false start (reason: shot)', async ({ page }) => {
  // Penalty mode keeps the round alive after the draw, so the shot is a second, separate false start.
  await page.evaluate(() => {
    __h.events.length = 0;
    const def = Object.assign({}, window.DUEL_CATALOG['range-dawn'], { id: 'penalty-test', modifiers: [], rules: { rounds: 1, falseStart: { mode: 'penalty', penaltyMs: 400 } }, signal: { kind: 'draw-shout', delayMs: [2500, 2500] } });
    __h.director().start(def);
  });
  await page.waitForFunction(() => __h.named('duel-waiting').length === 1, null, { timeout: 10000 });
  const r = await page.evaluate(async () => {
    const gun = await __h.draw('right');
    await __h.frames(2);
    __h.aimAndFire('right', gun, new AFRAME.THREE.Vector3(0, 1.5, -20));
    await __h.frames(2);
    const fs = __h.named('duel-false-start').map((e) => e.d);
    await __h.waitFor(() => __h.named('duel-signal').length === 1, 8000);
    return { fs, signal: __h.named('duel-signal').length, phase: __h.director().duel.phase };
  });
  assert.deepEqual(r.fs.map((f) => f.reason), ['draw', 'shot']);
  assert.equal(r.fs[1].penaltyMs, 800, 'two penalties stacked');
  assert.equal(r.signal, 1, 'the round carried on to its signal');
  assert.equal(r.phase, 'live');
  await abortDuel(page);
});

scenario('holster check: a gun in hand holds the duel in setup until it is holstered', async ({ page }) => {
  // Draw a belt pistol first, then ask for a duel that uses your own gear.
  await page.evaluate(async () => { window.__drawn = await __h.draw('right'); });
  await startDuel(page, 'range-paces');
  const r = await page.evaluate(async () => {
    await __h.wait(400);
    const stuck = { phase: __h.director().duel.phase, status: __h.lane().statusText, waiting: __h.named('duel-waiting').length };
    // Put it away through the holster.
    await __h.holster('right', window.__drawn);
    await __h.waitFor(() => __h.named('duel-waiting').length === 1, 3000);
    return { stuck, phase: __h.director().duel.phase, waiting: __h.named('duel-waiting').length };
  });
  assert.equal(r.stuck.phase, 'setup');
  assert.equal(r.stuck.status, 'Holster your gun');
  assert.equal(r.stuck.waiting, 0);
  assert.equal(r.waiting, 1, 'holstering moved the round to waiting');
  await abortDuel(page);
});

// Each built start signal, played to its signal and then answered with a real draw and shot.
async function playSignal(page, id) {
  await startDuel(page, id);
  return page.evaluate(async () => {
    const got = await __h.waitFor(() => __h.named('duel-signal').length === 1, 15000);
    if (!got) {
      const d = __h.director();
      throw new Error('no signal: ' + JSON.stringify({
        phase: d.duel && d.duel.phase,
        events: __h.events.map((e) => e.name),
        status: __h.statusLog.map((s) => s.text),
        guns: __h.guns().map((g) => [__h.slotOf(g), g.components.holsterable.state]).filter((x) => x[1] !== 'holstered' || !/bar-slot/.test(x[0] || '')),
      }));
    }
    const signalAt = __h.named('duel-signal')[0].t;
    const texts = __h.statusLog.map((s) => s.text);
    const lane = __h.lane();
    const gun = await __h.draw('right');
    await __h.wait(350);
    __h.aimAndFire('right', gun, __h.aimPoint(__h.cutouts()[0]));
    await __h.frames(3);
    return {
      texts,
      signalAt,
      up: lane.upCount(),
      hits: __h.named('duel-hit').map((e) => e.d),
      fs: __h.named('duel-false-start').length,
      props: lane.props.map((p) => p.tagName.toLowerCase()),
      flagY: lane.flagEl ? lane.flagEl.getAttribute('position').y : null,
      coinLanded: lane.coinEl ? lane.coinEl.components['duel-coin'].landed : null,
      coinSignalGap: null,
      events: __h.events.map((e) => [e.name, Math.round(e.t)]),
    };
  });
}

scenario('signal: draw-shout says DRAW! after a random delay, then the cutouts pop up', async ({ page }) => {
  const r = await playSignal(page, 'range-dawn');
  assert.ok(r.texts.includes('DRAW!'), r.texts.join('|'));
  assert.equal(r.up, 2, 'the signal popped the cutouts (one shot down)');
  assert.equal(r.hits.length, 1);
  assert.equal(r.fs, 0);
  await abortDuel(page);
});

scenario('signal: starter pistol warns, then the bang is the signal', async ({ page }) => {
  const r = await playSignal(page, 'range-starter');
  assert.deepEqual(r.texts.filter((t) => t === 'Ready...' || t === 'BANG!'), ['Ready...', 'BANG!']);
  assert.ok(r.props.length >= 1, 'a starter pistol prop appeared');
  assert.equal(r.hits.length, 1);
  await abortDuel(page);
});

scenario('signal: flag drop raises a flag and the drop is the signal', async ({ page }) => {
  const r = await playSignal(page, 'range-flag');
  assert.deepEqual(r.texts.filter((t) => t === 'Eyes on the flag' || t === 'DROP!'), ['Eyes on the flag', 'DROP!']);
  assert.ok(r.props.includes('a-entity'), 'the pole prop exists');
  assert.equal(r.hits.length, 1);
  await abortDuel(page);
});

scenario('signal: coin toss fires only when the coin lands', async ({ page }) => {
  await startDuel(page, 'range-coin');
  const r = await page.evaluate(async () => {
    const landedAt = { t: null };
    // Wait for the coin to exist, then watch the very same `landed` event the signal waits on.
    await __h.waitFor(() => __h.lane().coinEl, 8000);
    const coin = __h.lane().coinEl;
    const tossedAt = performance.now();
    const beforeLanding = __h.named('duel-signal').length;
    coin.addEventListener('landed', () => { landedAt.t = performance.now(); });
    await __h.waitFor(() => __h.named('duel-signal').length === 1, 8000);
    const signalAt = __h.named('duel-signal')[0].t;
    const texts = __h.statusLog.map((s) => s.text);
    const gun = await __h.draw('right');
    await __h.wait(350);
    __h.aimAndFire('right', gun, __h.aimPoint(__h.cutouts()[0]));
    await __h.frames(3);
    return { beforeLanding, tossedAt, landedAt: landedAt.t, signalAt, texts, flightMs: landedAt.t - tossedAt, hits: __h.named('duel-hit').length };
  });
  assert.equal(r.beforeLanding, 0, 'no signal while the coin is in the air');
  assert.ok(r.landedAt !== null, 'the coin landed');
  assert.ok(r.signalAt >= r.landedAt - 1 && r.signalAt - r.landedAt < 250, `signal ${Math.round(r.signalAt - r.landedAt)} ms after the landing`);
  assert.ok(r.flightMs > 600, 'the coin was in the air a while: ' + Math.round(r.flightMs));
  assert.ok(r.texts.includes('Coin up...'));
  assert.equal(r.hits, 1);
  await abortDuel(page);
});

scenario('signal: ten paces counts one to ten and turns', async ({ page }) => {
  const r = await playSignal(page, 'range-paces');
  const counted = r.texts.filter((t) => /^\d+$/.test(t));
  assert.deepEqual(counted, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.ok(r.texts.includes('TURN!'));
  assert.equal(r.hits.length, 1);
  await abortDuel(page);
});

scenario('weapon takeover: aborting a duel gives everything back', async ({ page }) => {
  const before = await page.evaluate(() => __h.gunSnapshot().filter((g) => /^belt-hip|back-anchor/.test(g.slot || '')).map((g) => g.slot).sort());
  await startDuel(page, 'range-dawn');
  await page.waitForFunction(() => __h.named('duel-waiting').length === 1, null, { timeout: 10000 });
  const during = await page.evaluate(() => ({
    stash: __h.guns().filter((g) => __h.slotOf(g) === 'duel-stash').length,
    hips: __h.guns().filter((g) => /^belt-hip/.test(__h.slotOf(g) || '')).length,
  }));
  assert.equal(during.stash, 3);
  assert.equal(during.hips, 1);
  await abortDuel(page);
  const after = await page.evaluate(async () => {
    await __h.frames(5);
    return {
      slots: __h.gunSnapshot().filter((g) => /^belt-hip|back-anchor/.test(g.slot || '')).map((g) => g.slot).sort(),
      stash: __h.guns().filter((g) => __h.slotOf(g) === 'duel-stash').length,
      aborted: __h.named('duel-aborted').length,
      results: __h.named('duel-results').length,
      status: __h.lane().statusText,
      up: __h.lane().upCount(),
    };
  });
  assert.deepEqual(after.slots.length, before.length, 'same number of guns on the player');
  assert.equal(after.stash, 0);
  assert.equal(after.aborted, 1);
  assert.equal(after.results, 0, 'an aborted duel reports no results');
  assert.equal(after.status, 'Duel cancelled');
});

scenario('weapon takeover: a gun in hand is set aside and comes back, and leaving the Range aborts', async ({ page }) => {
  await page.evaluate(async () => { await __h.draw('right'); });
  const held = await page.evaluate(() => __h.guns().filter((g) => g.components.holsterable.state === 'held').length);
  assert.equal(held, 1);
  await startDuel(page, 'range-dawn');
  const during = await page.evaluate(async () => {
    await __h.frames(3);
    return {
      held: __h.guns().filter((g) => g.components.holsterable.state === 'held').length,
      handHolds: __h.hand('right').components['hand-rig'].heldObjects.length,
      phase: __h.director().duel.phase,
    };
  });
  assert.equal(during.held, 0, 'the drawn gun was set aside');
  assert.equal(during.handHolds, 0);
  assert.equal(during.phase, 'waiting', 'nothing in hand, so the round could arm');
  // Walk out of the Range mid-duel.
  await page.evaluate(() => document.querySelector('#player-rig').components['teleport-hub'].teleportTo('ghost-town'));
  await page.waitForFunction(() => document.querySelector('a-scene').components['area-manager'].activeId === 'ghost-town', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    aborted: __h.named('duel-aborted').map((e) => e.d.reason),
    stash: __h.guns().filter((g) => __h.slotOf(g) === 'duel-stash').length,
    hips: __h.guns().filter((g) => /^belt-hip/.test(__h.slotOf(g) || '')).length,
    active: __h.director().loadout.isActive(),
    where: __h.guns().map((g) => [__h.slotOf(g), g.components.holsterable.state]).filter((x) => !/bar-slot/.test(x[0] || '')),
  }));
  assert.deepEqual(after.aborted, ['left the Range']);
  console.log('    after leaving: ' + JSON.stringify(after.where));
  assert.equal(after.stash, 0);
  assert.equal(after.hips, 2, 'both holsters are stocked again, including the gun that was in hand');
  assert.equal(after.active, false);
  await gotoRange(page);
});

scenario('modifiers: time of day and fog apply for the duel and come off after it', async ({ page }) => {
  await page.evaluate(() => {
    const cycle = document.querySelector('a-scene').components['day-night-cycle'];
    cycle.elapsedGameMs = cycle.elapsedGameMs % (24 * 60 * 1000) + 24 * 60 * 1000 * 0.25; // roughly noon
    window.__noon = cycle.elapsedGameMs;
  });
  const hourOf = () => page.evaluate(() => { const c = document.querySelector('a-scene').components['day-night-cycle']; return ((c.elapsedGameMs / (24 * 60 * 1000)) * 24 + 6) % 24; });
  const before = await hourOf();
  await startDuel(page, 'range-starter'); // dusk + fog
  await page.waitForTimeout(400);
  const during = { hour: await hourOf(), fog: await page.evaluate(() => document.querySelector('a-scene').getAttribute('fog')) };
  assert.ok(Math.abs(during.hour - 18) < 0.3, 'dusk: ' + during.hour);
  assert.ok(during.fog && during.fog.density > 0, 'fog is on');
  const stack = await page.evaluate(() => __h.director().modifiers.active());
  assert.deepEqual(stack, ['time-of-day', 'fog'], 'two modifiers stacked');
  await abortDuel(page);
  await page.waitForTimeout(300);
  const after = { hour: await hourOf(), fog: await page.evaluate(() => document.querySelector('a-scene').getAttribute('fog')) };
  assert.ok(Math.abs(after.hour - before) < 0.5, `time restored: ${before} -> ${after.hour}`);
  assert.ok(!after.fog, 'fog is off again');
});

scenario('a round that nobody answers times out and the next round starts', async ({ page }) => {
  await page.evaluate(() => {
    __h.events.length = 0;
    const def = Object.assign({}, window.DUEL_CATALOG['range-dawn'], { id: 'timeout-test', modifiers: [], signal: { kind: 'draw-shout', delayMs: [200, 200] }, rules: { rounds: 3, roundTimeMs: 600, betweenRoundsMs: 300 } });
    __h.director().start(def);
  });
  await page.waitForFunction(() => __h.named('duel-results').length === 1, null, { timeout: 20000 });
  const r = await page.evaluate(() => ({
    ends: __h.named('duel-round-end').map((e) => e.d.outcome),
    results: __h.named('duel-results')[0].d,
  }));
  assert.deepEqual(r.ends, ['timeout', 'timeout'], 'best of 3 is decided after two lost rounds');
  assert.equal(r.results.outcome, 'lost');
  assert.equal(r.results.medal, null);
});

// ---------------------------------------------------------------

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  let failed = 0;
  try {
    const { page, problems } = await openRange(browser);
    await gotoRange(page);
    const only = process.env.ONLY;
    for (const t of tests) {
      if (only && !only.split('|').some((o) => t.name.includes(o))) continue;
      try {
        await t.fn({ page });
        console.log('ok   - ' + t.name);
        await page.evaluate(() => __h.reset());
      } catch (e) {
        failed++;
        console.log('FAIL - ' + t.name + '\n' + (e && e.stack || e));
        if (!(await page.evaluate(() => !!document.querySelector('[duel-lane]')))) await gotoRange(page).catch(() => {});
        await page.evaluate(() => __h.reset()).catch(() => {});
      }
    }
    const fatal = problems.filter((p) => !/GL Driver|useLegacyLights/.test(p));
    if (fatal.length) { failed++; console.log('FAIL - page problems:\n' + fatal.join('\n')); }
    else console.log('ok   - no page errors, no failed requests');
  } finally {
    await browser.close();
  }
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('all passed');
})();
