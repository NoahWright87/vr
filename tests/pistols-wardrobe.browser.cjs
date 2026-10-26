// Pistols at Dawn wardrobe (phase 01-A), driven through the real code paths:
// real gripdown/gripup/triggerdown events on the hand elements, a real gun's
// raycast at a worn item's hit zone, and a randomized soak (DESIGN.md "Testing
// without a headset"). Optional like the other *.browser.cjs checks:
//
//   npm run build && npm run preview        (serves http://127.0.0.1:4173)
//   VR_PLAYWRIGHT_PATH=/path/to/playwright VR_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     node tests/pistols-wardrobe.browser.cjs
//
// VR_TEST_URL changes the origin, VR_SOAK_FRAMES the soak length.
const { chromium } = require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.VR_TEST_URL || 'http://127.0.0.1:4173';
const soakFrames = Number(process.env.VR_SOAK_FRAMES || 4000);

// Everything below runs in the page. Hands are driven by a pose lock (a hand
// stays where the test put it, the way a tracked controller would), and moved
// in small steps so hand-rig sees a realistic velocity rather than a teleport.
function installHelpers() {
  AFRAME.registerComponent('test-pose-lock', {
    tick: function () {
      const parent = this.el.object3D.parent;
      if (!parent || !this.pos) return;
      parent.updateWorldMatrix(true, false);
      this.el.object3D.position.copy(this.pos);
      parent.worldToLocal(this.el.object3D.position);
      if (this.quat) {
        const pq = new THREE.Quaternion();
        parent.getWorldQuaternion(pq);
        this.el.object3D.quaternion.copy(pq.invert()).multiply(this.quat);
      }
    },
  });

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const frames = async (n) => { for (let i = 0; i < n; i++) await frame(); };
  const until = async (fn, maxFrames = 600) => {
    for (let i = 0; i < maxFrames; i++) { if (fn()) return true; await frame(); }
    return false;
  };
  const hand = (id) => document.querySelector('#' + id);
  const wp = (el) => { const v = new THREE.Vector3(); el.object3D.getWorldPosition(v); return v; };
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

  const T = {
    frame, frames, until, wp, V,
    events: [],
    holster: (el) => el.components.holsterable,
    status: () => { const s = wardrobeStatus(); return { filled: s.filled, total: s.total, slots: s.slots.map((x) => x.type + ':' + (x.item ? 'on' : '-')) }; },
    slot: (type) => wardrobeSlotFor(type),
    worn: (type) => { const s = wardrobeSlotFor(type).components['anchor-slot']; return s.occupants[0] ? s.occupants[0].el : null; },
    // Put a hand somewhere (world space) and keep it there.
    setHand(id, pos, quat) {
      const h = hand(id);
      if (!h.components['test-pose-lock']) h.setAttribute('test-pose-lock', '');
      const c = h.components['test-pose-lock'];
      c.pos = pos.clone();
      if (quat) c.quat = quat.clone();
    },
    // Glide a hand to a place over n frames, then hold still a few frames.
    async moveHand(id, pos, n = 16) {
      const h = hand(id);
      const start = wp(h);
      for (let i = 1; i <= n; i++) {
        T.setHand(id, start.clone().lerp(pos, i / n));
        await frame();
      }
      await frames(6);
    },
    async grip(id) { hand(id).emit('gripdown', {}, false); await frames(3); },
    async ungrip(id) { hand(id).emit('gripup', {}, false); await frames(3); },
    async pull(id) { hand(id).emit('triggerdown', {}, false); await frame(); hand(id).emit('triggerup', {}, false); await frames(2); },
    held: (id) => hand(id).components['hand-rig'].heldObjects.slice(),
    // Point the held gun's muzzle along `dir` so the ray passes through
    // `target`, with the muzzle `dist` metres back along it.
    async aim(id, target, dir, dist = 1) {
      const gun = hand(id).components['hand-rig'].heldObjects[0];
      const muzzle = gun.querySelector('.muzzle');
      const d = dir.clone().normalize();
      for (let i = 0; i < 4; i++) {
        const h = hand(id);
        const c = h.components['test-pose-lock'];
        const hq = new THREE.Quaternion(); h.object3D.getWorldQuaternion(hq);
        const mq = new THREE.Quaternion(); muzzle.object3D.getWorldQuaternion(mq);
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(mq);
        const turn = new THREE.Quaternion().setFromUnitVectors(f, d);
        const newQ = turn.multiply(hq);
        const m = wp(muzzle);
        const want = target.clone().addScaledVector(d, -dist);
        const newPos = wp(h).add(want.sub(m));
        T.setHand(id, newPos, newQ);
        await frames(3);
      }
    },
    async shoot(id) { await T.pull(id); },
    record() {
      const scene = document.querySelector('a-scene');
      ['wardrobe-changed', 'ghost-stripped', 'hat-tipped', 'lifted', 'lift-returned', 'knocked-off'].forEach((n) =>
        scene.addEventListener(n, (e) => {
          const d = e.detail || {};
          T.events.push({
            n, kind: d.kind, slot: d.slot, filled: d.filled, total: d.total,
            item: d.item && d.item.components && d.item.components.wearable && d.item.components.wearable.data.slot,
            shooter: !!d.shooter,
          });
        })
      );
    },
    take() { const e = T.events.slice(); T.events.length = 0; return e; },
    costume: (type) => [...document.querySelectorAll('[wearable]')].filter((e) => e.components.wearable && e.components.wearable.data.slot === type),
    pistolsOnBelt: () => [...document.querySelectorAll('[firearm]')].filter((e) => /^belt-hip/.test((e.components.holsterable.currentSlotEl || {}).id || '')),
  };
  // Skip the actual drawing (software GL is the slow part) but keep the
  // world matrices fresh, since raycasts read them. Every component still ticks.
  const renderer = document.querySelector('a-scene').renderer;
  renderer.render = (scene) => scene.updateMatrixWorld();
  window.T = T;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.VR_CHROMIUM_PATH || undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const errors = [];
  let passed = 0;
  const t0 = Date.now(); const ok = (name) => { passed++; console.log('PASS (' + Math.round((Date.now() - t0) / 1000) + 's) ' + name); };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.goto(base + '/games/pistols-at-dawn/index.html');
    await page.waitForFunction(() => {
      const s = document.querySelector('a-scene');
      return s && s.hasLoaded && window.wardrobeStatus && wardrobeStatus().filled === 4;
    }, null, { timeout: 90000 });
    await page.evaluate(installHelpers);
    await page.evaluate(() => T.record());
    await page.evaluate(() => T.frames(30));
    const ev = (fn, ...args) => page.evaluate(fn, ...args);

    // ---- 0. The rental costume fills every slot, once, quietly --------------
    {
      const s = await ev(() => T.status());
      assert.equal(s.filled, 4);
      assert.equal(s.total, 4);
      assert.deepEqual(await ev(() => T.take()), [], 'dressing at load should not announce anything');
      const zones = await ev(() => {
        const zs = [...document.querySelectorAll('.wardrobe-zone')];
        return {
          n: zs.length,
          shootable: zs.every((z) => z.classList.contains('shootable')),
          radii: [...new Set(zs.map((z) => z.getAttribute('geometry').radius))],
          visible: zs.map((z) => z.object3D.visible),
          bodyShootable: document.querySelectorAll('[boxy-ghost] .shootable, [boxy-ghost].shootable').length,
          wornShootable: ['hat', 'vest', 'belt', 'boots'].map((t) => T.worn(t).classList.contains('shootable')),
          perishable: ['hat', 'vest', 'belt', 'boots'].map((t) => T.worn(t).hasAttribute('perishable')),
        };
      });
      assert.equal(zones.n, 4);
      assert.ok(zones.shootable);
      assert.equal(zones.radii.length, 1, 'one hit-zone size for every slot');
      assert.deepEqual(zones.visible, [true, true, true, true]);
      assert.equal(zones.bodyShootable, 0, 'the ghost body is never shootable');
      assert.deepEqual(zones.wornShootable, [false, false, false, false], 'worn items are not shootable; their zones are');
      assert.deepEqual(zones.perishable, [false, false, false, false], 'costume never perishes');
      ok('rental costume fills all four slots, zones equal-sized, ghost body not shootable');
    }

    // ---- 1. Reaching for a holstered gun no longer grabs the belt -----------
    {
      const r = await ev(async () => {
        const pistol = T.pistolsOnBelt()[0];
        const slotWorld = T.wp(pistol.components.holsterable.currentSlotEl);
        // A hand where the OLD code grabbed the belt: out of the pistol's own reach, inside the belt's.
        const beltPos = T.wp(T.worn('belt'));
        const toBelt = beltPos.clone().sub(slotWorld);
        const near = slotWorld.clone().addScaledVector(toBelt.normalize(), 0.19);
        await T.moveHand('right-hand', near);
        await T.grip('right-hand');
        const afterBeltReach = { held: T.held('right-hand').length, beltWorn: T.worn('belt') !== null };
        await T.ungrip('right-hand');
        // Grip the belt buckle dead centre: nothing comes off.
        await T.moveHand('right-hand', beltPos);
        await T.grip('right-hand');
        const afterBuckle = { held: T.held('right-hand').length, beltWorn: T.worn('belt') !== null };
        await T.ungrip('right-hand');
        // Same for vest and boots.
        const others = [];
        for (const t of ['vest', 'boots']) {
          const piece = T.worn(t);
          await T.moveHand('right-hand', T.wp(piece));
          await T.grip('right-hand');
          // (the vest's own packs are ordinary unlocked slots' contents: grabbing one is fine, the vest itself must stay)
          others.push({ t, held: T.held('right-hand').filter((e) => e === piece).length, worn: T.worn(t) === piece });
          await T.ungrip('right-hand');
        }
        // And now the pistol itself: pose on it, gripdown, it comes out, belt stays.
        await T.moveHand('right-hand', T.wp(pistol));
        await T.grip('right-hand');
        const drawn = T.held('right-hand')[0] === pistol;
        const afterDraw = { drawn, state: pistol.components.holsterable.state, beltWorn: T.worn('belt') !== null, filled: T.status().filled };
        return { afterBeltReach, afterBuckle, others, afterDraw };
      });
      assert.deepEqual(r.afterBeltReach, { held: 0, beltWorn: true });
      assert.deepEqual(r.afterBuckle, { held: 0, beltWorn: true });
      r.others.forEach((o) => { assert.equal(o.held, 0, o.t + ' not grabbable'); assert.ok(o.worn); });
      assert.deepEqual(r.afterDraw, { drawn: true, state: 'held', beltWorn: true, filled: 4 });
      ok('gripdown on a holstered pistol draws it, belt stays worn; grip on belt/vest/boots grabs nothing');
    }

    // ---- 2. The hat tip ------------------------------------------------------
    {
      // Right hand is busy holding the pistol, so tip with the left.
      const r = await ev(async () => {
        const hat = T.worn('hat');
        await T.moveHand('left-hand', T.wp(hat));
        T.take();
        await T.grip('left-hand');
        const lifted = {
          held: T.held('left-hand')[0] === hat,
          events: T.take().map((e) => e.n),
          filledWhileLifted: T.status().filled,
          zoneLive: T.slot('hat').querySelector('.wardrobe-zone').object3D.visible,
        };
        await T.moveHand('left-hand', T.wp(hat).add(new THREE.Vector3(0.6, 0.5, -0.4)));
        const away = T.wp(hat).distanceTo(T.wp(T.slot('hat')));
        // A real flick on release must not throw it either: fast hand, then let go.
        const h = document.querySelector('#left-hand');
        const here = T.wp(h);
        for (let i = 1; i <= 4; i++) { T.setHand('left-hand', here.clone().add(new THREE.Vector3(0, 0.3 * i, 0))); await T.frame(); }
        h.emit('gripup', {}, false);
        await T.frames(40);
        const hs = hat.components.holsterable;
        const back = {
          state: hs.state, slot: hs.currentSlotEl && hs.currentSlotEl.id, liftHome: hs.liftHome,
          wornAgain: T.worn('hat') === hat, filled: T.status().filled,
          dist: +hat.object3D.position.distanceTo(new THREE.Vector3(0.11, 0, 0)).toFixed(3), // the hat's holster pose in the slot's frame
          events: T.take().map((e) => e.n),
        };
        return { lifted, away, back };
      });
      assert.deepEqual(r.lifted.events.slice().sort(), ['hat-tipped', 'lifted']);
      assert.ok(r.lifted.held);
      assert.equal(r.lifted.filledWhileLifted, 4, 'a tipped hat still counts as worn');
      assert.equal(r.lifted.zoneLive, false, 'nothing on the head to hit while the hat is in your hand');
      assert.ok(r.away > 0.4, 'the hat really travelled with the hand');
      assert.equal(r.back.state, 'holstered');
      assert.equal(r.back.slot, 'head-anchor');
      assert.equal(r.back.liftHome, null);
      assert.ok(r.back.wornAgain);
      assert.equal(r.back.filled, 4);
      assert.ok(r.back.dist < 0.01, 'back on the head, not near it');
      assert.deepEqual(r.back.events, ['lift-returned']);
      assert.ok(!r.back.events.includes('wardrobe-changed'), 'a hat tip is not a wardrobe change');
      ok('hat tip: brim lifts with the hand, release (even mid-flick) puts it back on the head, hat-tipped fired');
    }

    // ---- 3. Shoot the hat off with a real gun; put it back -------------------
    {
      const r = await ev(async () => {
        const hat = T.worn('hat');
        const target = T.wp(T.slot('hat'));
        T.take();
        await T.aim('right-hand', target, new THREE.Vector3(0.2, 0, -1), 1.0);
        await T.shoot('right-hand');
        await T.frames(2);
        const ev1 = T.take();
        const hs = hat.components.holsterable;
        return {
          ev1, state: hs.state, slotEmpty: T.slot('hat').components['anchor-slot'].occupants.length === 0,
          status: T.status(), zoneLive: T.slot('hat').querySelector('.wardrobe-zone').object3D.visible,
          loose: hat.classList.contains('shootable'), perishable: hat.hasAttribute('perishable'),
          vel: hs.fallVelocity.toArray().map((n) => +n.toFixed(2)),
        };
      });
      const worn = r.ev1.filter((e) => e.n === 'wardrobe-changed');
      assert.equal(worn.length, 1, JSON.stringify(r.ev1));
      assert.deepEqual([worn[0].kind, worn[0].slot, worn[0].filled, worn[0].total, worn[0].shooter], ['knocked-off', 'hat', 3, 4, true]);
      assert.ok(r.ev1.some((e) => e.n === 'knocked-off'));
      assert.ok(!r.ev1.some((e) => e.n === 'ghost-stripped'));
      assert.ok(r.slotEmpty);
      assert.equal(r.state, 'falling');
      assert.equal(r.zoneLive, false, 'an empty slot has nothing to hit');
      assert.ok(r.loose, 'a loose hat is shootable');
      assert.ok(!r.perishable);
      assert.ok(r.vel[2] < -1, 'it carries the shot direction: ' + r.vel);
      ok('real gun shot at a worn hat: hat loose with the shot velocity, slot empty, wardrobe-changed (3/4)');

      const back = await ev(async () => {
        const hat = T.costume('hat')[0];
        const hs = hat.components.holsterable;
        await T.until(() => hs.state === 'resting', 900);
        const landed = hs.state;
        // Retrieve it with the left hand and put it on the head, by hand.
        await T.moveHand('left-hand', T.wp(hat), 4);
        await T.grip('left-hand');
        const gripped = T.held('left-hand')[0] === hat;
        // Wrong place first: release it at the knees. It must not go on.
        await T.moveHand('left-hand', T.wp(T.slot('boots')).add(new THREE.Vector3(0, 0.1, 0)), 14);
        const headSlot = T.slot('hat').components['anchor-slot'];
        const knee = headSlot.canAccept(hs);
        T.take();
        await T.moveHand('left-hand', T.wp(T.slot('hat')), 20);
        await T.ungrip('left-hand');
        await T.frames(30);
        return {
          landed, gripped, knee, state: hs.state, slot: hs.currentSlotEl && hs.currentSlotEl.id,
          status: T.status(), ev: T.take(), zoneLive: T.slot('hat').querySelector('.wardrobe-zone').object3D.visible,
          loose: hat.classList.contains('shootable'),
        };
      });
      assert.equal(back.landed, 'resting');
      assert.ok(back.gripped);
      assert.equal(back.state, 'holstered');
      assert.equal(back.slot, 'head-anchor');
      assert.equal(back.status.filled, 4);
      assert.deepEqual(back.ev.filter((e) => e.n === 'wardrobe-changed').map((e) => [e.kind, e.slot, e.filled]), [['worn', 'hat', 4]]);
      assert.ok(back.zoneLive);
      assert.ok(!back.loose, 'worn again: not shootable itself');
      ok('picked the hat up and put it back on by hand: count restored to 4/4');
    }

    // ---- 4. Only your own clothes, only the right kind, only on an empty slot -
    {
      const r = await ev(async () => {
        const head = T.slot('hat').components['anchor-slot'];
        const pistol = T.pistolsOnBelt()[0] || document.querySelector('[firearm]');
        // a stranger's hat: built with the same recipe the bar's wardrobe uses, owned by nobody
        const stranger = document.createElement('a-entity');
        stranger.classList.add('grabbable');
        ITEM_MAKERS['hat-tan'].build(stranger, 'back-anchor');
        document.querySelector('a-scene').appendChild(stranger);
        await T.frames(10);
        const hs = stranger.components.holsterable;
        // free the head first so "empty slot" is not the thing being tested
        const hat = T.worn('hat');
        takeOffItem('hat');
        await T.frames(2);
        const out = {
          emptyAfterTakeOff: head.occupants.length === 0,
          pistol: head.canAccept(pistol.components.holsterable),
          stranger: head.canAccept(hs),
          vestOnHead: head.canAccept(T.worn('vest').components.holsterable),
          own: head.canAccept(hat.components.holsterable),
          events: T.take().map((e) => e.kind),
        };
        // put the owned hat back and check a full slot refuses even the owner's twin
        wearItem('hat', hat);
        await T.frames(10);
        out.full = head.canAccept(hs);
        out.filled = T.status().filled;
        stranger.parentNode.removeChild(stranger);
        return out;
      });
      assert.ok(r.emptyAfterTakeOff);
      assert.equal(r.pistol, false, 'a gun cannot be worn as a hat any more');
      assert.equal(r.stranger, false, 'retrieve-own: an item that was never yours is refused');
      assert.equal(r.vestOnHead, false, 'wrong kind');
      assert.equal(r.own, true, 'your own hat goes back on an empty head');
      assert.deepEqual(r.events, ['removed']);
      assert.equal(r.full, false);
      assert.equal(r.filled, 4);
      ok('wardrobeCanWear: empty slot, right kind, own item only (guns, strangers, vests refused)');
    }

    // ---- 5. Knock the belt off: its pistol falls loose -----------------------
    {
      const r = await ev(async () => {
        const belt = T.worn('belt');
        const onBelt = T.pistolsOnBelt();
        const beltPistol = onBelt[0];
        const target = T.wp(T.slot('belt'));
        T.take();
        await T.aim('right-hand', target, new THREE.Vector3(-1, 0.1, -0.4), 1.0);
        await T.shoot('right-hand');
        await T.frames(3);
        const ev1 = T.take();
        const ps = beltPistol.components.holsterable;
        const loose = (ps.state === 'falling' || ps.state === 'resting') && !ps.currentSlotEl;
        await T.until(() => ps.state === 'resting', 600);
        const bs = belt.components.holsterable;
        return {
          ev1, beltState: bs.state, beltSlotEmpty: T.slot('belt').components['anchor-slot'].occupants.length === 0,
          beltPistolsLeft: belt.components.belt.hipSlots.map((s) => s.components['anchor-slot'].occupants.length),
          loose, pistolState: ps.state,
          pistolToWearer: +T.wp(beltPistol).distanceTo(T.wp(T.slot('belt'))).toFixed(2),
          status: T.status(),
        };
      });
      const w = r.ev1.filter((e) => e.n === 'wardrobe-changed');
      assert.deepEqual(w.map((e) => [e.kind, e.slot, e.filled]), [['knocked-off', 'belt', 3]]);
      assert.ok(r.beltSlotEmpty);
      assert.ok(['falling', 'resting'].includes(r.beltState));
      assert.deepEqual(r.beltPistolsLeft, [0, 0], 'nothing left holstered on the knocked-off belt');
      assert.ok(r.loose, 'the holstered pistol came loose');
      assert.equal(r.pistolState, 'resting');
      assert.ok(r.pistolToWearer < 1.5, 'it fell near the wearer: ' + r.pistolToWearer);
      ok('belt shot off: belt flies, its holstered pistol falls loose near the wearer, 3/4');
    }

    // ---- 6. Strip the rest: ghost-stripped exactly once ----------------------
    {
      const r = await ev(async () => {
        T.take();
        const seq = [];
        for (const [type, dir] of [['vest', [0.3, 0, -1]], ['boots', [-0.4, 0.2, -1]]]) {
          await T.aim('right-hand', T.wp(T.slot(type)), new THREE.Vector3(...dir), 1.0);
          await T.shoot('right-hand');
          await T.frames(3);
          seq.push(T.take());
        }
        // A shot through the now-bare chest meets nothing.
        const chest = T.wp(T.slot('vest'));
        const through = castShot(chest.clone().add(new THREE.Vector3(0, 0, -1)), new THREE.Vector3(0, 0, 1), null, 2.5, null);
        return { seq, status: T.status(), through: !!through };
      });
      const vest = r.seq[0].filter((e) => e.n === 'wardrobe-changed');
      const boots = r.seq[1].filter((e) => e.n === 'wardrobe-changed');
      assert.deepEqual(vest.map((e) => [e.kind, e.slot, e.filled]), [['knocked-off', 'vest', 2]]);
      assert.deepEqual(boots.map((e) => [e.kind, e.slot, e.filled]), [['knocked-off', 'boots', 1]], 'boots zone is reachable and hit');
      assert.ok(!r.seq[0].some((e) => e.n === 'ghost-stripped'));
      assert.equal(r.status.filled, 1, 'only the hat is left');
      ok('vest and boots shot off, counts 2/4 then 1/4');
    }
    {
      const r = await ev(async () => {
        T.take();
        await T.aim('right-hand', T.wp(T.slot('hat')), new THREE.Vector3(0, 0.1, -1), 1.0);
        await T.shoot('right-hand');
        await T.frames(3);
        const e = T.take();
        const through = castShot(T.wp(T.slot('vest')).add(new THREE.Vector3(0, 0, -1)), new THREE.Vector3(0, 0, 1), null, 2.5, null);
        return { e, status: T.status(), through: !!through };
      });
      assert.deepEqual(r.e.filter((e) => e.n === 'wardrobe-changed').map((e) => [e.kind, e.slot, e.filled]), [['knocked-off', 'hat', 0]]);
      assert.equal(r.e.filter((e) => e.n === 'ghost-stripped').length, 1, 'ghost-stripped fires once, at zero');
      assert.equal(r.status.filled, 0);
      assert.equal(r.through, false, 'a shot through a bare ghost passes straight through');
      ok('everything knocked off: ghost-stripped fired once; shots pass through the bare ghost');
    }

    // ---- 7. The deliberate path puts the outfit back ---------------------------
    {
      const r = await ev(async () => {
        T.take();
        const items = ['hat', 'vest', 'belt', 'boots'].map((t) => T.costume(t)[0]);
        const results = items.map((el) => wearItem(el.components.wearable.data.slot, el));
        await T.frames(10);
        const wrongKind = wearItem('hat', items[1]);
        return { results, wrongKind, status: T.status(), ev: T.take().filter((e) => e.n === 'wardrobe-changed').map((e) => [e.kind, e.filled]) };
      });
      assert.deepEqual(r.results, [true, true, true, true]);
      assert.equal(r.wrongKind, false);
      assert.equal(r.status.filled, 4);
      assert.deepEqual(r.ev, [['worn', 1], ['worn', 2], ['worn', 3], ['worn', 4]]);
      ok('wearItem (the clothier path) refits every slot; a vest will not go on a head');
    }

    // ---- 8. Soak -----------------------------------------------------------------
    {
      const r = await page.evaluate(async (frames) => {
        // seeded so a failure reproduces
        let seed = Number(window.__soakSeed || 20260719);
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        const pick = (a) => a[Math.floor(rnd() * a.length)];
        const inv = [];
        const problems = [];
        const stats = { grips: 0, ungrips: 0, pulls: 0, shotsAtZones: 0, smashed: 0, blasts: 0, wears: 0, takeoffs: 0, tips: 0 };
        T.take();
        const handIds = ['left-hand', 'right-hand'];
        const types = ['hat', 'vest', 'belt', 'boots'];
        const grabbables = () => [...document.querySelectorAll('.grabbable')].filter((e) => e.components.holsterable);
        const checkInvariants = (i) => {
          grabbables().forEach((e) => {
            const h = e.components.holsterable;
            const p = T.wp(e);
            if (!isFinite(p.x + p.y + p.z)) problems.push(i + ': NaN position on ' + (e.id || e.getAttribute('class')));
          });
          document.querySelectorAll('.anchor-slot').forEach((s) => {
            const c = s.components['anchor-slot'];
            if (!c) return;
            if (c.data.locked && c.occupants.length > 1) problems.push(i + ': locked slot ' + s.id + ' holds ' + c.occupants.length);
            c.occupants.forEach((o) => {
              if (o.currentSlotEl !== s) problems.push(i + ': occupant of ' + s.id + ' thinks it is in ' + (o.currentSlotEl && o.currentSlotEl.id));
              if (o.state !== 'holstered') problems.push(i + ': occupant of ' + s.id + ' is ' + o.state);
            });
          });
          const st = wardrobeStatus();
          const counted = types.filter((t) => T.slot(t).components['anchor-slot'].occupants.length || (T.slot(t).components['anchor-slot'].lifted)).length;
          if (counted !== st.filled) problems.push(i + ': status filled ' + st.filled + ' vs ' + counted);
          document.querySelectorAll('[wearable]').forEach((e) => {
            if (e.hasAttribute('perishable')) problems.push(i + ': costume item is perishable');
            if (!e.isConnected) problems.push(i + ': costume item left the document');
          });
        };
        const describe = (e) => {
          const parts = [];
          let n = e.object3D;
          for (let d = 0; n && d < 8; d++, n = n.parent) {
            const el = n.el;
            parts.push(el ? (el.id || (el.getAttributeNames().filter((a) => !/^(class|position|rotation|scale|visible|geometry|material)$/.test(a)).slice(0, 3).join('+')) || el.tagName) : n.type);
          }
          return parts.join(' <- ');
        };
        const cycle = () => {
          for (const e of grabbables()) {
            let n = e.object3D, depth = 0;
            while (n && depth < 100) { n = n.parent; depth++; }
            if (depth >= 100) return e;
          }
          return null;
        };
        let last = '';
        const recent = [];
        for (let i = 0; i < frames; i++) {
          const r = rnd();
          try {
          const id = pick(handIds);
          const h = document.querySelector('#' + id);
          const objs = grabbables();
          last = id + ' r=' + r.toFixed(3);
          recent.push(last + ' hand:' + (h.components['hand-rig'].heldObjects.map((o) => o.components.wearable ? 'W:' + o.components.wearable.data.slot : (o.getAttributeNames().find((a) => a !== 'class' && a !== 'holsterable') || 'x')).join(',')) + ' status:' + T.status().slots.join(','));
          if (recent.length > 4) recent.shift();
          if (r < 0.22) {
            // reach for something (or somewhere) and grip
            const target = rnd() < 0.7 && objs.length ? T.wp(pick(objs)) : T.wp(T.slot(pick(types))).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.5));
            T.setHand(id, target);
            h.emit('gripdown', {}, false); stats.grips++;
          } else if (r < 0.42) {
            if (rnd() < 0.5) T.setHand(id, T.wp(h).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(0.4)));
            h.emit('gripup', {}, false); stats.ungrips++;
          } else if (r < 0.55) {
            h.emit('triggerdown', {}, false); h.emit('triggerup', {}, false); stats.pulls++;
          } else if (r < 0.7) {
            // shoot a zone the way a bullet would
            const t = pick(types);
            const zone = T.slot(t).querySelector('.wardrobe-zone');
            const dir = new THREE.Vector3(rnd() - 0.5, rnd() * 0.3, rnd() - 0.5).normalize();
            const hit = castShot(T.wp(T.slot(t)).addScaledVector(dir, -1), dir, null, 3, null);
            if (hit) { hit.el.emit('shot', { point: hit.point.clone(), direction: dir.clone(), damage: 1 }, false); stats.shotsAtZones++; }
          } else if (r < 0.78) {
            const t = pick(types);
            const loose = T.costume(t);
            if (loose.length) { if (wearItem(t, pick([...loose]))) stats.wears++; }
          } else if (r < 0.80) {
            if (takeOffItem(pick(types))) stats.takeoffs++;
          } else if (r < 0.88) {
            // the rest of the world, which the costume must survive alongside: pour/ignite/use buttons,
            // smashing whatever is shootable (bottles, targets, loose clothes) and the odd explosion
            const roll = rnd();
            if (roll < 0.4) h.emit(pick(['abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown']), {}, false);
            else if (roll < 0.85) {
              const shootables = [...document.querySelectorAll('.shootable')].filter((e) => e.object3D.visible);
              if (shootables.length) {
                const el = pick(shootables);
                const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
                el.emit('shot', { point: T.wp(el), direction: dir, damage: 1 }, false);
                stats.smashed++;
              }
            } else if (rnd() < 0.3) {
              detonate(T.wp(T.slot(pick(types))).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)), {});
              stats.blasts++;
            }
          } else if (r < 0.9) {
            // hat tip
            const hat = T.worn('hat');
            if (hat) { T.setHand(id, T.wp(hat)); h.emit('gripdown', {}, false); stats.tips++; }
          } else {
            // wander a hand
            T.setHand(id, T.wp(h).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.3)));
          }
          } catch (err) {
            problems.push(i + ': threw in "' + last + '": ' + err.message);
            break;
          }
          await T.frame();
          const bad = cycle();
          if (bad) { problems.push(i + ': scene-graph cycle ' + describe(bad) + ' after "' + last + '" ; recent: ' + recent.join(' | ')); break; }
          if (i % 25 === 0) checkInvariants(i);
        }
        // let the world settle, release everything, and check once more
        if (!problems.length) {
          handIds.forEach((id) => document.querySelector('#' + id).emit('gripup', {}, false));
          for (let i = 0; i < 120 && !problems.length; i++) {
            await T.frame();
            const bad = cycle();
            if (bad) problems.push('settle ' + i + ': scene-graph cycle through ' + (bad.id || bad.getAttribute('class')));
          }
          if (!problems.length) checkInvariants('end');
        }
        const evs = T.take();
        stats.events = evs.length;
        stats.knockedOff = evs.filter((e) => e.n === 'knocked-off').length;
        stats.stripped = evs.filter((e) => e.n === 'ghost-stripped').length;
        stats.status = T.status();
        stats.costume = document.querySelectorAll('[wearable]').length;
        return { problems: problems.slice(0, 10), stats };
      }, soakFrames);
      console.log('soak', JSON.stringify(r.stats));
      assert.deepEqual(r.problems, []);
      assert.ok(r.stats.shotsAtZones > soakFrames / 40, 'the soak actually hit zones');
      assert.ok(r.stats.knockedOff > 0, 'and knocked things off');
      ok('soak: ' + soakFrames + ' frames of random grips, shots, wears and tips; invariants held');
    }

    assert.deepEqual(errors, []);
    console.log('\n' + passed + ' checks passed, no page errors');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
