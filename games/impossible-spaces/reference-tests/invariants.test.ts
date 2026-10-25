import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../core/generator.ts';
import { DEFAULT_MIX, TEMPLATES } from '../core/templates.ts';
import { piecesOverlap, pieceInBounds, distPointSeg, convexWidth, edgesOf, polysOverlap, insideConvex, wallSegments, raySeg } from '../core/geometry.ts';
import { createRuntime, renderWalls } from '../core/runtime.ts';
import { rebalance } from '../core/mix.ts';
import { traceHits, traceVisibleFrom, traceFirstWall, viewpoints } from './truth.ts';
import type { GenParams, Level } from '../core/types.ts';

function randomParams(seed: number): GenParams {
  let a = seed * 9301 + 49297; const r = () => ((a = (a * 233280 + 1) % 2147483647) / 2147483647);
  const minSizePct = 3 + r() * 15;
  const mix: Record<string, number> = {};
  for (const t of TEMPLATES) mix[t.name] = r() < 0.15 ? 0 : 1 + r() * 10;      // random mixes, some shapes switched off
  return { boundsW: 6 + r() * 6, boundsH: 5 + r() * 5, minWidth: 0.85 + r() * 0.4, mix, pieceCount: 6 + Math.floor(r() * 10),
    minSizePct, maxSizePct: minSizePct + 5 + r() * 20, branchChance: r() * 0.6, seed };
}
const LEVELS: Level[] = Array.from({ length: 40 }, (_, i) => generateLevel(randomParams(i + 1)));

test('deterministic: same seed, same level', () => {
  const p = randomParams(42);
  assert.equal(JSON.stringify(generateLevel(p)), JSON.stringify(generateLevel(p)));
});

test('everything inside the play space; rooms and hall runs no narrower than the comfort floor', () => {
  for (const lv of LEVELS) for (const p of lv.pieces) {
    assert.ok(pieceInBounds(p, lv.bounds.w, lv.bounds.h), `${p.id} out of bounds`);
    // corner joints (45° bends, Y splits) are exempt; everything else must be at least min width across
    p.parts.forEach((part, i) => { if (!p.joints?.includes(i)) assert.ok(convexWidth(part) >= lv.params.minWidth - 1e-6, `seed ${lv.params.seed}: ${p.id} (${p.template}) part too narrow`); });
  }
});

