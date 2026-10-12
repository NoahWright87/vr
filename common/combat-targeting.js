// ============================================================
// COMBAT TARGETING — one resolver for every verb.
//
// Guns, strikes, throws and parries all ask the same question: given a
// vague intent (an arm held out roughly toward someone), which target
// is meant? This answers it the same way for all of them, with a
// profile of weights per verb, and explains every answer so the debug
// overlay can show why.
//
//   var targeting = sceneEl.systems['combat-targeting'];
//   var pick = targeting.resolve('gun', { origin, direction, by: 'right' });
//   // pick: { el, zone, aimPoint, score, terms, candidates } or null
//   targeting.claim(pick.el, 'right');  // "I've got this one"
//
// The scorer is a pure function over plain candidates, tested (with a
// 500-target benchmark) by tests/combat-targeting.test.js.
// ============================================================

import { defineTunables } from './tunables.js';
import { registerReadout } from './debug-hud.js';
import { zoneCenter } from './collide.js';
import './debug-draw.js';

var DEG = Math.PI / 180;

// Each verb's profile. Weights are relative; ranges in metres and cones
// as half-angles in degrees. A cone of 180 accepts anything in range.
export var DEFAULT_PROFILES = {
  gun: { range: 25, coneDeg: 35, aim: 1.0, distance: 0.35, gaze: 0.25, recent: 0.15, sticky: 0.6, threat: 0.5, priority: 0.2, claimed: 0.9 },
  strike: { range: 1.6, coneDeg: 60, aim: 0.6, distance: 0.8, gaze: 0.6, recent: 0.4, sticky: 0.5, threat: 0.3, priority: 0.2, claimed: 0 },
  throw: { range: 15, coneDeg: 25, aim: 0.5, distance: 0.2, gaze: 1.2, recent: 0.4, sticky: 0.4, threat: 0.3, priority: 0.2, claimed: 0.3 },
};

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

function angleBetween(dir, to, toLen) {
  if (toLen < 1e-9) return 0;
  var c = dot(dir, to) / toLen;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

// candidates: [{ id, point, priority?, threat?, recent? (0..1), claimedBy? }]
// query: { origin, direction (unit), gazeOrigin?, gazeDirection?, current?, by? }
// Returns the candidates that pass range and cone, best first, each with
// its score and the terms that made it.
export function scoreCandidates(candidates, query, profile) {
  var out = [];
  var range2 = profile.range * profile.range;
  var cone = Math.min(profile.coneDeg, 180) * DEG;
  var cosCone = Math.cos(cone);
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var to = sub(c.point, query.origin);
    var d2 = dot(to, to);
    if (d2 > range2) continue; // cheap pre-cull before any sqrt
    var d = Math.sqrt(d2);
    if (profile.coneDeg < 180 && d > 1e-9 && dot(to, query.direction) < cosCone * d) continue;
    var aimAngle = angleBetween(query.direction, to, d);
    var terms = {
      aim: profile.aim * (1 - aimAngle / Math.max(cone, 1e-6)),
      distance: profile.distance * (1 - d / profile.range),
      gaze: 0,
      recent: profile.recent * (c.recent || 0),
      sticky: query.current !== undefined && query.current === c.id ? profile.sticky : 0,
      threat: profile.threat * (c.threat || 0),
      priority: profile.priority * (c.priority || 0),
      claimed: c.claimedBy && c.claimedBy !== query.by ? -profile.claimed : 0,
    };
    if (query.gazeDirection) {
      var gazeTo = sub(c.point, query.gazeOrigin || query.origin);
      var gd = Math.sqrt(dot(gazeTo, gazeTo));
      var gazeAngle = angleBetween(query.gazeDirection, gazeTo, gd);
      terms.gaze = profile.gaze * Math.max(0, 1 - gazeAngle / (90 * DEG));
    }
    var score = 0;
    for (var k in terms) score += terms[k];
    out.push({ id: c.id, candidate: c, score: score, distance: d, angle: aimAngle / DEG, terms: terms });
  }
  out.sort(function (a, b) { return b.score - a.score; });
  return out;
}

