// ==============================================================
// DUELS — the director.
//
// An ES module, like menu-pages.js, because the pure round logic it
// drives (duel-model.js) is tested under plain node. It reads the
// legacy scripts' globals through `window`, and only ever once the
// scene is running, by which point every script on the page has loaded.
//
// Persistent, not area-scoped (CLAUDE.md): the director, its catalog and
// the gear swap belong to the page, so a duel can be asked for from the
// watch anywhere. What a duel LOOKS like at the Range (cardboard
// cowboys, the board, the signal props) is `duel-lane` and
// `cardboard-cowboy` in world-targets.js, reached through a small API.
//
//   world (guns, hands, cutouts)  --->  duel-model (rounds, rules)
//   duel-model events             --->  scene events + the lane's board
//
// What it listens to, none of it edited for the purpose:
//   holsterable.state   polled while a duel runs. There is no grab event
//                       to listen to, and the holster is 01-A's: a gun
//                       leaving 'holstered' for 'held'/'dangling' IS the
//                       draw (a gripdown on it goes through grab()).
//   gun-fired           see installGunFiredEvent below.
//   cutout-hit          from cardboard-cowboy.
// What it announces on the scene (non-bubbling, detail per duel-model):
//   duel-start, duel-setup, duel-waiting, duel-signal, duel-false-start,
//   duel-shot, duel-hit, duel-round-end, duel-results, duel-aborted
// ==============================================================

import {
  createDuel,
  normalizeDuel,
  createModifierStack,
  createLoadoutSwap,
  resultsLines,
  roundLine,
  formatMs,
} from './duel-model.js';

var AFRAME = window.AFRAME;
var THREE = AFRAME.THREE;

// ---------- the catalog: duels as data ----------

// Opponent positions are lane space (the Range's origin is where you
// load in, looking down -Z).
var CUTOUTS_NEAR = [{ type: 'cutout', x: -3.2, z: -8 }, { type: 'cutout', x: 3.2, z: -8 }];

export var DUEL_CATALOG = {
  'range-dawn': {
    id: 'range-dawn',
    title: 'Pistols at Dawn at the Range',
    weapon: 'pistol',
    time: 'dawn',
    place: 'the Range',
    signal: { kind: 'draw-shout', delayMs: [1800, 4200] },
    // The third stands off to the side: dead centre is behind the Range's
    // own spinner target.
    opponents: CUTOUTS_NEAR.concat([{ type: 'cutout', x: -6.5, z: -12 }]),
    modifiers: [{ id: 'time-of-day', hour: 6 }],
    rules: { rounds: 3, roundTimeMs: 7000, falseStart: { mode: 'forfeit' } },
  },
  'range-starter': {
    id: 'range-starter',
    title: 'Starter Pistols in the Fog',
    weapon: 'pistol',
    time: 'dusk',
    place: 'the Range',
    signal: { kind: 'starter-pistol', delayMs: [2000, 4000] },
    opponents: CUTOUTS_NEAR,
    modifiers: [{ id: 'time-of-day', hour: 18 }, { id: 'fog', density: 0.035 }],
    rules: { rounds: 1, falseStart: { mode: 'penalty', penaltyMs: 400 } },
  },
  'range-flag': {
    id: 'range-flag',
    title: 'Flag Drop at High Noon',
    weapon: 'pistol',
    time: 'high noon',
    place: 'the Range',
    signal: { kind: 'flag-drop', delayMs: [2000, 4000] },
    opponents: CUTOUTS_NEAR,
    modifiers: [{ id: 'time-of-day', hour: 12 }],
    rules: { rounds: 1, falseStart: { mode: 'redo' } },
  },
  'range-coin': {
    id: 'range-coin',
    title: 'Heads or Hot Lead',
    weapon: 'pistol',
    place: 'the Range',
    signal: { kind: 'coin-toss', delayMs: [1000, 2500] },
    opponents: CUTOUTS_NEAR,
    rules: { rounds: 1, falseStart: { mode: 'forfeit' } },
  },
  'range-paces': {
    id: 'range-paces',
    title: 'Ten Paces and Turn',
    weapon: null, // no weapon named: you duel with what you carry
    place: 'the Range',
    signal: { kind: 'ten-paces', stepMs: 650 },
    opponents: CUTOUTS_NEAR,
    rules: { rounds: 1, falseStart: { mode: 'forfeit' } },
  },
};
window.DUEL_CATALOG = DUEL_CATALOG;

