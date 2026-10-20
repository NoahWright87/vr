// ============================================================
// STRIKE STYLE — what kind of hit that was, so the target can sell it.
//
// You might just be punching and slapping; your character knows kung
// fu. Whatever landed, this names it, and the thing hit acts it out
// (common/brawlers.js):
//
//   butt      a hand holding a gun: hit them with the gun
//   uppercut  the strike detector's upward strike
//   slap      melee's slap (a fast sideways swipe), or any hand moving
//             mostly sideways across them
//   body      landed low on the body (below the chest): the gut
//   jab       anything else
//
// Checked in that order. Pure; tested by tests/strike-style.test.js.
// ============================================================

export var STYLE_SETTINGS = {
  slapAcross: 0.65, // fraction of the hand's horizontal motion that's sideways to the target
  slapSpeed: 1.2, // m/s, horizontal
};

// hit: {
//   axis        'forward' | 'up' | 'graze' (common/intent.js)
//   holdingGun  boolean
//   velocity    the hand's world velocity { x, y, z } (head-relative)
//   toTarget    from the hand toward the target's centre, world { x, z }
//   pointY      where it landed, world y
//   zone        the zone's name
//   chestY      the target's chest line, world y (below it is "body")
// }
export function strikeStyle(hit, settings) {
  var s = settings || STYLE_SETTINGS;
  if (hit.holdingGun) return 'butt';
  if (hit.axis === 'up') return 'uppercut';
  if (hit.axis === 'slap') return 'slap';
  var v = hit.velocity || { x: 0, y: 0, z: 0 };
  var hs = Math.sqrt(v.x * v.x + v.z * v.z);
  var t = hit.toTarget;
  if (t && hs >= s.slapSpeed) {
    var tl = Math.sqrt(t.x * t.x + t.z * t.z) || 1;
    var along = (v.x * t.x + v.z * t.z) / (hs * tl);
    var across = Math.sqrt(Math.max(0, 1 - along * along));
    if (across >= s.slapAcross) return 'slap';
  }
  if (hit.zone === 'legs') return 'body';
  if (hit.chestY !== undefined && hit.pointY !== undefined && hit.pointY < hit.chestY) return 'body';
  return 'jab';
}