export function describePick(pick) {
  if (!pick) return 'none';
  var t = pick.terms;
  var parts = Object.keys(t).filter(function (k) { return Math.abs(t[k]) > 0.005; }).map(function (k) { return k + ' ' + t[k].toFixed(2); });
  return pick.name + ' ' + (pick.zoneName || '') + ' ' + pick.score.toFixed(2) + ' (' + parts.join(', ') + ')';
}

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['combat-targeting']) {
  var THREE = AFRAME.THREE;

  // The parts of each profile worth tuning by feel.
  var tune = defineTunables('targeting', 'Targeting', [
    { key: 'gunRange', label: 'Gun range', value: DEFAULT_PROFILES.gun.range, min: 3, max: 60, step: 1, unit: 'm' },
    { key: 'strikeRange', label: 'Hit range', value: DEFAULT_PROFILES.strike.range, min: 0.5, max: 4, step: 0.1, unit: 'm' },
    { key: 'strikeCone', label: 'Hit cone', value: DEFAULT_PROFILES.strike.coneDeg, min: 10, max: 180, step: 5, unit: '°' },
    { key: 'throwCone', label: 'Throw cone', value: DEFAULT_PROFILES.throw.coneDeg, min: 5, max: 90, step: 5, unit: '°' },
    { key: 'gaze', label: 'Gaze', value: 1, min: 0, max: 300, step: 10, unit: '%', scale: 100 },
    { key: 'sticky', label: 'Sticky', value: 1, min: 0, max: 300, step: 10, unit: '%', scale: 100 },
    { key: 'recentMs', label: 'Memory', value: 2000, min: 0, max: 5000, step: 250, unit: 'ms' },
  ]);

  // Lines of the targeting readout: the last pick per verb and hand.
  var lastPicks = {};
  registerReadout('targeting', 'Targeting', function () {
    var keys = Object.keys(lastPicks).sort();
    if (!keys.length) return 'no queries yet';
    return keys.map(function (k) { return k + ': ' + describePick(lastPicks[k]); }).join('\n');
  });

  AFRAME.registerSystem('combat-targeting', {
    init: function () {
      this.targets = []; // combat-target components
      this.claims = new Map(); // el -> { by, until }
      this.gazePos = new THREE.Vector3();
      this.gazeQuat = new THREE.Quaternion();
      this.gazeDir = new THREE.Vector3();
      this.tune = tune;
    },

    register: function (target) { if (this.targets.indexOf(target) < 0) this.targets.push(target); },
    unregister: function (target) {
      var i = this.targets.indexOf(target);
      if (i >= 0) this.targets.splice(i, 1);
      this.claims.delete(target.el);
    },

    profile: function (name) {
      var base = DEFAULT_PROFILES[name];
      if (!base) return null;
      var p = Object.assign({}, base);
      var v = tune.values;
      if (name === 'gun') { p.range = v.gunRange; } // the gun's own Aim setting picks its cone
      if (name === 'strike') { p.range = v.strikeRange; p.coneDeg = v.strikeCone; }
      if (name === 'throw') { p.coneDeg = v.throwCone; }
      p.gaze *= v.gaze;
      p.sticky *= v.sticky;
      return p;
    },

    // A claim lasts a moment unless renewed: autofire renews it every
    // shot, so a target stays claimed exactly while it is being shot.
    claim: function (el, by, ms) {
      this.claims.set(el, { by: by, until: this.el.time + (ms || 250) });
    },

    gaze: function () {
      var cam = this.el.camera;
      if (!cam) return null;
      cam.getWorldPosition(this.gazePos);
      cam.getWorldQuaternion(this.gazeQuat);
      this.gazeDir.set(0, 0, -1).applyQuaternion(this.gazeQuat);
      return { origin: this.gazePos, direction: this.gazeDir };
    },

    // Recent gaze: when each target was last within ~12° of where you
    // were looking. People turn their head mid-swing; the target they
    // just looked at should still count (Punch Pop's memory, shared).
    tick: function (time) {
      var gaze = this.gaze();
      var cos = Math.cos(12 * DEG);
      for (var i = 0; i < this.targets.length; i++) {
        var t = this.targets[i];
        if (!t.alive) continue;
        if (gaze) {
          var p = t.aimPoint();
          var dx = p.x - gaze.origin.x, dy = p.y - gaze.origin.y, dz = p.z - gaze.origin.z;
          var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > 1e-6 && (dx * gaze.direction.x + dy * gaze.direction.y + dz * gaze.direction.z) / d > cos) t.lookedAt = time;
        }
      }
      var self = this;
      this.claims.forEach(function (claim, el) { if (claim.until < time) self.claims.delete(el); });
      this.drawHitboxes();
    },

    candidates: function () {
      var time = this.el.time;
      var memory = tune.values.recentMs;
      var out = [];
      for (var i = 0; i < this.targets.length; i++) {
        var t = this.targets[i];
        if (!t.alive || !t.targetable()) continue;
        var claim = this.claims.get(t.el);
        out.push({
          id: t.el,
          target: t,
          point: t.aimPoint(),
          priority: t.data.priority,
          threat: t.threat,
          recent: memory > 0 && t.lookedAt !== undefined ? Math.max(0, 1 - (time - t.lookedAt) / memory) : 0,
          claimedBy: claim ? claim.by : null,
        });
      }
      return out;
    },

    // query: { origin, direction, by?, current?, coneDeg?, range? }
    // (THREE vectors fine). coneDeg/range override the profile's.
    resolve: function (profileName, query) {
      var profile = this.profile(profileName);
      if (!profile) return null;
      if (query.coneDeg !== undefined) profile.coneDeg = query.coneDeg;
      if (query.range !== undefined) profile.range = query.range;
      var gaze = this.gaze();
      var q = {
        origin: query.origin, direction: query.direction, by: query.by, current: query.current,
        gazeOrigin: gaze && gaze.origin, gazeDirection: gaze && gaze.direction,
      };
      var scored = scoreCandidates(this.candidates(), q, profile);
      var best = scored[0] || null;
      var pick = null;
      if (best) {
        var target = best.candidate.target;
        pick = {
          el: target.el,
          target: target,
          zone: target.aimZone(),
          zoneName: target.data.aimZone,
          aimPoint: best.candidate.point,
          score: best.score,
          terms: best.terms,
          distance: best.distance,
          name: target.el.id || target.el.className || 'target',
          candidates: scored,
        };
      }
      lastPicks[profileName + '/' + (query.by || '?')] = pick;
      this.drawQuery(profile, q, scored, pick);
      return pick;
    },

    drawQuery: function (profile, q, scored, pick) {
      var dd = this.el.systems['debug-draw'];
      if (!dd || !dd.on('targeting')) return;
      var len = Math.min(profile.range, 6);
      if (profile.coneDeg < 180) dd.cone(q.origin, q.direction, profile.coneDeg * DEG, len, '#4a6fa5', 12);
      for (var i = 0; i < scored.length; i++) {
        var c = scored[i].candidate;
        var winner = pick && c.id === pick.el;
        dd.line(q.origin, c.point, winner ? '#ffe066' : '#5a6a88');
        dd.cross(c.point, winner ? 0.16 : 0.08, winner ? '#ffe066' : '#8899bb');
      }
    },

    drawHitboxes: function () {
      var dd = this.el.systems['debug-draw'];
      if (!dd || !dd.on('hitboxes')) return;
      for (var i = 0; i < this.targets.length; i++) {
        var t = this.targets[i];
        var zones = t.worldZones();
        var color = t.alive ? '#ff6b6b' : '#555b66';
        for (var z = 0; z < zones.length; z++) {
          var zone = zones[z];
          if (zone.type === 'capsule') dd.capsule(zone.a, zone.b, zone.r, color, 10);
          else dd.sphere(zone.a, zone.r, color, 10);
        }
      }
    },
  });

  // ============================================================
  // combat-target: anything that can be targeted and hit.
  //
  // Zones (spheres and capsules in the entity's local space) are what
  // gets hit — not meshes — so a target's look can change freely.
  //   el.components['combat-target'].setZones([
  //     { name: 'head', type: 'sphere', a: {x,y,z}, r: 0.12, damage: 3 },
  //     { name: 'torso', type: 'capsule', a: {...}, b: {...}, r: 0.2 },
  //   ]);
  // A hit, whatever caused it, is applyHit({ zone, point, direction,
  // force, damage, source, by }) and arrives on the entity as one
  // `action-hit` event (non-bubbling, like Pistols' `shot`). Health
  // and death belong to the target: whatever owns it listens for
  // action-hit and decides what a hit means.
  // ============================================================
  AFRAME.registerComponent('combat-target', {
    schema: {
      team: { default: 'enemy' },
      priority: { default: 0 }, // 0..1, a nudge in scoring
      aimZone: { default: 'torso' },
      health: { default: 3 },
    },

    init: function () {
      this.zones = [];
      this.world = [];
      this.worldTime = -1;
      this.alive = true;
      this.available = true;
      this.threat = 0;
      this.health = this.data.health;
      this.lookedAt = undefined;
      this.v = new THREE.Vector3();
      // A different name from the system, so no automatic this.system.
      this.targeting = this.el.sceneEl.systems['combat-targeting'];
      this.targeting.register(this);
    },

    remove: function () { this.targeting.unregister(this); },

    // Off-limits while unavailable (a popper that's down), hidden, or
    // dead (checked separately as alive).
    targetable: function () { return this.available !== false && this.el.object3D.visible !== false; },

    setZones: function (zones) {
      this.zones = zones.map(function (z) {
        return { name: z.name, type: z.type || 'sphere', a: z.a, b: z.b || z.a, r: z.r, damage: z.damage === undefined ? 1 : z.damage };
      });
      this.world = this.zones.map(function (z) {
        return { name: z.name, type: z.type, a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, r: z.r, damage: z.damage };
      });
      this.worldTime = -1;
    },

    // Zones in world space, computed at most once per frame.
    worldZones: function () {
      var time = this.el.sceneEl.time;
      if (this.worldTime === time) return this.world;
      this.worldTime = time;
      var m = this.el.object3D.matrixWorld;
      this.el.object3D.updateMatrixWorld();
      for (var i = 0; i < this.zones.length; i++) {
        var z = this.zones[i];
        var w = this.world[i];
        this.v.set(z.a.x, z.a.y, z.a.z).applyMatrix4(m);
        w.a.x = this.v.x; w.a.y = this.v.y; w.a.z = this.v.z;
        this.v.set(z.b.x, z.b.y, z.b.z).applyMatrix4(m);
        w.b.x = this.v.x; w.b.y = this.v.y; w.b.z = this.v.z;
      }
      return this.world;
    },

    zone: function (name) {
      var zones = this.worldZones();
      for (var i = 0; i < zones.length; i++) if (zones[i].name === name) return zones[i];
      return zones[0] || null;
    },

    aimZone: function () { return this.zone(this.data.aimZone); },

    aimPoint: function () {
      var z = this.aimZone();
      return z ? zoneCenter(z) : this.el.object3D.getWorldPosition(new THREE.Vector3());
    },

    // detail: { zone (name or zone), point, direction, force, damage,
    //           source, by }. Returns the detail it emitted, with
    //           .damage scaled by the zone and .killed set.
    applyHit: function (detail) {
      if (!this.alive) return null;
      var zone = typeof detail.zone === 'string' ? this.zone(detail.zone) : (detail.zone || this.aimZone());
      var out = Object.assign({}, detail, {
        zone: zone ? zone.name : null,
        damage: (detail.damage === undefined ? 1 : detail.damage) * (zone ? zone.damage : 1),
      });
      this.health -= out.damage;
      out.killed = this.health <= 0;
      if (out.killed) this.alive = false;
      this.el.emit('action-hit', out, false);
      return out;
    },

    revive: function () {
      this.health = this.data.health;
      this.alive = true;
    },
  });
}