test('every wall sits on the 45° lattice', () => {
  for (const lv of LEVELS) for (const p of lv.pieces) for (const part of p.parts) for (const [a, b] of edgesOf(part)) {
    const k = Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4);
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${p.id} has an off-lattice edge`);
  }
});

test('doors line up: each door lies on an edge of both pieces it joins, at full comfort width', () => {
  for (const lv of LEVELS) for (const d of lv.doors) {
    const width = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
    assert.ok(Math.abs(width - lv.params.minWidth) < 1e-6, `door ${d.id} width ${width}`);
    for (const id of [d.a, d.b]) {
      const piece = lv.pieces.find(p => p.id === id)!;
      const ok = piece.parts.some(part => edgesOf(part).some(([a, b]) => distPointSeg(d.p1, a, b) < 1e-6 && distPointSeg(d.p2, a, b) < 1e-6));
      assert.ok(ok, `seed ${lv.params.seed}: door ${d.id} not on an edge of ${id}`);
    }
  }
});

test('THE GUARANTEE (a): from every piece, the visible regions of different pieces never overlap', () => {
  for (const lv of LEVELS) for (const [pid, reg] of Object.entries(lv.visibleRegions)) {
    const ids = Object.keys(reg);
    for (const a of ids) for (const b of ids) if (a < b) assert.ok(!polysOverlap(reg[a], reg[b]), `seed ${lv.params.seed}: from ${pid}, visible parts of ${a} and ${b} overlap`);
  }
});

test('THE GUARANTEE (b): real rays through doorways never reach a piece outside the visible set', () => {
  let checks = 0;
  for (const lv of LEVELS.slice(0, 20)) for (const p of lv.pieces) {
    const allowed = new Set(lv.visible[p.id]);
    for (const vp of viewpoints(lv, p.id)) {
      for (const s of traceVisibleFrom(lv, p.id, vp, 360, 0.01)) assert.ok(allowed.has(s), `seed ${lv.params.seed}: from ${p.id} a ray reached ${s}`);
      checks++;
    }
  }
  assert.ok(checks > 500);
});

test('THE GUARANTEE (c): every point a real ray reaches lies inside the declared visible region', () => {
  let points = 0;
  for (const lv of LEVELS.slice(0, 20)) for (const p of lv.pieces) {
    const reg = lv.visibleRegions[p.id];
    for (const vp of viewpoints(lv, p.id)) for (const [pid, pts] of traceHits(lv, p.id, vp, 240, 0.02)) {
      const rs = reg[pid];
      assert.ok(rs, `seed ${lv.params.seed}: ${pid} seen from ${p.id} but not declared`);
      for (const q of pts) {
        points++;
        assert.ok(rs.some(r => insideConvex(q, r, 0.03)), `seed ${lv.params.seed}: from ${p.id}, a ray reached (${q.x.toFixed(2)},${q.y.toFixed(2)}) in ${pid} (${lv.pieces.find(x => x.id === pid)!.template}) outside its declared visible region`);
      }
    }
  }
  assert.ok(points > 100000);
});

test('the illusion is actually used: pieces outside each other\'s view share floor space', () => {
  let overlaps = 0;
  for (const lv of LEVELS) for (let i = 0; i < lv.pieces.length; i++) for (let j = i + 1; j < lv.pieces.length; j++) if (piecesOverlap(lv.pieces[i], lv.pieces[j])) overlaps++;
  assert.ok(overlaps > 50, `only ${overlaps} overlapping pairs`);
});

test('rendering: hidden walls never block the view (aimed at every hidden wall inside another visible region)', () => {
  let targeted = 0, bad = 0;
  for (const lv of LEVELS) for (const [x, reg] of Object.entries(lv.visibleRegions)) for (const y of Object.keys(reg)) {
    for (const [a, b] of wallSegments(lv.pieces.find(p => p.id === y)!, lv.doors)) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (reg[y].some(r => insideConvex(m, r, 1e-6))) continue;                       // not hidden
      if (!Object.entries(reg).some(([z, rs]) => z !== y && rs.some(r => insideConvex(m, r, -1e-3)))) continue;
      const s = createRuntime(lv); s.activeId = x;
      for (const vp of viewpoints(lv, x)) {
        const dx = m.x - vp.x, dy = m.y - vp.y, d = Math.hypot(dx, dy), dir = { x: dx / d, y: dy / d };
        if (traceFirstWall(lv, x, vp, dir) < d + 0.05) continue;                         // spot not actually visible from here
        s.pos = vp; targeted++;
        let best = Infinity;
        for (const [p1, p2] of renderWalls(lv, s).flatMap(w => w.walls)) { const t = raySeg(vp, dir, p1, p2); if (t !== null && t < best) best = t; }
        if (best < d + 0.02) bad++;
      }
    }
  }
  assert.ok(targeted > 30, `only ${targeted} targeted rays`);
  assert.equal(bad, 0, `${bad}/${targeted} rays blocked by a hidden wall`);
});

test('mix: shapes switched off never appear; every shape does appear when switched on', () => {
  const seen = new Set<string>();
  for (const lv of LEVELS) for (const p of lv.pieces) {
    if (p.kind === 'elevator') continue;
    seen.add(p.template);
    const capRoom = p.template === 'room-rect' && !TEMPLATES.some(t => t.kind === 'room' && (lv.params.mix[t.name] ?? 0) > 0);
    assert.ok((lv.params.mix[p.template] ?? 0) > 0 || capRoom, `seed ${lv.params.seed}: ${p.template} appeared with weight 0`);
  }
  for (let s = 1; s <= 30 && seen.size < TEMPLATES.length; s++)
    for (const p of generateLevel({ boundsW: 12, boundsH: 10, minWidth: 0.9, mix: DEFAULT_MIX, pieceCount: 16, minSizePct: 3, maxSizePct: 12, branchChance: 0.5, seed: s }).pieces) seen.add(p.template);
  for (const t of TEMPLATES) assert.ok(seen.has(t.name), `${t.name} never placed`);
});

test('mix: the placed mix follows the sliders', () => {
  const only = { 'room-rect': 50, 'hall-l': 50 };
  let rooms = 0, halls = 0;
  for (let s = 1; s <= 10; s++) for (const p of generateLevel({ boundsW: 9, boundsH: 7, minWidth: 1, mix: only, pieceCount: 12, minSizePct: 4, maxSizePct: 15, branchChance: 0.3, seed: s }).pieces) {
    assert.ok(['room-rect', 'hall-l', 'alcove'].includes(p.template), p.template);
    if (p.template === 'hall-l') halls++; else if (p.template === 'room-rect') rooms++;
  }
  assert.ok(halls > 0.25 * (rooms + halls), `halls ${halls} vs rooms ${rooms}`);
});

test('linked sliders: always sum to 100, locked ones never move, others scale proportionally', () => {
  const w = { a: 40, b: 30, c: 20, d: 10 };
  const r1 = rebalance(w, new Set(), 'a', 60);
  assert.ok(Math.abs(Object.values(r1).reduce((x, y) => x + y) - 100) < 1e-9);
  assert.ok(Math.abs(r1.b / r1.c - 1.5) < 1e-9, 'proportional');
  const r2 = rebalance(w, new Set(['b']), 'a', 90);
  assert.equal(r2.b, 30); assert.equal(r2.a, 70, 'capped by the locked weight');
  assert.ok(Math.abs(r2.c) < 1e-9 && Math.abs(r2.d) < 1e-9);
  const r3 = rebalance({ a: 100, b: 0, c: 0 }, new Set(), 'a', 40);
  assert.ok(Math.abs(r3.b - 30) < 1e-9 && Math.abs(r3.c - 30) < 1e-9, 'zeros split equally');
});
