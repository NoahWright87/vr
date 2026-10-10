import type { GenParams, Level, Piece, Door, Portal, Vec } from './types.ts';
import { mulberry32, pieceInBounds, polysOverlap, add, sub, mul, dot, len, norm, rot, centroid, bboxOf, distPointSeg as distToSeg } from './geometry.ts';
import { seeThroughFor, computeVisibleRegions, computeVisible, type Cache } from './visibility.ts';
import { TEMPLATES, TEMPLATE_BY_NAME, ALCOVE, type Template, type Slot } from './templates.ts';
import { pieceInFootprint, clearance } from './footprint.ts';
import { insideConvex, wallSegments } from './geometry.ts';

/**
 * Grows a tree of template pieces breadth-first from a start room. Each new piece
 * docks door-to-door: one of its allowed door slots is matched to an open doorway
 * on an existing piece (rotation snaps to 45°). A candidate is accepted only if,
 * after adding it, every piece's visible regions are still pairwise disjoint. That
 * single invariant makes the impossible space safe; overlap anywhere else is the point.
 * If nothing fits: an elevator (alcove here, alcove + room anywhere else).
 * Halls are never left dead-ended.
 */

interface WSlot { a: Vec; b: Vec; normal: Vec }       // world-space door slot, normal points out of the piece
interface Node { piece: Piece; slots: WSlot[]; parent: string | null; children: number }
interface Exit { p1: Vec; p2: Vec; normal: Vec }

export function generateLevel(params: GenParams): Level {
  // A bad start (e.g. a room jammed into a corner) can strand the whole level. Retry from a
  // fresh start a few times, same RNG stream so it stays deterministic, and keep the best.
  const rng = mulberry32(params.seed);
  let best: Level | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const lv = generateOnce(params, rng);
    if (!best || lv.pieces.length > best.pieces.length) best = lv;
    if (!lv.warning) break;
  }
  return best!;
}