// ---------- gun-fired ----------
//
// A pistol announces a hit (`shot` on the thing it hit) but nothing when
// it fires, and a duel needs every shot for accuracy and for the false
// start of a shot before the signal. The right fix is a one-line emit in
// firearm.fire(), but items-guns.js is not this phase's to edit, so the
// component's fire is wrapped here, once, to announce `gun-fired` first
// (so a shot always arrives before the hit it causes). TODO.md tracks
// moving this into fire() itself.
function installGunFiredEvent() {
  var def = AFRAME.components.firearm;
  var proto = def && def.Component && def.Component.prototype;
  if (!proto || proto.__gunFiredWrapped) return;
  var fire = proto.fire;
  proto.fire = function () {
    var holsterable = this.el.components.holsterable;
    if (holsterable && holsterable.state === 'held') {
      this.el.emit('gun-fired', { gun: this.el }, true);
    }
    return fire.apply(this, arguments);
  };
  proto.__gunFiredWrapped = true;
}

// ---------- modifiers ----------
//
// apply(ctx, params) returns what remove(ctx, params, saved) needs.
// ctx is { scene }. Two cheap ones to prove the shape; the real
// collection is phase 04.

var DAY_MS = function () { return window.DAY_NIGHT_CYCLE_MS || 24 * 60 * 1000; };

export var DUEL_MODIFIERS = {
  // Jump the sky to an hour of the day (0-24, 6 is dawn). The clock keeps
  // running during the duel and, on the way out, lands where it would
  // have been had the duel never happened.
  'time-of-day': {
    apply: function (ctx, params) {
      var cycle = ctx.scene.components['day-night-cycle'];
      if (!cycle) return null;
      var saved = { elapsed: cycle.elapsedGameMs, at: performance.now() };
      var day = Math.floor(cycle.elapsedGameMs / DAY_MS());
      var fraction = (((params.hour - 6) % 24) + 24) % 24 / 24; // noon is a quarter of the way round from dawn
      cycle.elapsedGameMs = (day + fraction) * DAY_MS();
      cycle.clock = cycle.elapsedGameMs % DAY_MS();
      cycle.applyLighting();
      return saved;
    },
    remove: function (ctx, params, saved) {
      var cycle = ctx.scene.components['day-night-cycle'];
      if (!cycle || !saved) return;
      cycle.elapsedGameMs = saved.elapsed + (performance.now() - saved.at) * (cycle.timeScale || 1);
      cycle.clock = cycle.elapsedGameMs % DAY_MS();
      cycle.applyLighting();
    },
  },
  fog: {
    apply: function (ctx, params) {
      var previous = ctx.scene.getAttribute('fog');
      ctx.scene.setAttribute('fog', { type: 'exponential', density: params.density || 0.04, color: params.color || '#cdbf9f' });
      return previous ? Object.assign({}, previous) : null;
    },
    remove: function (ctx, params, previous) {
      if (previous) ctx.scene.setAttribute('fog', previous);
      else ctx.scene.removeAttribute('fog');
    },
  },
};

// ---------- the gear swap ----------
//
// "Set aside" and "give back" go through the same calls the belt and a
// holster use (vacateSlot / occupySlot / attachTo), onto a hidden stash
// slot, so the holster and belt internals are never edited. The stash is
// closed to the player's own holstering (accepting = false) and far away.

var STASH_ID = 'duel-stash';

function sceneEl() { return document.querySelector('a-scene'); }

function stashSlot() {
  var el = document.getElementById(STASH_ID);
  if (el) return el;
  el = document.createElement('a-entity');
  el.id = STASH_ID;
  el.classList.add('anchor-slot');
  el.setAttribute('data-area-persistent', '');
  el.setAttribute('anchor-slot', { size: 'large', capacity: 16 });
  el.setAttribute('position', { x: 0, y: -200, z: 0 });
  el.setAttribute('visible', false);
  sceneEl().appendChild(el);
  var comp = el.components['anchor-slot'];
  if (comp) comp.accepting = false;
  else el.addEventListener('loaded', function () { el.components['anchor-slot'].accepting = false; }, { once: true });
  return el;
}

// The slots that are "the player's own": the body anchors and whatever
// the worn belt/vest carries (the belt's hips, the vest's packs).
function playerSlots() {
  var slots = [];
  ['head-anchor', 'mouth-anchor', 'waist-anchor', 'chest-anchor', 'back-anchor'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) slots.push(el);
  });
  for (var i = 0; i < slots.length; i++) {
    var comp = slots[i].components['anchor-slot'];
    if (!comp) continue;
    comp.occupants.forEach(function (occupant) {
      Array.prototype.forEach.call(occupant.el.querySelectorAll('.anchor-slot'), function (s) {
        if (slots.indexOf(s) < 0) slots.push(s);
      });
    });
  }
  return slots;
}

