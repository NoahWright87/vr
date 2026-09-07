import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5173/primitives/menus/', { waitUntil: 'load' });
await p.waitForFunction(() => document.querySelector('a-scene')?.hasLoaded === true, null, { timeout: 30000 });
await p.waitForTimeout(1800);
const checks = []; const check = (n, pass, d) => checks.push({ n, pass, d });
const st = () => p.evaluate(() => {
  const sys = document.querySelector('a-scene').systems['menu-stick-control'];
  const a = document.querySelector('#crossbar-panel').components['crossbar-menu'];
  const bb = document.querySelector('#crossbar-panel-b').components['crossbar-menu'];
  return {
    locked: sys.lockedMenu ? sys.lockedMenu.el.id : null,
    sceneFlag: document.querySelector('a-scene').getAttribute('data-menu-locked'),
    a: { focus: a.menu.focusedRow()?.label, chrome: a.menu.inChrome(), open: a.menu.isOpen, glow: a.glowEl.object3D.visible, footer: a.footerEl.object3D.visible },
    b: { focus: bb.menu.focusedRow()?.label, chrome: bb.menu.inChrome(), open: bb.menu.isOpen, glow: bb.glowEl.object3D.visible },
    rigPos: document.querySelector('#rig').object3D.position.toArray().map(v => +v.toFixed(2)),
  };
});
const key = async k => { await p.keyboard.press(k); await p.waitForTimeout(90); };

// Walk up to panel A and look at it. Factored out because W/S move the
// player until a menu is entered, so anything that presses them has to
// re-approach afterwards.
const approach = async (id) => {
  await p.evaluate((panelId) => {
    const rig = document.querySelector('#rig');
    const cam = document.querySelector('#showcase-camera');
    cam.setAttribute('look-controls', 'enabled', false);
    rig.setAttribute('semantic-look-controls', 'enabled', false);
    const panel = document.querySelector(panelId);
    const t = new AFRAME.THREE.Vector3(); panel.object3D.getWorldPosition(t);
    const n = new AFRAME.THREE.Vector3(0,0,1).applyQuaternion(panel.object3D.quaternion);
    const stand = t.clone().add(n.multiplyScalar(1.1)); stand.y = 0;
    rig.object3D.position.copy(stand);
    cam.object3D.updateMatrixWorld(true);
    const cw = new AFRAME.THREE.Vector3(); cam.object3D.getWorldPosition(cw);
    const d = t.clone().sub(cw);
    cam.object3D.rotation.order = 'YXZ';
    cam.object3D.rotation.set(Math.atan2(d.y, Math.hypot(d.x,d.z)), Math.atan2(-d.x,-d.z), 0);
  }, id);
  await p.waitForTimeout(700);
};
await approach('#crossbar-panel');

let s0 = await st();
check('nothing is locked before you press anything', s0.locked === null && !s0.a.glow, JSON.stringify(s0.locked));

const prompt = await p.evaluate(() => {
  const sys = document.querySelector('a-scene').systems['menu-stick-control'];
  const m = sys.getPromptedMenu();
  return m ? m.el.id : null;
});
check('standing near panel A offers panel A', prompt === 'crossbar-panel', String(prompt));

// keys do nothing before locking (arrow keys, so this check does not
// walk the player away from the panel it is about to enter)
const beforeA = s0.a.focus;
await key('ArrowDown');
let s = await st();
check('arrow keys do not touch a menu you have not entered', s.a.focus === beforeA, `${beforeA} -> ${s.a.focus}`);

// enter
await key('KeyE');
s = await st();
check('E enters the prompted menu', s.locked === 'crossbar-panel', JSON.stringify(s.locked));
check('the locked panel is visibly lit, with its controls shown', s.a.glow && s.a.footer, JSON.stringify(s.a));
check('the scene flags the lock so movement can stand down', s.sceneFlag === 'true', s.sceneFlag);

// only one menu moves
const bBefore = s.b.focus;
await key('KeyS'); await key('KeyS');
s = await st();
check('W/S move the entered menu', s.a.focus !== beforeA, `${beforeA} -> ${s.a.focus}`);
check('the other panel does not move at all', s.b.focus === bBefore, `${bBefore} -> ${s.b.focus}`);

// movement suspended
const posBefore = s.rigPos;
await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up('KeyW');
s = await st();
check('holding W does not walk you away', JSON.stringify(s.rigPos) === JSON.stringify(posBefore), `${posBefore} -> ${s.rigPos}`);

// the reported bug: left at root
await key('KeyA'); await key('KeyA'); await key('KeyA');
s = await st();
check('left at the root no longer closes the menu', s.a.open === true, JSON.stringify(s.a));
check('left at the root lands on the close button', s.a.chrome === true, JSON.stringify(s.a));

await key('KeyD');
s = await st();
check('right returns to the list without closing', !s.a.chrome && s.a.open, JSON.stringify(s.a));

