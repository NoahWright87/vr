import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../core/generator.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import { createRuntime, movePlayer, updateElevators, DEFAULTS, visiblePieceIds } from '../core/runtime.ts';
import { insideConvex, seamsBetween, centroid, lerpV } from '../core/geometry.ts';
import type { Level, Vec, Door } from '../core/types.ts';
import type { RuntimeState } from '../core/runtime.ts';

const DT = 1 / 60;
function step(level: Level, s: RuntimeState, target: Vec, max = 4000): boolean {
  let still = 0;
  for (let i = 0; i < max; i++) {
    const dx = target.x - s.pos.x, dy = target.y - s.pos.y, d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    const k = Math.min(0.02, d) / d, before = { ...s.pos };
    movePlayer(level, s, dx * k, dy * k);
    updateElevators(level, s, DT);
    still = Math.hypot(s.pos.x - before.x, s.pos.y - before.y) < 1e-9 ? still + 1 : 0;
    if (still > 40) return false;
  }
  return false;
}
/** Walk to `target` inside the active piece, hopping part to part through seam midpoints. */
function walkInside(level: Level, s: RuntimeState, target: Vec): boolean {
  const parts = level.pieces.find(p => p.id === s.activeId)!.parts;
  const from = parts.findIndex(q => insideConvex(s.pos, q, 1e-6)), to = parts.findIndex(q => insideConvex(target, q, 1e-6));
  if (from >= 0 && to >= 0 && from !== to) {
    // BFS over part adjacency
    const prev = new Map<number, number>([[from, -1]]), queue = [from];
    while (queue.length) { const i = queue.shift()!; for (let j = 0; j < parts.length; j++) if (!prev.has(j) && seamsBetween(parts[i], parts[j]).length) { prev.set(j, i); queue.push(j); } }
    const path: number[] = [];
    for (let x = to; x !== -1 && x !== undefined; x = prev.get(x)!) path.unshift(x);
    for (let k = 0; k + 1 < path.length; k++) {
      const [a, b] = seamsBetween(parts[path[k]], parts[path[k + 1]])[0];
      // go via the part's centre, then the seam midpoint (keeps clear of corners)
      if (!step(level, s, centroid(parts[path[k]]))) return false;
      if (!step(level, s, lerpV(a, b, 0.5))) return false;
    }
    if (!step(level, s, centroid(parts[to]))) return false;
  }
  return step(level, s, target);
}
function throughDoor(level: Level, s: RuntimeState, d: Door): boolean {
  const out = d.a === s.activeId ? d.normal : { x: -d.normal.x, y: -d.normal.y };
  const c = { x: (d.p1.x + d.p2.x) / 2, y: (d.p1.y + d.p2.y) / 2 };
  const back = DEFAULTS.radius + 0.1, fwd = DEFAULTS.radius + 0.25;
  if (!walkInside(level, s, { x: c.x - out.x * back, y: c.y - out.y * back })) return false;
  return step(level, s, { x: c.x + out.x * fwd, y: c.y + out.y * fwd });
}