function firearms() {
  return Array.prototype.slice.call(document.querySelectorAll('[firearm]')).filter(function (el) {
    return el.components.holsterable;
  });
}

function inHand(h) { return h.state === 'held' || h.state === 'dangling'; }

// Where a gun that was in a hand (or whose slot is gone) should go back to:
// the holster it was built into, if that is free, otherwise any free slot
// of the player's that fits, holsters before the mouth and hat.
function findFreeSlotFor(holsterable) {
  var rank = window.SLOT_SIZE_RANK || { small: 0, medium: 1, large: 2 };
  var free = function (slotEl) {
    var comp = slotEl && slotEl.isConnected && slotEl.components['anchor-slot'];
    if (!comp || !comp.canAccept(holsterable)) return false;
    if (comp.data.swap) return false; // body anchors that swap would evict their worn item
    if (rank[comp.data.size] < rank[holsterable.data.itemSize]) return false;
    return comp.occupants.length < comp.data.capacity;
  };
  var home = holsterable.data.holsterSelector; // the selector holsterable was built with ('#belt-hip-1')
  if (home && free(home)) return home;
  var fits = playerSlots().filter(free);
  var worn = fits.filter(function (s) { return s.id !== 'mouth-anchor' && s.id !== 'head-anchor'; });
  return (worn[0] || fits[0]) || null;
}

export var GEAR = {
  // Every gun the player has on them: in a hand, or in one of their own slots.
  carried: function () {
    var own = playerSlots();
    return firearms().filter(function (el) {
      var h = el.components.holsterable;
      if (inHand(h)) return true;
      return h.state === 'holstered' && h.currentSlotEl && own.indexOf(h.currentSlotEl) >= 0;
    });
  },

  setAside: function (el) {
    var h = el.components.holsterable;
    var token = { slotEl: h.state === 'holstered' ? h.currentSlotEl : null, wasInHand: inHand(h) };
    if (h.supportHand) h.releaseSupport();
    if (h.hand) {
      var rig = h.hand.components['hand-rig'];
      if (rig) rig.discard(el);
    }
    var stash = stashSlot();
    h.vacateSlot();
    h.hand = null;
    h.state = 'holstered';
    h.attachTo(stash.object3D, h.data.holsterPosition, h.data.holsterRotation);
    h.occupySlot(stash);
    var fire = el.components.firearm;
    if (fire) fire.automatic = false;
    return token;
  },

  putBack: function (el, token) {
    var h = el.components.holsterable;
    if (!h) return;
    h.vacateSlot();
    var slot = token.slotEl;
    var comp = slot && slot.isConnected && slot.components['anchor-slot'];
    if (!comp || !comp.canAccept(h) || comp.occupants.length >= comp.data.capacity) slot = findFreeSlotFor(h);
    if (slot) {
      h.state = 'holstered';
      h.hand = null;
      h.attachTo(slot.object3D, h.data.holsterPosition, h.data.holsterRotation);
      h.occupySlot(slot);
      return;
    }
    // Nowhere to put it: drop it at the player's feet, where it can be picked up.
    var rig = document.getElementById('player-rig');
    var pos = new THREE.Vector3();
    (rig || el).object3D.getWorldPosition(pos);
    h.attachTo(sceneEl().object3D, null, null);
    el.object3D.position.set(pos.x, 0.8, pos.z - 0.3);
    h.startFalling();
  },

  // Build the duel's weapon into a free hip holster (the right one first).
  give: function (weapon) {
    var makeItem = window.makeItem;
    var waist = document.getElementById('waist-anchor');
    var wcomp = waist && waist.components['anchor-slot'];
    var beltEl = wcomp && wcomp.occupants[0] && wcomp.occupants[0].el;
    var belt = beltEl && beltEl.components.belt;
    if (!belt || typeof makeItem !== 'function') return null;
    var slots = belt.hipSlots.slice().reverse();
    for (var i = 0; i < slots.length; i++) {
      var comp = slots[i].components['anchor-slot'];
      if (comp && comp.occupants.length === 0) {
        var el = makeItem(weapon, slots[i]);
        if (el) {
          // A duel weapon is a loan, not loot: it must not perish on the floor mid-duel.
          if (el.hasAttribute('perishable')) el.removeAttribute('perishable');
          return el;
        }
      }
    }
    return null;
  },

  remove: function (el) {
    // Out of its holster (and any hand) now, not at the end of the frame
    // when despawnItem sweeps: the gun that lived in that holster is
    // about to be put back into it.
    var h = el.components.holsterable;
    if (h) {
      if (h.supportHand) h.releaseSupport();
      if (h.hand) {
        var rig = h.hand.components['hand-rig'];
        if (rig) rig.discard(el);
        h.hand = null;
      }
      h.vacateSlot();
    }
    if (typeof window.despawnItem === 'function') window.despawnItem(el);
    else if (el.parentNode) el.parentNode.removeChild(el);
  },
};

