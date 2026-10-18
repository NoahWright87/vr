import assert from 'node:assert/strict';
import test from 'node:test';
import { fitBoundaryRectangle, insidePolygon, polygonArea } from '../common/boundary-geometry.js';

const rect = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const rotate = (points, angle) => points.map(p => ({x:3 + p.x*Math.cos(angle)-p.y*Math.sin(angle), y:-2 + p.x*Math.sin(angle)+p.y*Math.cos(angle)}));

function verifyFit(polygon) {
  const fit = fitBoundaryRectangle(polygon);
  assert.ok(fit && fit.area > 0);
  // Independent dense probes across the rectangle, not just its corners.
  const [a, b, , d] = fit.points;
  for (let i=0;i<=24;i++) for (let j=0;j<=24;j++) {
    const p = {x:a.x+(b.x-a.x)*i/24+(d.x-a.x)*j/24, y:a.y+(b.y-a.y)*i/24+(d.y-a.y)*j/24};
    assert.ok(insidePolygon(p, polygon), JSON.stringify({p,fit}));
  }
  assert.ok(fit.area <= polygonArea(polygon) + 1e-6);
  return fit;
}

test('Boundary Lab fits the full measured rectangle at arbitrary tracking orientations', () => {
  for (const angle of [0, .261799, .392699, .785398, 1.19]) {
    const polygon=rotate(rect(4.7,2.1),angle), before=JSON.stringify(polygon);
    const fit=verifyFit(polygon);
    assert.ok(Math.abs(fit.area-9.87)<1e-6);
    assert.equal(JSON.stringify(polygon),before);
  }
});

test('an inscribed rectangle does not bridge an L or U shaped boundary', () => {
  const l=[{x:0,y:0},{x:5,y:0},{x:5,y:1.2},{x:1.2,y:1.2},{x:1.2,y:4},{x:0,y:4}];
  const u=[{x:0,y:0},{x:5,y:0},{x:5,y:5},{x:4,y:5},{x:4,y:1},{x:1,y:1},{x:1,y:5},{x:0,y:5}];
  for (const angle of [0,.37]) {
    const fit=verifyFit(rotate(l,angle));
    assert.ok(fit.area>5.3 && fit.area<=6+1e-6);
    verifyFit(rotate(u,angle));
  }
});

test('a 2mm notch is excluded even though all four corners of a bounding box are inside', () => {
  const polygon=[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:2.501,y:4},{x:2.501,y:.5},{x:2.499,y:.5},{x:2.499,y:4},{x:0,y:4}];
  assert.ok(rect(5,4).every(p=>insidePolygon(p,polygon)));
  const fit=verifyFit(polygon);
  assert.ok(!insidePolygon({x:2.5,y:2},fit.points));
  assert.ok(fit.area<=9.996+1e-6);
});

test('oblong, chamfered and irregular simple polygons remain contained in either winding', () => {
  const shapes=[rect(12,1.4),[{x:0,y:0},{x:3,y:0},{x:5,y:1},{x:4,y:4},{x:1,y:5},{x:-1,y:2}],
    [{x:0,y:0},{x:6,y:0},{x:6,y:1},{x:3,y:1},{x:3,y:3},{x:5,y:3},{x:5,y:5},{x:0,y:5}]];
  for (const polygon of shapes) for (const angle of [0,.23,.81]) {
    const rotated=rotate(polygon,angle);verifyFit(rotated);verifyFit([...rotated].reverse());
  }
});

test('invalid boundaries produce no fabricated fitted outline', () => {
  for (const polygon of [[],rect(0,2),[{x:0,y:0},{x:4,y:3},{x:0,y:3},{x:3,y:0}], [{x:0,y:0},{x:Infinity,y:0},{x:0,y:1}]]) {
    assert.equal(fitBoundaryRectangle(polygon),null);
  }
  const polygon=rect(3,2);polygon.push(polygon[0]);
  assert.ok(Math.abs(verifyFit(polygon).area-6)<1e-6);
});
