import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareFloor,intersectionArea,moveFloor,signedArea,containsPoint,sameFloorTransform} from '../common/floor-overlap.js';
const rect=(x1,z1,x2,z2)=>[{x:x1,z:z1},{x:x2,z:z1},{x:x2,z:z2},{x:x1,z:z2}];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('rectangle intersection measures area, not aligned axes or bounding boxes',()=>{
  const a=prepareFloor(rect(-1,-5,1,5));
  close(intersectionArea(a,prepareFloor(rect(.9,-5,3,5))),1);
  close(intersectionArea(a,prepareFloor(rect(-2,-10,2,10))),20);
  close(intersectionArea(a,prepareFloor(rect(1,-5,3,5))),0);
});
test('concave triangulation excludes the unwalkable corner and preserves area',()=>{
  const points=[{x:0,z:0},{x:3,z:0},{x:3,z:1},{x:1,z:1},{x:1,z:3},{x:0,z:3}];
  for(const shape of [points,[...points].reverse()]){
    const floor=prepareFloor(shape);close(floor.area,5);close(floor.parts.reduce((sum,p)=>sum+signedArea(p),0),5);
    close(intersectionArea(floor,prepareFloor(rect(1.5,1.5,2.5,2.5))),0);
    close(intersectionArea(floor,prepareFloor(rect(.5,.5,2.5,2.5))),1.75);
  }
});
test('duplicate, closed and collinear vertices retain correct boundaries',()=>{
  const floor=prepareFloor([...rect(0,0,2,2),{x:0,z:1},{x:0,z:0}]);close(floor.area,4);
  assert.equal(containsPoint({x:0,z:1},floor.points),true);
  assert.equal(prepareFloor([{x:0,z:0},{x:1,z:0},{x:2,z:0}]),null);
  assert.equal(prepareFloor([{x:NaN,z:0}]),null);
});
test('rotation about an off-center head preserves area and uses the supplied pivot',()=>{
  const a=prepareFloor(rect(-1,-5,1,5)),b=moveFloor(a,Math.PI,{x:0,z:0},{x:.8,z:0});
  close(b.area,20);close(b.points[0].x,2.6);close(b.points[0].z,5);
});
test('floor geometry caches ignore tracking jitter and height, but detect meaningful reference changes',()=>{
  const a={elements:Array.from({length:16},(_,i)=>i%5===0?1:0)},b={elements:[...a.elements]};
  b.elements[13]=2;b.elements[12]=.000001;assert.equal(sameFloorTransform(a,b),true);
  b.elements[12]=.001;assert.equal(sameFloorTransform(a,b),false);
});
