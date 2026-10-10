import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorDrawing, segmentInside, validateFloor } from '../games/boundaries/floor-drawing.js';
const rect=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
const l=[{x:0,y:0},{x:4,y:0},{x:4,y:1},{x:1,y:1},{x:1,y:4},{x:0,y:4}];
test('L-shaped manual outlines work in a 4.7 by 2.1 reported rectangle',()=>{
  assert.equal(validateFloor([{x:.1,y:.1},{x:4.5,y:.1},{x:4.5,y:.8},{x:1,y:.8},{x:1,y:2},{x:.1,y:2}],rect),'');
  assert.equal(validateFloor(rect,rect),'');
});
test('full edges stay inside concave boundaries, including a 2mm notch',()=>{
  assert.equal(segmentInside({x:3,y:.5},{x:.5,y:3},l),false);
  assert.equal(segmentInside({x:.5,y:.5},{x:.5,y:3},l),true);
  const notch=[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:2.001,y:4},{x:2.001,y:1},{x:1.999,y:1},{x:1.999,y:4},{x:0,y:4}];
  assert.equal(segmentInside({x:.5,y:2},{x:3.5,y:2},notch),false);
  assert.equal(segmentInside({x:.5,y:1},{x:3.5,y:1},notch),true);
});
test('outside, crossed, overlapping and degenerate previews cannot be accepted',()=>{
  assert.match(validateFloor([{x:.1,y:.1},{x:5,y:.1},{x:.1,y:1}],rect),/Outside/);
  assert.match(validateFloor([{x:.1,y:.1},{x:2,y:1},{x:.1,y:1},{x:2,y:.1}],rect),/crosses/);
  assert.match(validateFloor([{x:.1,y:.1},{x:.1,y:.1},{x:2,y:1}],rect),/overlap/);
  assert.match(validateFloor([{x:.1,y:.1},{x:2,y:.1},{x:1,y:.1}],rect),/doubles back/);
  assert.match(validateFloor([{x:NaN,y:0},{x:2,y:.1},{x:1,y:1}],rect),/Invalid/);
  assert.match(validateFloor([{x:.1,y:.1},{x:.11,y:.1},{x:.1,y:.11}],rect),/too small/);
});
test('stroke undo, corner editing and clearing preserve reviewable history',()=>{
  const d=new FloorDrawing();d.checkpoint();d.add({x:.1,y:.1});d.add({x:2,y:.1});
  d.checkpoint();d.add({x:2,y:1});d.add({x:.1,y:1});d.undo();
  assert.equal(d.points.length,2);d.checkpoint();d.add({x:2,y:1});d.add({x:.1,y:1});d.finish();
  assert.equal(d.accept(rect),'');assert.equal(d.saved,true);
  d.checkpoint();d.points[d.nearest({x:2,y:1})]={x:5,y:1};
  assert.match(d.accept(rect),/Outside/);assert.equal(d.saved,false);
  d.undo();assert.equal(d.accept(rect),'');d.clear();assert.equal(d.points.length,0);
  d.undo();assert.equal(d.points.length,4);assert.equal(d.closed,true);assert.equal(d.saved,false);
});
test('freehand samples reduce straight strokes but retain corners and close cleanly',()=>{
  const d=new FloorDrawing();d.checkpoint();
  for(let x=.1;x<2;x+=.04)d.add({x,y:.1});
  assert.equal(d.points.length,2);d.add({x:2,y:1});d.add({x:.1,y:1});d.add({x:.1,y:.1});d.finish();
  assert.equal(d.points.length,4);assert.equal(d.accept(rect),'');
  d.undo();assert.equal(d.closed,false);
});
