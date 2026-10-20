// ============================================================
// GUN CORE — what each gun is, and when it fires. Pure; tested by
// tests/gun-core.test.js. The component that holds, aims and shoots
// guns is common/guns.js.
//
// A weapon is data. Fire control is a small state per gun:
//
//   semi-auto (pistol, shotgun)  one shot per trigger pull, as fast as
//                                you can pull, down to minIntervalMs
//                                (the shotgun's pump)
//   full-auto (SMG)              a shot on the pull, then `rate` per
//                                second while the trigger is held
//   autofire mode                `rate` per second while the gun wants
//                                to fire (presented at a target), no
//                                trigger at all
//
// Every shot spends a round; an empty gun clicks.
// ============================================================

export var WEAPONS = {
  pistol: {
    label: 'Pistol', mag: 12, full: false, rate: 6, minIntervalMs: 35,
    pellets: 1, spreadDeg: 0, damage: 1, force: 0.6, recoil: 1, throwDamage: 3,
  },
  smg: {
    label: 'SMG', mag: 30, full: true, rate: 13, minIntervalMs: 0,
    pellets: 1, spreadDeg: 1.5, damage: 0.6, force: 0.35, recoil: 0.45, throwDamage: 3,
  },
  shotgun: {
    label: 'Shotgun', mag: 6, full: false, rate: 1.6, minIntervalMs: 280,
    pellets: 6, spreadDeg: 6, damage: 0.7, force: 1.1, recoil: 2.2, throwDamage: 4,
  },
};

export function createFireControl(weapon) {
  return { ammo: weapon.mag, held: false, lastShot: -Infinity, cooldown: 0 };
}

function spend(fc, wanted, infinite) {
  if (infinite) return { fired: wanted, dry: false };
  var fired = Math.min(wanted, fc.ammo);
  fc.ammo -= fired;
  return { fired: fired, dry: wanted > fired };
}

// The trigger goes down at `now` (ms). Returns { fired, dry }: how many
// shots left the gun (0 or 1), and whether it clicked empty.
export function pressTrigger(fc, weapon, now, infinite) {
  fc.held = true;
  if (now - fc.lastShot < weapon.minIntervalMs) return { fired: 0, dry: false };
  var r = spend(fc, 1, infinite);
  if (r.fired) {
    fc.lastShot = now;
    fc.cooldown = 1000 / weapon.rate; // a held full-auto trigger keeps going from here
  }
  return r;
}

export function releaseTrigger(fc) { fc.held = false; }

// Shots due this frame from a held full-auto trigger, or from autofire
// (wantAuto). Never more than 4 in one frame, even after a hitch.
export function heldShots(fc, weapon, dtMs, wantAuto, now, infinite) {
  var holding = fc.held && weapon.full;
  if (!holding && !wantAuto) {
    // A semi-auto gun's own rate still recovers while nothing is happening.
    fc.cooldown = Math.max(0, fc.cooldown - dtMs);
    return { fired: 0, dry: false };
  }
  var interval = 1000 / Math.max(weapon.rate, 0.01);
  fc.cooldown -= dtMs;
  var due = 0;
  while (fc.cooldown <= 0 && due < 4) { due++; fc.cooldown += interval; }
  if (fc.cooldown < 0) fc.cooldown = 0;
  if (!due) return { fired: 0, dry: false };
  var r = spend(fc, due, infinite);
  if (r.fired) fc.lastShot = now;
  return r;
}

export function reload(fc, weapon) { fc.ammo = weapon.mag; }

// The directions of a shot's pellets around `dir` (unit), spread in a
// cone of spreadDeg, using `random` (0..1) for repeatability in tests.
export function pelletDirections(dir, weapon, random) {
  var out = [];
  var rand = random || Math.random;
  var spread = weapon.spreadDeg * Math.PI / 180;
  // Two vectors perpendicular to dir.
  var ax = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  var u = { x: dir.y * ax.z - dir.z * ax.y, y: dir.z * ax.x - dir.x * ax.z, z: dir.x * ax.y - dir.y * ax.x };
  var ul = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z);
  u.x /= ul; u.y /= ul; u.z /= ul;
  var w = { x: dir.y * u.z - dir.z * u.y, y: dir.z * u.x - dir.x * u.z, z: dir.x * u.y - dir.y * u.x };
  for (var i = 0; i < weapon.pellets; i++) {
    if (i === 0 || !spread) { out.push({ x: dir.x, y: dir.y, z: dir.z }); continue; }
    var a = rand() * Math.PI * 2;
    var r = Math.tan(spread) * Math.sqrt(rand());
    var d = { x: dir.x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r, y: dir.y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r, z: dir.z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r };
    var l = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    out.push({ x: d.x / l, y: d.y / l, z: d.z / l });
  }
  return out;
}