await key('KeyA');
await key('Enter');
s = await st();
check('confirming the close button closes it', s.a.open === false, JSON.stringify(s.a));
check('closing releases the lock and movement', s.locked === null && s.sceneFlag === 'false', `${s.locked} ${s.sceneFlag}`);

// exiting with E leaves the menu open
await p.evaluate(() => { document.querySelector('#crossbar-panel').components['crossbar-menu'].menu.open(); });
await approach('#crossbar-panel');
await key('KeyE');
s = await st();
check('E enters again after reopening', s.locked === 'crossbar-panel', String(s.locked));
await key('KeyE');
s = await st();
check('E exits without closing the menu', s.locked === null && s.a.open === true, JSON.stringify(s));
check('leaving restores movement', s.sceneFlag === 'false', s.sceneFlag);

// ---------- rendering from data, driven through the lock ----------
await p.evaluate(() => {
  const c = document.querySelector('#crossbar-panel').components['crossbar-menu'];
  c.menu.close(); c.menu.reset(); c.menu.open();
});
await approach('#crossbar-panel');
await key('KeyE');
const read = () => p.evaluate(() => {
  const c = document.querySelector('#crossbar-panel').components['crossbar-menu'];
  return {
    rows: c.rows.filter(r => r.el.object3D.visible).map(r => ({ label: r.textEl.getAttribute('text').value, offset: r.offset, chevron: r.chevronEl.object3D.visible })),
    focus: c.menu.focusedRow()?.label, depth: c.menu.depth(),
    crumbs: c.menu.getBreadcrumbs().map(x => x.title),
    crumbVisible: c.crumbs.filter(x => x.object3D.visible).map(x => x.getAttribute('text').value),
  };
});
let r = await read();
check('rows come from data, wrapped into the window', r.rows.length === 5 && r.focus === 'Spawn box' && r.rows[0].label === 'Comfort', JSON.stringify(r.rows.map(x => x.label)));
check('submenu rows show a chevron', r.rows.find(x => x.label === 'Comfort')?.chevron === true);
check('plain rows do not', r.rows.find(x => x.label === 'Spawn box')?.chevron === false);

await key('KeyS'); r = await read();
check('S moves the focus', r.focus === 'Floor grid: On', r.focus);
await key('Enter'); r = await read();
check('Enter flips a toggle in place', r.focus === 'Floor grid: Off' && r.depth === 0, r.focus);
await key('KeyS'); await key('KeyD'); r = await read();
check('a select drills in and the breadcrumb rail draws', r.depth === 1 && r.crumbVisible[0] === 'Targets', JSON.stringify(r.crumbVisible));
check('a select opens on its current value', r.focus === '6', r.focus);
await key('KeyS'); await key('KeyA'); r = await read();
check('backing out commits into the label', r.focus === 'Targets: 8' && r.depth === 0, r.focus);
await key('KeyS'); await key('KeyD'); r = await read();
check('a number renders as a list of values', r.focus === '1.0x', JSON.stringify(r.rows.map(x => x.label)));
for (let i = 0; i < 3; i++) await key('KeyS');
r = await read();
check('number steps without float drift', r.focus === '1.3x', r.focus);
await key('KeyA'); r = await read();
check('number commits back into its row', r.focus === 'Move speed: 1.3x', r.focus);
await key('KeyS'); await key('KeyD'); r = await read();
check('12 destinations fit a 5-row window, wrapped', r.rows.length === 5 && r.rows[0].label === 'The Farm', JSON.stringify(r.rows.map(x => x.label)));
await key('KeyW'); r = await read();
check('stepping up from the first row lands on the last', r.focus === 'The Stable', r.focus);

// ---------- pointing still works alongside the lock ----------
const pointing = await p.evaluate(() => {
  const c = document.querySelector('#crossbar-panel').components['crossbar-menu'];
  const out = {};
  c.rows.find(x => x.offset === 2 && x.el.object3D.visible).el.emit('click', {}, false);
  out.scrolled = c.menu.focusedRow().label;
  out.depthBefore = c.menu.depth();
  c.rows.find(x => x.offset === 0).el.emit('click', {}, false);
  out.depthAfter = c.menu.depth();
  return out;
});
check('tapping an off-centre row scrolls, never selects', pointing.scrolled === 'The Range', pointing.scrolled);
check('tapping the focused row activates it', pointing.depthAfter === pointing.depthBefore, JSON.stringify(pointing));