function tour(level: Level): { reached: Set<string>; problems: string[] } {
  const s = createRuntime(level);
  const reached = new Set([s.activeId]), problems: string[] = [];
  const portalOf = new Map<string, string>();
  for (const p of level.portals) { portalOf.set(p.a, p.b); portalOf.set(p.b, p.a); }
  const visited = new Set<string>();
  const ride = (from: string): boolean => {
    if (!walkInside(level, s, centroid(level.pieces.find(p => p.id === from)!.parts[0]))) return false;
    for (let i = 0; i < 200 && s.activeId === from; i++) updateElevators(level, s, DT);
    return s.activeId === portalOf.get(from);
  };
  const dfs = (id: string) => {
    visited.add(id);
    if (portalOf.has(id) && !visited.has(portalOf.get(id)!)) {
      const other = portalOf.get(id)!;
      if (!ride(id)) { problems.push(`elevator ${id} didn't fire`); return; }
      reached.add(other); dfs(other);
      if (!ride(other)) { problems.push(`elevator ${other} didn't bring me back`); return; }
    }
    for (const d of level.doors) {
      if (d.a !== id && d.b !== id) continue;
      const nb = d.a === id ? d.b : d.a;
      if (visited.has(nb)) continue;
      const tpl = (x: string) => level.pieces.find(p => p.id === x)!.template;
      if (!throughDoor(level, s, d) || s.activeId !== nb) { problems.push(`couldn't walk ${id} (${tpl(id)}) -> ${nb} (${tpl(nb)})`); continue; }
      reached.add(nb); dfs(nb);
      if (!throughDoor(level, s, d) || s.activeId !== id) problems.push(`couldn't walk back ${nb} (${tpl(nb)}) -> ${id} (${tpl(id)})`);
    }
  };
  dfs(s.activeId);
  return { reached, problems };
}

test('every piece is reachable on foot (and by elevator), and you can always walk back', () => {
  let walked = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const lv = generateLevel({ boundsW: 6 + (seed % 5), boundsH: 5 + (seed % 4), minWidth: 0.9 + (seed % 3) * 0.2, mix: DEFAULT_MIX,
      pieceCount: 8 + (seed % 7), minSizePct: 4, maxSizePct: 22, branchChance: (seed % 5) / 8, seed });
    const { reached, problems } = tour(lv);
    assert.deepEqual(problems, [], `seed ${seed}`);
    assert.equal(reached.size, lv.pieces.length, `seed ${seed}: reached ${reached.size}/${lv.pieces.length}`);
    walked += lv.pieces.length;
  }
  assert.ok(walked > 200);
});

test('elevator: charge resets if you step out, no re-fire until you fully leave', () => {
  let tested = 0;
  for (let seed = 1; seed < 400 && tested < 5; seed++) {
    const lv = generateLevel({ boundsW: 6, boundsH: 5, minWidth: 1, mix: DEFAULT_MIX, pieceCount: 10, minSizePct: 6, maxSizePct: 22, branchChance: 0.2, seed });
    if (!lv.portals.length) continue;
    const portal = lv.portals[0];
    const d = lv.doors.find(x => x.a === portal.a || x.b === portal.a)!;
    const parent = d.a === portal.a ? d.b : d.a;
    const s = createRuntime(lv);
    s.activeId = parent;
    const out = d.a === parent ? d.normal : { x: -d.normal.x, y: -d.normal.y };
    const c = { x: (d.p1.x + d.p2.x) / 2, y: (d.p1.y + d.p2.y) / 2 };
    s.pos = { x: c.x - out.x * 0.3, y: c.y - out.y * 0.3 };
    const al = centroid(lv.pieces.find(p => p.id === portal.a)!.parts[0]);
    assert.ok(step(lv, s, al, 400), 'walk into alcove');
    for (let i = 0; i < 30; i++) updateElevators(lv, s, DT);
    assert.ok(s.elevators[portal.a].charge > 0.3 && s.doorsClosed);
    assert.deepEqual(visiblePieceIds(lv, s), [portal.a], 'doors closed -> only the alcove is visible');
    step(lv, s, { x: c.x + out.x * 0.05, y: c.y + out.y * 0.05 }, 400);
    assert.equal(s.elevators[portal.a].charge, 0, 'stepping partly out resets the charge');
    assert.ok(step(lv, s, al, 400));
    for (let i = 0; i < 120 && s.activeId === portal.a; i++) updateElevators(lv, s, DT);
    assert.equal(s.activeId, portal.b, 'teleported');
    for (let i = 0; i < 300; i++) updateElevators(lv, s, DT);
    assert.equal(s.activeId, portal.b, 'no re-fire while standing in the arrival alcove');
    tested++;
  }
  assert.ok(tested >= 3, `only found ${tested} levels with elevators`);
});