// ---------- the director ----------

function nowMs() { return performance.now(); }

AFRAME.registerSystem('duel-director', {
  init: function () {
    this.duel = null;
    this.def = null;
    this.signalRun = null;
    this.lastHolstered = undefined;
    this.pendingStart = null;
    this.lastResults = null;
    this.loadout = createLoadoutSwap(GEAR);
    this.modifiers = null;

    this.onGunFired = this.onGunFired.bind(this);
    this.onCutoutHit = this.onCutoutHit.bind(this);
    this.onMenuAction = this.onMenuAction.bind(this);
    this.onAreaUnloading = this.onAreaUnloading.bind(this);
    this.sceneEl.addEventListener('gun-fired', this.onGunFired);
    this.sceneEl.addEventListener('cutout-hit', this.onCutoutHit);
    this.sceneEl.addEventListener('area-unloading', this.onAreaUnloading);
    document.addEventListener('menu-action', this.onMenuAction);
    installGunFiredEvent();
    // The stash has to exist (and its anchor-slot have initialised) before
    // the first duel asks to set a gun aside in it.
    var scene = this.sceneEl;
    if (scene.hasLoaded) stashSlot();
    else scene.addEventListener('loaded', function () { stashSlot(); }, { once: true });
  },

  remove: function () {
    this.sceneEl.removeEventListener('gun-fired', this.onGunFired);
    this.sceneEl.removeEventListener('cutout-hit', this.onCutoutHit);
    this.sceneEl.removeEventListener('area-unloading', this.onAreaUnloading);
    document.removeEventListener('menu-action', this.onMenuAction);
  },

  lane: function () {
    var el = document.querySelector('[duel-lane]');
    return el && el.components['duel-lane'] ? el.components['duel-lane'] : null;
  },

  active: function () { return Boolean(this.duel && !this.duel.finished() && this.duel.phase !== 'results'); },

  // ----- starting and stopping -----

  onMenuAction: function (evt) {
    var id = (evt.detail && evt.detail.id) || '';
    if (id === 'duel-abort') { this.abort('cancelled from the watch'); return; }
    if (id.indexOf('duel-start-') !== 0) return;
    this.requestStart(id.slice('duel-start-'.length));
  },

  // From anywhere: travel to the Range first if the player is not there.
  requestStart: function (id) {
    if (!DUEL_CATALOG[id]) return false;
    if (this.lane()) return this.start(id);
    var rig = document.getElementById('player-rig');
    var hub = rig && rig.components['teleport-hub'];
    if (!hub) return false;
    this.pendingStart = id;
    hub.teleportTo('range');
    return true;
  },

  start: function (idOrDef) {
    if (this.active()) this.abort('replaced by a new duel');
    var def = typeof idOrDef === 'string' ? DUEL_CATALOG[idOrDef] : idOrDef;
    var lane = this.lane();
    if (!def || !lane) return false;
    this.cleanup();

    var duel = createDuel(def, { onEvent: this.onDuelEvent.bind(this) });
    this.duel = duel;
    this.def = duel.def;
    this.lastResults = null;
    this.signalRun = null;
    this.lastHolstered = undefined;

    var scene = this.sceneEl;
    this.modifiers = createModifierStack(DUEL_MODIFIERS, { scene: scene });
    if (duel.def.weapon && !this.loadout.takeover(duel.def.weapon)) {
      this.loadout.restore();
      lane.status('No belt to wear', 'warn');
      lane.info('The duel gives you its own pistol.\nWear a belt with a free holster.');
      this.duel = null;
      return false;
    }
    this.modifiers.apply(duel.def.modifiers);
    lane.setup(duel.def.opponents);
    lane.title(duel.def.title.toUpperCase());
    duel.start(nowMs());
    return true;
  },

  abort: function (reason) {
    if (!this.duel) return false;
    var lane = this.lane();
    var stopped = this.duel.abort(nowMs(), reason);
    this.cleanup();
    if (lane) {
      lane.popAll(false);
      lane.clearProps();
      if (stopped) { lane.status('Duel cancelled', 'warn'); lane.info(''); }
    }
    return stopped;
  },

  // Gear back, world back. Safe to call any number of times.
  cleanup: function () {
    this.signalRun = null;
    this.loadout.restore();
    if (this.modifiers) { this.modifiers.removeAll(); this.modifiers = null; }
  },

  onAreaUnloading: function (evt) {
    if (evt.detail.id === 'range' && this.duel && !this.duel.finished()) this.abort('left the Range');
  },

  // ----- world -> model -----

  onGunFired: function () {
    if (this.duel && this.active()) this.duel.shotFired(nowMs());
  },

  onCutoutHit: function (evt) {
    if (!this.duel || !this.active()) return;
    var d = evt.detail;
    this.duel.hit(nowMs(), { id: d.id, zone: d.zone, killed: d.killed });
  },

  holstered: function () {
    var guns = firearms();
    for (var i = 0; i < guns.length; i++) {
      if (inHand(guns[i].components.holsterable)) return false;
    }
    return true;
  },

  tick: function () {
    if (this.pendingStart && this.lane()) {
      var rig = document.getElementById('player-rig');
      var hub = rig && rig.components['teleport-hub'];
      if (!hub || !hub.fading) {
        var id = this.pendingStart;
        this.pendingStart = null;
        this.start(id);
      }
    }
    var duel = this.duel;
    if (!duel || duel.finished() || duel.phase === 'results') return;
    var now = nowMs();

    if (duel.phase === 'setup' || duel.phase === 'waiting') {
      var holstered = this.holstered();
      if (holstered !== this.lastHolstered) {
        this.lastHolstered = holstered;
        duel.setHolstered(now, holstered);
        if (duel.phase === 'setup') this.lane() && this.lane().status('Holster your gun', 'warn');
      }
    }
    this.runSignal(now);
    duel.tick(now);
  },

  // Walk the start signal's plan against the clock. The model decides
  // nothing here: it only learns of the signal when a step calls fire.
  runSignal: function (now) {
    var run = this.signalRun;
    var duel = this.duel;
    if (!run) return;
    if (duel.phase !== 'waiting') { this.signalRun = null; return; }
    var lane = this.lane();
    var self = this;
    while (run.idx < run.plan.length && now - run.t0 >= run.plan[run.idx].at) {
      var step = run.plan[run.idx++];
      if (!lane) continue;
      lane.signalStep(step, function () {
        if (self.duel === duel && duel.phase === 'waiting') duel.signal(nowMs());
      });
    }
  },

  // ----- model -> world -----

  onDuelEvent: function (name, detail) {
    var lane = this.lane();
    var scene = this.sceneEl;
    if (name === 'duel-setup') {
      if (lane) {
        lane.popAll(false);
        lane.clearProps();
        lane.status('Round ' + detail.round + ' of ' + detail.rounds + (detail.redo ? '  (redo)' : ''), 'info');
        lane.info('Holster your gun and wait for the signal');
      }
      this.signalRun = null;
      this.lastHolstered = undefined;
    } else if (name === 'duel-waiting') {
      this.signalRun = { plan: detail.plan, idx: 0, t0: detail.at };
      if (lane) { lane.status('Hands off...', 'info'); lane.info('Wait for it'); }
    } else if (name === 'duel-signal') {
      if (lane) lane.popAll(true);
    } else if (name === 'duel-false-start') {
      if (lane) {
        lane.status('FALSE START', 'warn');
        lane.info(detail.mode === 'forfeit' ? 'Round forfeited' : detail.mode === 'penalty' ? '+' + detail.penaltyMs + ' ms' : detail.mode === 'redo' ? 'Again, and keep your hands down' : 'No harm done');
      }
      if (detail.mode !== 'penalty' && detail.mode !== 'none') this.signalRun = null;
    } else if (name === 'duel-hit') {
      if (lane) lane.info('Hit: ' + detail.zone + '   ' + formatMs(detail.reactionMs));
    } else if (name === 'duel-round-end') {
      this.signalRun = null;
      if (lane && detail.result) {
        // A forfeit keeps saying why; anything else says who took the round.
        if (detail.outcome !== 'false-start') lane.status(detail.won ? 'ROUND WON' : 'ROUND LOST', detail.won ? 'win' : 'warn');
        lane.info(roundLine(detail.result));
      }
    } else if (name === 'duel-results') {
      this.lastResults = detail;
      this.cleanup(); // gear and world back the moment it is over
      if (lane) {
        lane.popAll(false);
        lane.clearProps();
        var lines = resultsLines(detail);
        lane.status(lines[0], detail.outcome === 'won' ? 'win' : 'warn');
        lane.info(lines.slice(1));
      }
    }
    scene.emit(name, detail, false);
  },
});

// A handle for tests and the console: AFRAME.scenes[0].systems['duel-director'].
window.DuelModel = { normalizeDuel: normalizeDuel };