// ---------- XR stick engagement ----------
const engage = await p.evaluate(async () => {
  const el = document.querySelector('#crossbar-panel');
  const comp = el.components['crossbar-menu'];
  const sys = el.sceneEl.systems['menu-stick-control'];
  sys.unlock();
  comp.menu.close(); comp.menu.reset(); comp.menu.open();
  el.sceneEl.systems['control-mode'].setMode('xr');
  const out = {};
  await new Promise(r => setTimeout(r, 250));
  out.lockReleasedOnEnteringXr = sys.lockedMenu === null;

  el.setAttribute('crossbar-menu', 'stickRange', 0.01);
  await new Promise(r => setTimeout(r, 250));
  out.outOfRange = { engaged: Boolean(comp.engagedHand), glow: comp.glowEl.object3D.visible };

  el.setAttribute('crossbar-menu', 'stickRange', 50);
  await new Promise(r => setTimeout(r, 350));
  const a = new AFRAME.THREE.Vector3(); const q = new AFRAME.THREE.Vector3();
  el.object3D.getWorldPosition(q);
  const d = {}; sys.hands.forEach(h => { h.el.object3D.getWorldPosition(a); d[h.el.id] = a.distanceTo(q); });
  const nearest = sys.hands.slice().sort((x, y) => d[x.el.id] - d[y.el.id])[0];
  out.nearestId = nearest.el.id;
  out.inRange = {
    engagedIsNearest: comp.engagedHand === nearest.el,
    panelGlow: comp.glowEl.object3D.visible,
    handGlow: Boolean(nearest.glowEl && nearest.glowEl.object3D.visible),
    othersFree: sys.hands.filter(h => h !== nearest).every(h => h.menu !== comp),
  };

  const stepLog = [];
  const orig = comp.step.bind(comp);
  const t0 = performance.now();
  comp.step = (n) => { stepLog.push(Math.round(performance.now() - t0)); orig(n); };
  const before = comp.menu.focusedRow().label;
  nearest.el.emit('axismove', { axis: [0, 0, 0, 0.9] }, false);
  await new Promise(r => setTimeout(r, 800));
  comp.step = orig;
  out.stepped = { before, after: comp.menu.focusedRow().label, log: stepLog.slice() };
  nearest.el.emit('axismove', { axis: [0, 0, 0, 0] }, false);
  await new Promise(r => setTimeout(r, 250));

  // stick X: outward at the root lands on the close button
  const depth0 = comp.menu.depth();
  nearest.el.emit('axismove', { axis: [-0.9, 0, -0.9, 0] }, false);
  await new Promise(r => setTimeout(r, 200));
  out.stickOutwardAtRoot = { chrome: comp.menu.inChrome(), open: comp.menu.isOpen, depth0 };
  nearest.el.emit('axismove', { axis: [0, 0, 0, 0] }, false);
  await new Promise(r => setTimeout(r, 200));

  const watch = nearest.el.components['hand-with-watch'];
  watch.laserActive = true;
  await new Promise(r => setTimeout(r, 250));
  out.pointing = { engaged: comp.engagedHand === nearest.el };
  watch.laserActive = false;
  await new Promise(r => setTimeout(r, 250));
  const semantic = nearest.el.components['semantic-hand'];
  semantic.heldEl = document.createElement('a-entity');
  await new Promise(r => setTimeout(r, 250));
  out.holding = { engaged: comp.engagedHand === nearest.el };
  semantic.heldEl = null;
  el.sceneEl.systems['control-mode'].setMode('desktop');
  return out;
});
check('entering XR releases any flat lock', engage.lockReleasedOnEnteringXr);
check('out of range, the stick stays with the player', !engage.outOfRange.engaged && !engage.outOfRange.glow, JSON.stringify(engage.outOfRange));
check('the nearer hand wins the menu', engage.nearestId === 'left-hand', engage.nearestId);
check('in range, panel and hand both light up', engage.inRange.engagedIsNearest && engage.inRange.panelGlow && engage.inRange.handGlow, JSON.stringify(engage.inRange));
check('only one hand ever drives a menu', engage.inRange.othersFree, JSON.stringify(engage.inRange));
check('the stick steps the focus', engage.stepped.before !== engage.stepped.after, JSON.stringify(engage.stepped));
check('a press steps once, promptly', engage.stepped.log[0] < 200, JSON.stringify(engage.stepped.log));
check('a held stick waits out the repeat delay', engage.stepped.log.length < 2 || engage.stepped.log[1] >= 400, JSON.stringify(engage.stepped.log));
check('stick outward at the root lands on the close button, not out of the menu', engage.stickOutwardAtRoot.chrome && engage.stickOutwardAtRoot.open, JSON.stringify(engage.stickOutwardAtRoot));
check('pointing takes precedence over stick capture', !engage.pointing.engaged, JSON.stringify(engage.pointing));
check('a hand holding something is not a menu hand', !engage.holding.engaged, JSON.stringify(engage.holding));

const legacy = await p.evaluate(() => Boolean(document.querySelector('[menu-item*="spawn-box"]')));
check('the existing panel menu is untouched', legacy);

for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.n}${c.pass ? '' : '  <<< ' + c.d}`);
console.log(`\n${checks.filter(c=>c.pass).length}/${checks.length}`);
if (errs.length) console.log('errors:', errs.slice(0,4));
await b.close();
