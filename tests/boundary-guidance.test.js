import assert from 'node:assert/strict';
import test from 'node:test';
import { planGuidance, rayBoundary } from '../games/expansive-spaces/boundary-guidance.js';
import { OverlapPlanner, overlapFrame, chooseOverlapRotation } from '../games/expansive-spaces/overlap-planner.js';
import { sanitizeRedirectionSettings, rotateXZ } from '../games/expansive-spaces/redirection.js';
import { prepareFloor, intersectionArea, moveFloor } from '../common/floor-overlap.js';

const rect = (w,d,x=0,z=0) => [{x:x-w/2,z:z-d/2},{x:x+w/2,z:z-d/2},{x:x+w/2,z:z+d/2},{x:x-w/2,z:z+d/2}];
const boundary=rect(2,10), settings=sanitizeRedirectionSettings();
const context={boundary,physicalFloor:prepareFloor(boundary),area:{id:'hall',floor:prepareFloor(rect(3,15))},mapping:{yaw:0,x:0,z:0}};
const plan=(p,h=0,s=1,ctx=context)=>planGuidance(p,h,s,ctx,settings,new OverlapPlanner(),1000);
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('the obstacle ahead wins over nearer walls behind or alongside',()=>{
  close(rayBoundary({x:.9,z:0},0,boundary).distance,5);
  close(rayBoundary({x:.9,z:0},-Math.PI/2,boundary).distance,.1);
  assert.equal(plan({x:.9,z:0},0).urgency,0);
});
test('parallel but displaced rectangles recover from a thin strip using the actual head pivot',()=>{
  const ctx={...context,mapping:{yaw:0,x:2,z:0}}, p={x:-.8,z:0}, goal=plan(p,0,0,ctx);
  close(goal.overlap,.25); close(goal.bestOverlap,1);
  assert.ok(Math.abs(goal.correction)>160*Math.PI/180);
  close(intersectionArea(prepareFloor(goal.targetFootprint),ctx.area.floor),20);
  const wrong=moveFloor(overlapFrame(p,ctx).floor,goal.correction,{x:0,z:0});
  assert.ok(intersectionArea(wrong,ctx.area.floor)<10);
});
test('matching axes alone cannot hide lost usable floor',()=>{
  assert.equal(plan({x:-.8,z:0},0,0).correction,0);
  const offset=plan({x:-.8,z:0},0,0,{...context,mapping:{yaw:0,x:2,z:0}});
  assert.ok(offset.bestOverlap>offset.overlap+.7);
});
test('physical wall avoidance cannot sacrifice full overlap',()=>{
  const goal=plan({x:.95,z:0},-Math.PI/2,2);
  assert.ok(goal.urgency>.99); close(goal.overlap,1);close(goal.bestOverlap,1);
  close(intersectionArea(prepareFloor(goal.targetFootprint),context.area.floor),20,.00001);
});
test('speed changes wall urgency without replacing the overlap objective',()=>{
  const slow=plan({x:0,z:2},Math.PI,.7),fast=plan({x:0,z:2},Math.PI,3);
  assert.equal(slow.urgency,0);assert.ok(fast.urgency>.3);close(fast.bestOverlap,1);
});
test('current-area shape changes the goal without changing physical geometry',()=>{
  const goal=plan({x:0,z:0},0,0,{...context,area:{id:'cross-hall',floor:prepareFloor(rect(15,3))}});
  close(goal.overlap,.3);close(goal.bestOverlap,1);assert.equal(goal.areaId,'cross-hall');
  assert.ok(Math.abs(goal.correction)>70*Math.PI/180);close(goal.wallDistance,5);
});
test('rotated and translated reference spaces preserve overlap decisions',()=>{
  const yaw=.8,offset={x:20,z:-7},p={x:-.8,z:0};
  const transform=p=>{const r=rotateXZ(p,yaw);return{x:r.x+offset.x,z:r.z+offset.z};};
  const original=plan(p,0,0,{...context,mapping:{yaw:0,x:2,z:0}});
  const b=boundary.map(transform),t=rotateXZ({x:2,z:0},yaw);
  const changed=plan(transform(p),yaw,0,{boundary:b,physicalFloor:prepareFloor(b),
    area:{id:'hall',floor:prepareFloor(context.area.floor.points.map(transform))},mapping:{yaw:0,...t}});
  close(original.overlap,changed.overlap);close(original.bestOverlap,changed.bestOverlap);
  close(original.correction,changed.correction,.005);
});
test('concave polygons and either winding count genuinely walkable space',()=>{
  const shape=[{x:0,z:0},{x:3,z:0},{x:3,z:1},{x:1,z:1},{x:1,z:3},{x:0,z:3}];
  for(const boundary of [shape,[...shape].reverse()]){
    close(rayBoundary({x:.5,z:2},-Math.PI/2,boundary).distance,.5);
    const floor=prepareFloor(boundary),goal=plan({x:.5,z:2},0,0,{boundary,physicalFloor:floor,area:{id:'L',floor},mapping:{yaw:0,x:0,z:0}});
    close(goal.overlap,1);assert.equal(goal.correction,0);
  }
});
test('missing boundary or area and invalid tracking positions cannot request turns',()=>{
  assert.equal(plan({x:2,z:0}).valid,false);
  assert.equal(plan({x:0,z:0},0,1,null).correction,0);
  assert.equal(plan({x:0,z:0},0,1,{...context,area:null}).valid,false);
  assert.equal(plan({x:0,z:0},null).valid,false);
});
test('stationary glances do not invent a collision course',()=>{
  const goal=plan({x:.8,z:0},-Math.PI/2,0);assert.equal(goal.urgency,0);assert.equal(goal.correction,0);
});
test('combined nudges cannot cross the permitted overlap floor',()=>{
  const planner=new OverlapPlanner(),goal=planner.sample({x:0,z:0},context,0,{heading:0,urgency:0});
  const limited=planner.limitYaw(Math.PI/2,goal.minimumOverlap);
  const after=moveFloor(planner.frame.floor,limited,{x:0,z:0},planner.frame.pivot);
  assert.ok(Math.abs(limited)<.15);assert.ok(intersectionArea(after,context.area.floor)/20>=1-1.1e-7);
});
test('a committed route can cross local peaks without worsening its starting overlap',()=>{
  const ctx={...context,mapping:{yaw:0,x:2,z:0}},frame=overlapFrame({x:-.8,z:0},ctx),best=chooseOverlapRotation(frame);
  for(let i=1;i<=360;i++){
    const step=moveFloor(frame.floor,best.delta*i/360,{x:0,z:0},frame.pivot);
    assert.ok(intersectionArea(step,ctx.area.floor)/20>=frame.fraction-1e-7);
  }
  close(best.fraction,1);
});