function generateOnce(params: GenParams, rng: () => number): Level {
  const P = { ...params, mix: { ...params.mix } };
  const W = P.boundsW, H = P.boundsH, w = P.minWidth;
  const roomMin = Math.max(1.5 * w, w + 0.4);
  const inBounds = (p: Piece) => pieceInBounds(p, W, H) && (!P.footprint || pieceInFootprint(p, P.footprint, P.boundaryMargin ?? 0));
  if (P.startAt && P.footprint && clearance(P.startAt, P.footprint) < (P.boundaryMargin ?? 0) + 0.16) throw new Error('Step farther inside your boundary, then press Generate.');
  const rand = (a: number, b: number) => a + rng() * (b - a);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const loPct = Math.min(P.minSizePct, P.maxSizePct), hiPct = Math.max(P.minSizePct, P.maxSizePct);
  const cache: Cache = new Map();

  const nodes = new Map<string, Node>();
  let doors: Door[] = [];
  const portals: Portal[] = [];
  let nextId = 0;
  const newId = (prefix: string) => `${prefix}${nextId++}`;
  const pieces = () => [...nodes.values()].map(n => n.piece);

  // ---- weighted template order (sampling without replacement, by mix weight)
  // Deficit-driven: a template behind its target share gets boosted, one ahead gets damped,
  // so the placed mix tracks the sliders even though some shapes fit far more easily than others.
  const mixTotal = Object.values(P.mix).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const target_ = (t: Template) => Math.max(0, P.mix[t.name] ?? 0) / mixTotal;
  function actualShare(t: Template) {
    let n = 0, m = 0;
    for (const nd of nodes.values()) { if (nd.piece.kind === 'elevator') continue; n++; if (nd.piece.template === t.name) m++; }
    return n ? m / n : 0;
  }
  function weightedOrder(pool: Template[]): Template[] {
    return pool.filter(t => target_(t) > 0)
      .map(t => ({ t, wgt: target_(t) * Math.exp(6 * (target_(t) - actualShare(t))) }))
      .map(x => ({ t: x.t, k: Math.pow(rng(), 1 / x.wgt) }))
      .sort((a, b) => b.k - a.k).map(x => x.t);
  }
  const ROOMS = TEMPLATES.filter(t => t.kind === 'room');
  const roomOrder = () => { const o = weightedOrder(ROOMS); return o.length ? o : [TEMPLATE_BY_NAME['room-rect']]; };

  // ---- make a shape at a size scale k and dock its slot `entry` onto world doorway `ex`
  const SCALES = [1, 0.7, 0.45, 0.25, 0.1];
  function shapeAt(t: Template, k: number) {
    const sh = t.make({ w, roomMin, area: Math.max(roomMin * roomMin, (W * H * rand(loPct, hiPct) / 100) * k * k), extra: 0.3 * Math.max(W, H) * k, rng });
    if (!sh) return null;
    if (rng() < 0.5) { // mirror for left/right variety
      sh.parts = sh.parts.map(p => p.map(v => ({ x: v.x, y: -v.y })));
      sh.slots = sh.slots.map(s => ({ ...s, a: { x: s.a.x, y: -s.a.y }, b: { x: s.b.x, y: -s.b.y } }));
    }
    return sh;
  }
  function slotNormal(s: Slot, parts: Vec[][]): Vec {
    const e = norm(sub(s.b, s.a)), n = { x: -e.y, y: e.x }, c = centroid(parts[s.part]);
    return dot(n, sub(add(s.a, mul(sub(s.b, s.a), 0.5)), c)) > 0 ? n : mul(n, -1);
  }
  function dock(t: Template, k: number, ex: Exit): { piece: Piece; slots: WSlot[] } | null {
    const sh = shapeAt(t, k);
    if (!sh) return null;
    const usable = sh.slots.filter(s => len(sub(s.b, s.a)) >= w - 1e-9);
    if (!usable.length) return null;
    const s = pick(usable), L = len(sub(s.b, s.a)), u = norm(sub(s.b, s.a));
    const m = L - w >= 0.1 ? 0.05 : (L - w) / 2;
    const off = rand(m, L - w - m);
    const lc = add(s.a, mul(u, off + w / 2));                 // local door center
    const ln = slotNormal(s, sh.parts);
    // rotate so the new piece's door faces back into the parent, snapped to 45°
    let th = Math.atan2(-ex.normal.y, -ex.normal.x) - Math.atan2(ln.y, ln.x);
    th = Math.round(th / (Math.PI / 4)) * (Math.PI / 4);
    const wc = add(ex.p1, mul(sub(ex.p2, ex.p1), 0.5));
    const tf = (v: Vec) => add(rot(sub(v, lc), th), wc);
    const id = newId(t.kind === 'room' ? 'r' : t.kind === 'hall' ? 'h' : 'e');
    const piece: Piece = { id, kind: t.kind, template: t.name, parts: sh.parts.map(p => p.map(tf)), ...(sh.joints ? { joints: sh.joints } : {}) };
    const slots = sh.slots.map(sl => ({ a: tf(sl.a), b: tf(sl.b), normal: rot(slotNormal(sl, sh.parts), th) }));
    return { piece, slots };
  }
  /** Place a shape freely (start room / elevator destination): random 45° rotation, random spot in bounds. */
  function placeFree(t: Template, k: number, anchor?: Vec): { piece: Piece; slots: WSlot[] } | null {
    const sh = shapeAt(t, k);
    if (!sh) return null;
    const th = Math.floor(rng() * 4) * Math.PI / 2;   // axis-aligned; 45° comes only from diagonal doors
    const parts = sh.parts.map(p => p.map(v => rot(v, th)));
    const bb = bboxOf(parts);
    if (bb.x1 - bb.x0 > W || bb.y1 - bb.y0 > H) return null;
    const off = { x: rand(0, W - (bb.x1 - bb.x0)) - bb.x0, y: rand(0, H - (bb.y1 - bb.y0)) - bb.y0 };
    if (anchor) {
      const part = pick(parts), box = bboxOf([part]);
      let local = centroid(part);
      // The headset need not be at a room's centre. Sample an interior point
      // so a room can extend away from someone standing near a boundary edge.
      for (let i = 0; i < 12; i++) {
        const candidate = { x: rand(box.x0, box.x1), y: rand(box.y0, box.y1) };
        if (insideConvex(candidate, part) && part.every((a, j) => distToSeg(candidate, a, part[(j + 1) % part.length]) >= .18)) { local = candidate; break; }
      }
      off.x = anchor.x - local.x;
      off.y = anchor.y - local.y;
    }
    const id = newId('r');
    return {
      piece: { id, kind: t.kind, template: t.name, parts: parts.map(p => p.map(v => add(v, off))) },
      slots: sh.slots.map(sl => ({ a: add(rot(sl.a, th), off), b: add(rot(sl.b, th), off), normal: rot(slotNormal(sl, sh.parts), th) })),
    };
  }

  // ---- the invariant
  function valid(newPieces: Piece[], newDoors: Door[]): boolean {
    for (const p of newPieces) if (!inBounds(p)) return false;
    const ps = [...pieces(), ...newPieces], ds = [...doors, ...newDoors];
    const st: Record<string, [string, string][]> = {};
    for (const p of ps) st[p.id] = seeThroughFor(p, ds, cache);
    const regions = computeVisibleRegions(ps, ds, st, cache);
    const newIds = new Set(newPieces.map(p => p.id));
    for (const reg of Object.values(regions)) {
      const ids = Object.keys(reg);
      for (const a of ids) {
        if (!newIds.has(a)) continue;
        for (const b of ids) if (a !== b && polysOverlap(reg[a], reg[b])) return false;
      }
    }
    return true;
  }
  function commit(c: { piece: Piece; slots: WSlot[] }, parent: string | null, door: Door | null) {
    committed = null;
    nodes.set(c.piece.id, { piece: c.piece, slots: c.slots, parent, children: 0 });
    if (door) { doors.push(door); nodes.get(parent!)!.children++; }
  }
  const mkDoor = (a: string, b: string, ex: Exit): Door => ({ id: newId('d'), a, b, p1: ex.p1, p2: ex.p2, normal: ex.normal });

  // ---- open doorways on a piece's slots (respecting other doors on the same slot line)
  function doorsOnSlot(id: string, s: WSlot): [number, number][] {
    const u = norm(sub(s.b, s.a));
    const out: [number, number][] = [];
    for (const d of doors) {
      if (d.a !== id && d.b !== id) continue;
      const c1 = Math.abs(u.x * (d.p1.y - s.a.y) - u.y * (d.p1.x - s.a.x)), c2 = Math.abs(u.x * (d.p2.y - s.a.y) - u.y * (d.p2.x - s.a.x));
      if (c1 > 1e-6 || c2 > 1e-6) continue;
      const t1 = dot(sub(d.p1, s.a), u), t2 = dot(sub(d.p2, s.a), u);
      out.push([Math.min(t1, t2), Math.max(t1, t2)]);
    }
    return out;
  }
  function freeExits(node: Node, preferDoorWalls: boolean): Exit[] {
    const res: Exit[] = [], withDoors: Exit[] = [];
    for (const s of node.slots) {
      const L = len(sub(s.b, s.a)), u = norm(sub(s.b, s.a));
      if (L < w - 1e-9) continue;
      const taken = doorsOnSlot(node.piece.id, s);
      if (L - w < 0.1) { if (!taken.some(([a, b]) => b > -1e-6 && a < L + 1e-6)) res.push({ p1: s.a, p2: add(s.a, mul(u, w)), normal: s.normal }); continue; }
      const blocks = taken.map(([a, b]) => [a - 0.15, b + 0.15] as [number, number]).sort((p, q) => p[0] - q[0]);
      const free: [number, number][] = [];
      let cur = 0.05;
      for (const [b0, b1] of blocks) { if (b0 - cur >= w) free.push([cur, b0]); cur = Math.max(cur, b1); }
      if (L - 0.05 - cur >= w) free.push([cur, L - 0.05]);
      for (const [f0, f1] of free) {
        // a few spots per free stretch: random, plus both ends (ends tuck exits into corners)
        const spots = new Set([rand(f0, f1 - w), f0, f1 - w].map(t => Math.round(t * 1e6) / 1e6));
        for (const t of spots) { const p1 = add(s.a, mul(u, t)); (taken.length ? withDoors : res).push({ p1, p2: add(p1, mul(u, w)), normal: s.normal }); }
      }
    }
    // drop doorways that open straight into the edge of the play space
    const roomy = (e: Exit) => { const c = add(e.p1, mul(sub(e.p2, e.p1), 0.5)), q = add(c, mul(e.normal, w)); return q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H; };
    for (const arr of [res, withDoors]) for (let i = arr.length - 1; i >= 0; i--) if (!roomy(arr[i])) arr.splice(i, 1);
    // same-wall exits are blind to each other: favor them (the Tea For God trick)
    const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    return preferDoorWalls ? [...shuffle(withDoors), ...shuffle(res)] : shuffle([...withDoors, ...res]);
  }

  // ---- attach through a doorway
  // Committed-state visible regions, for a cheap pre-check before the full one.
  let committed: Record<string, Record<string, Vec[][]>> | null = null;
  function committedRegions() {
    if (!committed) {
      const ps = pieces(), st: Record<string, [string, string][]> = {};
      for (const p of ps) st[p.id] = seeThroughFor(p, doors, cache);
      committed = computeVisibleRegions(ps, doors, st, cache);
    }
    return committed;
  }
  /** Necessary condition: the part of the newcomer right behind the door is visible from the parent. */
  function quickReject(parentId: string, piece: Piece, ex: Exit): boolean {
    const c = add(ex.p1, mul(sub(ex.p2, ex.p1), 0.5));
    const front = piece.parts.filter(q => q.some((v, i) => { const n = q[(i + 1) % q.length]; return distToSeg(c, v, n) < 1e-6; }));
    const reg = committedRegions()[parentId];
    for (const polys of Object.values(reg)) if (polysOverlap(front, polys)) return true;
    return false;
  }
  /** A hall must be able to continue: room for at least a small room past one of its exits. */
  function hallHasRoom(slots: WSlot[], entry: Exit): boolean {
    const ec = add(entry.p1, mul(sub(entry.p2, entry.p1), 0.5));
    return slots.some(sl => {
      const c = add(sl.a, mul(sub(sl.b, sl.a), 0.5));
      if (len(sub(c, ec)) < 1e-6) return false;
      const q = add(c, mul(sl.normal, roomMin));
      return q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H;
    });
  }
  function tryAttach(parentId: string, ex: Exit, order: Template[], maxTemplates: number): boolean {
    for (const t of order.slice(0, maxTemplates)) {
      for (const k of SCALES) for (let rep = 0; rep < 4; rep++) {     // shrink until it fits; several docking variants (entry slot, mirror) per size
        const c = dock(t, k, ex);
        if (!c || !inBounds(c.piece)) continue;
        if (t.kind === 'hall' && !hallHasRoom(c.slots, ex)) continue;
        if (quickReject(parentId, c.piece, ex)) continue;
        const door = mkDoor(parentId, c.piece.id, ex);
        if (valid([c.piece], [door])) { commit(c, parentId, door); queue.push(c.piece.id); return true; }
      }
    }
    return false;
  }
  function tryElevator(parentId: string, ex: Exit): boolean {
    const alA = dock(ALCOVE, 1, ex);
    if (!alA) return false;
    const doorA = mkDoor(parentId, alA.piece.id, ex);
    if (!valid([alA.piece], [doorA])) return false;
    if (P.stationaryElevators) {
      // There is no physical teleport: both cabins, normals and openings coincide.
      // Each cabin belongs to a separate visibility graph connected only by the ride.
      const alB = { piece: { ...alA.piece, id: newId('e') }, slots: alA.slots };
      const back: Exit = { p1: ex.p1, p2: ex.p2, normal: mul(ex.normal, -1) };
      for (let i = 0; i < 60; i++) {
        const room = dock(roomOrder()[0], SCALES[i % SCALES.length], back);
        if (!room) continue;
        const doorB = mkDoor(alB.piece.id, room.piece.id, back);
        if (!valid([alA.piece, alB.piece, room.piece], [doorA, doorB])) continue;
        commit(alA, parentId, doorA);
        committed = null;
        nodes.set(alB.piece.id, { ...alB, parent: alA.piece.id, children: 1 });
        nodes.set(room.piece.id, { ...room, parent: alB.piece.id, children: 0 });
        doors.push(doorB);
        portals.push({ id: newId('p'), a: alA.piece.id, b: alB.piece.id });
        queue.push(room.piece.id);
        return true;
      }
      return false;
    }
    for (let i = 0; i < 60; i++) {
      const rt = roomOrder()[0];
      const room = placeFree(rt, SCALES[i % SCALES.length]);
      if (!room) continue;
      const tmp: Node = { piece: room.piece, slots: room.slots, parent: null, children: 0 };
      const exB = freeExits(tmp, false)[0];
      if (!exB) continue;
      const alB = dock(ALCOVE, 1, exB);
      if (!alB) continue;
      const doorB = mkDoor(room.piece.id, alB.piece.id, exB);
      if (!valid([alA.piece, room.piece, alB.piece], [doorA, doorB])) continue;
      commit(alA, parentId, doorA);
      committed = null;
      nodes.set(room.piece.id, { piece: room.piece, slots: room.slots, parent: alA.piece.id, children: 1 });
      nodes.set(alB.piece.id, { piece: alB.piece, slots: alB.slots, parent: room.piece.id, children: 0 });
      doors.push(doorB);
      portals.push({ id: newId('p'), a: alA.piece.id, b: alB.piece.id });
      queue.push(room.piece.id);
      return true;
    }
    return false;
  }
  const retries = new Map<string, number>();
  function removeHall(id: string) {
    const node = nodes.get(id)!;
    nodes.delete(id);
    committed = null;
    doors = doors.filter(d => d.a !== id && d.b !== id);
    const parent = node.parent ? nodes.get(node.parent) : undefined;
    if (!parent) return;
    parent.children--;
    if (parent.piece.kind === 'room' && (retries.get(parent.piece.id) ?? 0) < 3) { retries.set(parent.piece.id, (retries.get(parent.piece.id) ?? 0) + 1); queue.push(parent.piece.id); }
    if (parent.piece.kind === 'hall' && parent.children === 0 && openHallExits(parent).length === 0) removeHall(parent.piece.id);
  }
  const openHallExits = (n: Node) => freeExits(n, false);

  // ---- start room
  const queue: string[] = [];
  for (let i = 0; i < 120 && !nodes.size; i++) {
    const c = placeFree(i > 60 ? TEMPLATE_BY_NAME['room-rect'] : roomOrder()[0], SCALES[Math.floor(i / 3) % SCALES.length], P.startAt);
    if (!c || !inBounds(c.piece)) continue;
    if (P.startAt && (!c.piece.parts.some(p => insideConvex(P.startAt!, p)) || wallSegments(c.piece, []).some(([a, b]) => distToSeg(P.startAt!, a, b) < 0.16))) continue;
    commit(c, null, null);
    if (!freeExits(nodes.get(c.piece.id)!, false).length) nodes.clear();   // no usable doorway: try again
  }
  if (!nodes.size) throw new Error('Play space too small for any room at this min width.');
  const startId = [...nodes.keys()][0];
  queue.push(startId);
  const target = Math.max(2, Math.round(P.pieceCount));

  // one pass over the frontier; once at target, only cap open halls with rooms
  function drain() {
    while (queue.length) {
      const id = queue.shift()!;
      const node = nodes.get(id);
      if (!node) continue;
      const atTarget = nodes.size >= target;
      if (node.piece.kind === 'room') {
        if (atTarget) continue;
        const wanted = 1 + (rng() < P.branchChance ? 1 : 0) + (rng() < P.branchChance * P.branchChance ? 1 : 0);
        for (let k = 0; k < wanted && nodes.size < target; k++) {
          const exits = freeExits(node, rng() < 0.6);
          let ok = false;
          for (const ex of exits.slice(0, 8)) { if (tryAttach(id, ex, weightedOrder(TEMPLATES), 12)) { ok = true; break; } }
          if (!ok) for (const ex of exits) { if (tryElevator(id, ex)) { ok = true; break; } }
          if (!ok) break;
        }
      } else if (node.piece.kind === 'hall') {
        for (const ex of openHallExits(node)) {
          const order = atTarget ? roomOrder() : weightedOrder(TEMPLATES);
          if (!tryAttach(id, ex, order, 12) && !atTarget) tryElevator(id, ex);
        }
        if (node.children === 0) removeHall(id);
      }
    }
  }
  drain();
  // rescue: if the frontier died early, give every room another go (newest first)
  for (let round = 0; round < 3 && nodes.size < target; round++) {
    for (const n of [...nodes.values()].filter(n => n.piece.kind === 'room').reverse()) { queue.push(n.piece.id); retries.set(n.piece.id, 0); }
    drain();
  }

  const finalPieces = pieces();
  const seeThrough: Record<string, [string, string][]> = {};
  for (const p of finalPieces) seeThrough[p.id] = seeThroughFor(p, doors, cache);
  const visibleRegions = computeVisibleRegions(finalPieces, doors, seeThrough, cache);
  const start = nodes.get(startId)!.piece;
  const big = start.parts.reduce((a, b) => (Math.abs(area(a)) >= Math.abs(area(b)) ? a : b));
  const level: Level = {
    version: 1, params: P, bounds: { w: W, h: H },
    pieces: finalPieces, doors, portals: portals.filter(p => nodes.has(p.a) && nodes.has(p.b)),
    seeThrough, visible: computeVisible(visibleRegions), visibleRegions, startPieceId: startId,
    startPos: P.startAt ? { ...P.startAt } : centroid(big),
  };
  if (finalPieces.length < target) level.warning = `Placed ${finalPieces.length} of ${target} pieces; no valid spot for more.`;
  return level;
}
function area(p: Vec[]) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
