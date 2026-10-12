import assert from 'node:assert/strict';
import test from 'node:test';

import { writeSphere, writeCapsule, writeCone, writeCross, writeLine, VERTS } from '../common/debug-draw.js';

function points(buffer, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ x: buffer[i * 3], y: buffer[i * 3 + 1], z: buffer[i * 3 + 2] });
  return out;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

test('each writer uses exactly the vertex count VERTS promises', () => {
  const buf = new Float32Array(4096 * 3);
  const c = { x: 1, y: 2, z: 3 };
  assert.equal(writeLine(buf, 0, c, c), VERTS.line);
  assert.equal(writeSphere(buf, 0, c, 0.5, 12), VERTS.sphere(12));
  assert.equal(writeCapsule(buf, 0, c, { x: 1, y: 3, z: 3 }, 0.2, 12), VERTS.capsule(12));
  assert.equal(writeCone(buf, 0, c, { x: 0, y: 0, z: -1 }, 0.5, 2, 12), VERTS.cone(12));
  assert.equal(writeCross(buf, 0, c, 0.1), VERTS.cross);
  // Defaults too.
  assert.equal(writeSphere(buf, 0, c, 0.5), VERTS.sphere());
  assert.equal(writeCapsule(buf, 0, c, { x: 2, y: 2, z: 3 }, 0.2), VERTS.capsule());
});

test('a sphere is drawn on its radius', () => {
  const buf = new Float32Array(1024 * 3);
  const c = { x: 1, y: 2, z: 3 };
  const n = writeSphere(buf, 0, c, 0.5, 12);
  for (const p of points(buf, n)) assert.ok(Math.abs(dist(p, c) - 0.5) < 1e-5);
});

test('a capsule stays within radius of its segment and reaches both caps', () => {
  const buf = new Float32Array(2048 * 3);
  const a = { x: 0, y: 1, z: 0 };
  const b = { x: 0, y: 2, z: 0 };
  const n = writeCapsule(buf, 0, a, b, 0.25, 16);
  let top = -Infinity, bottom = Infinity;
  for (const p of points(buf, n)) {
    const y = Math.min(Math.max(p.y, 1), 2);
    assert.ok(Math.abs(Math.hypot(p.x, p.y - y, p.z) - 0.25) < 1e-5);
    top = Math.max(top, p.y);
    bottom = Math.min(bottom, p.y);
  }
  assert.ok(Math.abs(top - 2.25) < 1e-5 && Math.abs(bottom - 0.75) < 1e-5);
});

test('a cone opens at the requested half-angle', () => {
  const buf = new Float32Array(1024 * 3);
  const apex = { x: 0, y: 0, z: 0 };
  const n = writeCone(buf, 0, apex, { x: 0, y: 0, z: -1 }, Math.PI / 6, 2, 16);
  // The ring's points are at z = -2 and radius tan(30°)*2.
  const ring = points(buf, n).filter((p) => Math.abs(p.z + 2) < 1e-5);
  assert.ok(ring.length > 0);
  for (const p of ring) assert.ok(Math.abs(Math.hypot(p.x, p.y) - Math.tan(Math.PI / 6) * 2) < 1e-4);
});
