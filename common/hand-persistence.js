// A missing observation is not a release gesture. Retain the last pose briefly,
// but label it explicitly so no recognizer treats an unseen hand as fresh input.
export class HandPersistence {
  constructor(grace = 1500) { this.grace = grace; this.reset(); }
  reset() { this.last = {}; }
  transform(point, direction) {
    for (const entry of Object.values(this.last)) {
      const hand = entry.hand;
      entry.hand = { ...hand, palm: point(hand.palm), tip: point(hand.tip),
        joints: Object.fromEntries(Object.entries(hand.joints).map(([name, p]) => [name, point(p)])),
        normal: direction(hand.normal), aim: direction(hand.aim),
        handAim: hand.handAim && direction(hand.handAim), fingerAim: hand.fingerAim && direction(hand.fingerAim) };
    }
  }
  update(samples, time) {
    const result = {};
    for (const side of ['left', 'right']) {
      const hand = samples[side], previous = this.last[side];
      if (hand) {
        result[side] = { ...hand, tracked: true, reacquired: !!previous?.missing, missingFor: previous?.missing ? time - previous.time : 0 };
        this.last[side] = { hand: result[side], time, missing: false };
      } else if (previous && time >= previous.time && time - previous.time <= this.grace) {
        previous.missing = true;
        result[side] = { ...previous.hand, tracked: false, reacquired: false, missingFor: time - previous.time };
      } else { result[side] = null; delete this.last[side]; }
    }
    return result;
  }
}
