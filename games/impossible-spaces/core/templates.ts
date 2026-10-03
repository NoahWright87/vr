import type { Vec } from './types.ts';

/**
 * Template catalog. A template makes a shape in local coordinates:
 *  - parts: convex polygons (sharing edges) whose union is the piece
 *  - slots: the edges ALLOWED to hold a door (the per-shape door rules)
 * Everything sits on the 45° lattice. Sizes come from the context so the
 * same template fits different play spaces. To add a shape, add an entry here.
 */
export interface Slot { a: Vec; b: Vec; part: number }
/** joints: indexes of small corner-joint parts (45° bends, Y splits) that are narrower than a hall run. */
export interface Shape { parts: Vec[][]; slots: Slot[]; joints?: number[] }
export interface MakeCtx {
  w: number;          // hall / door width (comfort floor)
  roomMin: number;    // thinnest a room (or room arm) may be
  area: number;       // target room area (m²), already scaled
  extra: number;      // how much longer than minimum a hall arm may get (m), already scaled
  rng: () => number;
}
export interface Template { name: string; kind: 'room' | 'hall' | 'elevator'; label: string; make: (c: MakeCtx) => Shape | null }

const R = (x0: number, y0: number, x1: number, y1: number): Vec[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const P = (x: number, y: number): Vec => ({ x, y });
const S = (part: number, a: Vec, b: Vec): Slot => ({ a, b, part });
const rnd = (c: MakeCtx, a: number, b: number) => a + c.rng() * Math.max(0, b - a);
const D = Math.SQRT1_2;

// ---------------------------------------------------------------- rooms
const roomRect: Template = { name: 'room-rect', kind: 'room', label: 'Room', make: c => {
  const asp = rnd(c, 0.6, 1.6);
  const W = Math.max(c.roomMin, Math.sqrt(c.area * asp)), H = Math.max(c.roomMin, c.area / W);
  const q = R(0, 0, W, H);
  return { parts: [q], slots: [S(0, q[0], q[1]), S(0, q[1], q[2]), S(0, q[2], q[3]), S(0, q[3], q[0])] };
} };

// L: horizontal arm along the bottom, vertical arm up the left. Doors: arm ends + outer walls.
const roomL: Template = { name: 'room-l', kind: 'room', label: 'L room', make: c => {
  const t1 = rnd(c, c.roomMin, c.roomMin * 1.5), t2 = rnd(c, c.roomMin, c.roomMin * 1.5);
  const s = Math.sqrt(c.area);
  const La = Math.max(t2 + 0.9 * c.roomMin, s * rnd(c, 0.9, 1.4)), Lb = Math.max(t1 + 0.9 * c.roomMin, s * rnd(c, 0.9, 1.4));
  const A = R(0, 0, La, t1), B = R(0, t1, t2, Lb);
  return { parts: [A, B], slots: [S(0, P(La, 0), P(La, t1)), S(1, P(0, Lb), P(t2, Lb)), S(0, P(0, 0), P(La, 0)), S(1, P(0, t1), P(0, Lb))] };
} };

// T: crossbar along the bottom, stem up the middle. Doors: the three ends only.
const roomT: Template = { name: 'room-t', kind: 'room', label: 'T room', make: c => {
  const tb = rnd(c, c.roomMin, c.roomMin * 1.4), ts = rnd(c, c.roomMin, c.roomMin * 1.4);
  const s = Math.sqrt(c.area);
  const Lb = Math.max(ts + 1.8 * c.roomMin, s * rnd(c, 1.2, 1.7)), Ls = Math.max(0.9 * c.roomMin, s * rnd(c, 0.5, 0.9));
  const bar = R(-Lb / 2, 0, Lb / 2, tb), stem = R(-ts / 2, tb, ts / 2, tb + Ls);
  return { parts: [bar, stem], slots: [S(0, P(-Lb / 2, 0), P(-Lb / 2, tb)), S(0, P(Lb / 2, 0), P(Lb / 2, tb)), S(1, P(-ts / 2, tb + Ls), P(ts / 2, tb + Ls))] };
} };

// U: base along the bottom, two arms up. Doors: not the tips, the outer walls next to them, plus the base's back wall.
const roomU: Template = { name: 'room-u', kind: 'room', label: 'U room', make: c => {
  const tb = rnd(c, c.roomMin, c.roomMin * 1.3), ta = rnd(c, c.roomMin, c.roomMin * 1.3);
  const gap = rnd(c, Math.max(c.w, 0.8 * c.roomMin), 1.4 * c.roomMin);
  const Wb = 2 * ta + gap, La = Math.max(c.w + 0.4, Math.min(2 * c.roomMin, (c.area - Wb * tb) / (2 * ta)));
  const base = R(0, 0, Wb, tb), left = R(0, tb, ta, tb + La), right = R(Wb - ta, tb, Wb, tb + La);
  return { parts: [base, left, right], slots: [S(1, P(0, tb), P(0, tb + La)), S(2, P(Wb, tb), P(Wb, tb + La)), S(0, P(0, 0), P(Wb, 0))] };
} };

// Notched: a rectangle with one corner bitten out. Doors: the long outer walls, never the notch.
const roomNotch: Template = { name: 'room-notch', kind: 'room', label: 'Notched room', make: c => {
  const asp = rnd(c, 0.7, 1.4);
  const W = Math.max(1.8 * c.roomMin, Math.sqrt(c.area * 1.2 * asp)), H = Math.max(1.8 * c.roomMin, c.area * 1.2 / W);
  const nw = Math.max(c.w, rnd(c, 0.25, 0.45) * W), nh = Math.max(c.w, rnd(c, 0.25, 0.45) * H);
  if (H - nh < c.roomMin || W - nw < c.roomMin) return null;
  const A = R(0, 0, W, H - nh), B = R(0, H - nh, W - nw, H);
  return { parts: [A, B], slots: [S(0, P(0, 0), P(W, 0)), S(0, P(W, 0), P(W, H - nh)), S(1, P(0, H), P(W - nw, H)), S(0, P(0, 0), P(0, H - nh)), S(1, P(0, H - nh), P(0, H))] };
} };

// Chamfered: rectangle with 45° corners. Doors: any wall long enough, diagonals included (they spawn 45° branches).
const roomChamfer: Template = { name: 'room-chamfer', kind: 'room', label: 'Chamfered room', make: c => {
  const asp = rnd(c, 0.7, 1.4);
  const W = Math.max(1.6 * c.roomMin, Math.sqrt(c.area * 1.15 * asp)), H = Math.max(1.6 * c.roomMin, c.area * 1.15 / W);
  const k = rnd(c, 0.2, 0.32) * Math.min(W, H);
  const q = [P(k, 0), P(W - k, 0), P(W, k), P(W, H - k), P(W - k, H), P(k, H), P(0, H - k), P(0, k)];
  return { parts: [q], slots: q.map((a, i) => S(0, a, q[(i + 1) % q.length])) };
} };

// ---------------------------------------------------------------- halls (all doors at arm ends, width w)
const arm = (c: MakeCtx, min: number) => rnd(c, min * c.w, min * c.w + c.extra);

const hallStraight: Template = { name: 'hall-straight', kind: 'hall', label: 'Straight hall', make: c => {
  const w = c.w, L = arm(c, 1.5);
  const q = R(0, -w / 2, L, w / 2);
  return { parts: [q], slots: [S(0, q[3], q[0]), S(0, q[1], q[2])] };
} };

const hallL: Template = { name: 'hall-l', kind: 'hall', label: 'L hall', make: c => {
  const w = c.w, a1 = arm(c, 2.2), a2 = arm(c, 2.2);
  const A = R(0, -w / 2, a1, w / 2), B = R(a1 - w, w / 2, a1, a2 - w / 2);
  return { parts: [A, B], slots: [S(0, P(0, -w / 2), P(0, w / 2)), S(1, P(a1 - w, a2 - w / 2), P(a1, a2 - w / 2))] };
} };

const hallT: Template = { name: 'hall-t', kind: 'hall', label: 'T hall', make: c => {
  const w = c.w, a1 = arm(c, 1.4), b = arm(c, 1.9);
  const stem = R(0, -w / 2, a1, w / 2), bar = R(a1, -b, a1 + w, b);
  return { parts: [stem, bar], slots: [S(0, P(0, -w / 2), P(0, w / 2)), S(1, P(a1, -b), P(a1 + w, -b)), S(1, P(a1, b), P(a1 + w, b))] };
} };

const hallX: Template = { name: 'hall-x', kind: 'hall', label: 'X hall', make: c => {
  const w = c.w, h = w / 2, n = arm(c, 1.4), s = arm(c, 1.4), e = arm(c, 1.4), wv = arm(c, 1.4);
  const C = R(-h, -h, h, h);
  const W_ = R(-h - wv, -h, -h, h), E = R(h, -h, h + e, h), N = R(-h, -h - n, h, -h), So = R(-h, h, h, h + s);
  return { parts: [C, W_, E, N, So], slots: [S(1, P(-h - wv, -h), P(-h - wv, h)), S(2, P(h + e, -h), P(h + e, h)), S(3, P(-h, -h - n), P(h, -h - n)), S(4, P(-h, h + s), P(h, h + s))] };
} };

// 45° elbow: straight, a wedge, then a diagonal run.
const hallBend: Template = { name: 'hall-bend45', kind: 'hall', label: '45° bend', make: c => {
  const w = c.w, L1 = arm(c, 1.2), L2 = arm(c, 1.2);
  const A = R(0, -w / 2, L1, w / 2);
  const Pp = P(L1, w / 2), Lo = P(L1, -w / 2), Q = P(L1 + D * w, w / 2 - D * w);
  const u = P(D, D);
  const B = [Pp, Q, P(Q.x + u.x * L2, Q.y + u.y * L2), P(Pp.x + u.x * L2, Pp.y + u.y * L2)];
  const X = P(Q.x - (Q.y - Lo.y), Lo.y);   // outer wall runs straight, then turns 45° to meet Q
  return { parts: [A, [Lo, X, Q, Pp], B], slots: [S(0, P(0, -w / 2), P(0, w / 2)), S(2, B[2], B[3])], joints: [1] };
} };

// Y: a stem splitting into two branches at ±45°.
const hallY: Template = { name: 'hall-y', kind: 'hall', label: 'Y junction', make: c => {
  const w = c.w, L1 = arm(c, 1.2), Lb = arm(c, 1.2), Lc = arm(c, 1.2);
  const stem = R(0, -w / 2, L1, w / 2);
  const top = P(L1, D * w), bot = P(L1, -D * w), apex = P(L1 + D * w, 0);
  const u = P(D, D), v = P(D, -D);
  const left = [top, apex, P(apex.x + u.x * Lb, apex.y + u.y * Lb), P(top.x + u.x * Lb, top.y + u.y * Lb)];
  const right = [apex, bot, P(bot.x + v.x * Lc, bot.y + v.y * Lc), P(apex.x + v.x * Lc, apex.y + v.y * Lc)];
  return { parts: [stem, [bot, apex, top], left, right], slots: [S(0, P(0, -w / 2), P(0, w / 2)), S(2, left[2], left[3]), S(3, right[2], right[3])], joints: [1] };
} };

export const ALCOVE: Template = { name: 'alcove', kind: 'elevator', label: 'Elevator', make: c => {
  const q = R(0, 0, c.w, c.w);
  return { parts: [q], slots: [S(0, q[3], q[0])] };
} };

export const TEMPLATES: Template[] = [roomRect, roomL, roomT, roomU, roomNotch, roomChamfer, hallStraight, hallL, hallT, hallX, hallBend, hallY];
export const TEMPLATE_BY_NAME: Record<string, Template> = Object.fromEntries([...TEMPLATES, ALCOVE].map(t => [t.name, t]));

/** A sensible starting mix (sums to 100). */
export const DEFAULT_MIX: Record<string, number> = {
  'room-rect': 20, 'room-l': 8, 'room-t': 6, 'room-u': 5, 'room-notch': 6, 'room-chamfer': 5,
  'hall-straight': 8, 'hall-l': 18, 'hall-t': 8, 'hall-x': 4, 'hall-bend45': 6, 'hall-y': 6,
};
