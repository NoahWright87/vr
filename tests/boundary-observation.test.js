import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundaryObservation } from '../games/boundaries/boundary-observation.js';

const rectangle=[{x:0,y:0,z:0},{x:4,y:0,z:0},{x:4,y:0,z:2},{x:0,y:0,z:2}];
test('boundary observation records initial delay, repeated identical geometry, and late changes',()=>{
  const o=new BoundaryObservation();
  o.sample(1000,[]);o.sample(2000,[]);o.sample(4000,rectangle);o.sample(32000,rectangle);
  o.sample(33000,[...rectangle,{x:1,y:0,z:1}]);
  assert.equal(o.frames,5);assert.equal(o.emptyFrames,2);assert.equal(o.firstGeometrySeconds,3);
  assert.equal(o.changes,2);assert.equal(o.maxCorners,5);assert.equal(o.history.length,3);
  assert.match(o.text(),/32 s · 5 frames · 5 corners/);
  assert.match(o.text(),/First geometry: 3.00 s/);
  rectangle[0].x=9;assert.equal(o.points[0].x,0);rectangle[0].x=0;
});
test('invalid geometry is empty and change history stays bounded',()=>{
  const o=new BoundaryObservation();
  o.sample(0,[...rectangle,{x:NaN,y:0,z:0}]);assert.equal(o.corners,0);assert.equal(o.firstGeometrySeconds,null);
  for(let i=1;i<=100;i++)o.sample(i*1000,rectangle.map(p=>({...p,x:p.x+i})));
  assert.equal(o.changes,100);assert.equal(o.history.length,50);
});
