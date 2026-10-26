import assert from 'node:assert/strict';
import test from 'node:test';
import {RedirectionTracker,LocomotionTransform,rotateXZ,wrapYaw,sanitizeRedirectionSettings} from '../games/expansive-spaces/redirection.js';
import {prepareFloor} from '../common/floor-overlap.js';
import {overlapFrame} from '../games/expansive-spaces/overlap-planner.js';

const RAD=Math.PI/180,close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const rectangle=(w,d)=>[{x:-w/2,z:-d/2},{x:w/2,z:-d/2},{x:w/2,z:d/2},{x:-w/2,z:d/2}];
const boundary=rectangle(2,10),physicalFloor=prepareFloor(boundary),area={id:'hall',floor:prepareFloor(rectangle(3,15))};
function fixture(settings={},mapping={x:2,z:0,yaw:0}){
  const tracker=new RedirectionTracker(settings),transform=new LocomotionTransform();Object.assign(transform,mapping);
  const context=()=>({boundary,physicalFloor,area,mapping:{x:transform.x,z:transform.z,yaw:transform.yaw}});
  const sample=(p,yaw,time,paused=false)=>{
    const r=tracker.sample(p,yaw,time,{context:context(),paused});transform.apply(p,0,0,r.yawDelta);return r;
  };
  return{tracker,transform,context,sample};
}
function run({speed=0,turnRate=0,settings={},hz=90,seconds=2,mapping}={}){
  const f=fixture(settings,mapping);let total=0,absoluteTotal=0,last;
  f.sample({x:-.8,z:0},0,0);
  for(let i=1;i<=Math.round(seconds*hz);i++){
    last=f.sample({x:-.8,z:-speed*i/hz},wrapYaw(turnRate*RAD*i/hz),i*1000/hz);total+=last.yawDelta;absoluteTotal+=Math.abs(last.yawDelta);
  }
  return{...f,total,absoluteTotal,last};
}
test('both effects default off despite poor overlap, fast walking and head turns',()=>{
  assert.equal(run({speed:3,turnRate:300}).total,0);
  assert.equal(sanitizeRedirectionSettings().steeringEnabled,false);
  assert.equal(sanitizeRedirectionSettings().turnEnabled,false);
});
test('slow looks remain 1:1; opposite fast looks gain or lose rotation toward the same fit',()=>{
  const settings={turnEnabled:true,maxTurnGain:200/180,turnSpeed:180};
  assert.equal(run({turnRate:30,settings}).total,0);
  const left=run({turnRate:360,settings,seconds:.5}),right=run({turnRate:-360,settings,seconds:.5});
  assert.ok(left.total>18*RAD&&left.total<20*RAD);assert.ok(right.total>0);
  close(left.last.turnGain,200/180);close(right.last.turnGain,.9);
});
test('full-turn-speed control changes available correction without changing the overlap objective',()=>{
  const fast=run({turnRate:120,settings:{turnEnabled:true,maxTurnGain:1.3,turnSpeed:90},seconds:.5});
  const slow=run({turnRate:120,settings:{turnEnabled:true,maxTurnGain:1.3,turnSpeed:300},seconds:.5});
  assert.ok(fast.total>slow.total*2);assert.ok(fast.tracker.guidance.bestOverlap>.99);
});
test('yaw wrapping does not inject a spurious full revolution',()=>{
  const f=fixture({turnEnabled:true,maxTurnGain:1.2,turnSpeed:60});
  f.sample({x:-.8,z:0},179*RAD,0);
  const r=f.sample({x:-.8,z:0},-179*RAD,10);assert.ok(r.yawDelta>=0&&r.yawDelta<.4*RAD);
});
test('walking recovery uses physical speed and its own rate cap',()=>{
  const settings={steeringEnabled:true,maxCurvature:5,steeringSpeed:2,maxSteeringRate:6};
  assert.equal(run({speed:.6,settings}).total,0);
  const fast=run({speed:3,settings,seconds:1});assert.ok(Math.abs(fast.last.steeringRate)>.1&&Math.abs(fast.last.steeringRate)<=6);
  const slow=run({speed:1.2,settings:{...settings,steeringSpeed:3},seconds:1});assert.ok(slow.absoluteTotal<fast.absoluteTotal/3);
});
test('stopping and the watch do not coast or bank yaw',()=>{
  const f=fixture({steeringEnabled:true,turnEnabled:true});f.sample({x:-.8,z:0},0,0);
  for(let i=1;i<=50;i++)f.sample({x:-.8,z:-.02*i},i*.03,i*10);
  assert.equal(f.sample({x:-.8,z:-1},1.5,510).yawDelta,0);
  assert.equal(f.sample({x:-.8,z:-1.02},1.53,520,true).yawDelta,0);
});
test('gaps, invalid yaw and tracking jumps cannot amplify discontinuities',()=>{
  const f=fixture({steeringEnabled:true,turnEnabled:true});f.sample({x:-.8,z:0},0,0);
  assert.equal(f.sample({x:20,z:0},1,10).yawDelta,0);
  assert.equal(f.sample({x:20,z:0},2,1000).yawDelta,0);
  f.tracker.reset();assert.equal(f.sample({x:-.8,z:0},null,1100).yawDelta,0);
  assert.equal(f.sample({x:-.8,z:0},2,1110).yawDelta,0);
  assert.equal(f.tracker.sample({x:NaN,z:0},2,1120).yawDelta,0);
});
test('walking and turn toggles remain independent',()=>{
  const f=run({speed:2,turnRate:180,settings:{steeringEnabled:true,turnEnabled:true},seconds:.5});
  f.tracker.setSettings({steeringEnabled:false});
  const onlyTurn=f.sample({x:-.8,z:-1.02},91.8*RAD,510);assert.equal(onlyTurn.steeringRate,0);assert.ok(onlyTurn.yawDelta>0);
  f.tracker.setSettings({turnEnabled:false});assert.equal(f.sample({x:-.8,z:-1.04},93.6*RAD,520).yawDelta,0);
});
test('off-origin head pivot and metric hand reach are preserved',()=>{
  const t=new LocomotionTransform(),head={x:3,z:-2},hand={x:3.4,z:-2};t.apply(head,0,0,Math.PI/2);
  const h=rotateXZ(head,t.yaw),arm=rotateXZ(hand,t.yaw);close(h.x+t.x,head.x);close(h.z+t.z,head.z);
  close(Math.hypot(arm.x-h.x,arm.z-h.z),.4);
  const raw=t.physicalPoint({x:arm.x+t.x,z:arm.z+t.z});close(raw.x,hand.x);close(raw.z,hand.z);
});
test('movement gain combines with yaw without scaling old travel',()=>{
  const t=new LocomotionTransform();t.apply({x:0,z:0},0,0,Math.PI/2);t.apply({x:0,z:-1},0,-.2,.1);
  const head=rotateXZ({x:0,z:-1},t.yaw);close(head.x+t.x,-1.2);close(head.z+t.z,0);
  const before={...t};t.apply({x:0,z:-1},0,0,0);assert.deepEqual({...t},before);
});
test('stationary glances recover a displaced thin strip and stop at a usable fit',()=>{
  const f=fixture({turnEnabled:true,minTurnGain:.8,maxTurnGain:1.2,turnSpeed:90});let minimum=1;
  f.sample({x:-.8,z:0},0,0);
  for(let i=1;i<=3600;i++){
    f.sample({x:-.8,z:0},Math.sin(i/35)*1.5,i*1000/90);
    minimum=Math.min(minimum,overlapFrame({x:-.8,z:0},f.context()).fraction);
  }
  assert.ok(minimum>=.25-1e-6);assert.ok(overlapFrame({x:-.8,z:0},f.context()).fraction>.9999);
  assert.equal(f.tracker.guidance.correction,0);
});
test('already useful floor is not rotated out of the room while walking and glancing',()=>{
  const f=fixture({steeringEnabled:true,turnEnabled:true,minTurnGain:.5,maxTurnGain:1.5},{x:0,z:0,yaw:0});
  for(let i=0;i<1500;i++){
    const p={x:.8*Math.sin(i*.01),z:4.5*Math.sin(i*.005)};
    f.sample(p,Math.sin(i/25)*2,i*1000/90);
    assert.ok(overlapFrame(p,f.context()).fraction>.99999);
  }
});
test('sampling is consistent across headset refresh rates',()=>{
  const values=[60,72,90,120].map(hz=>run({turnRate:180,hz,settings:{turnEnabled:true},seconds:1}).total);
  values.forEach(v=>close(v,values[0],.003));
});
test('unknown area, unavailable tracking and zero response are neutral',()=>{
  const f=fixture({turnEnabled:true,steeringEnabled:true});f.sample({x:-.8,z:0},0,0);
  assert.equal(f.tracker.sample({x:-.8,z:-.02},.05,10,{context:{...f.context(),area:null}}).yawDelta,0);
  assert.equal(run({turnRate:360,settings:{turnEnabled:true,alignmentStrength:0}}).total,0);
});
test('saved legacy curve modes migrate to overlap guidance and numeric settings are bounded',()=>{
  for(const steeringMode of ['center','left','right','garbage'])assert.equal(sanitizeRedirectionSettings({steeringMode}).steeringMode,'adaptive');
  const s=sanitizeRedirectionSettings({maxCurvature:Infinity,steeringSpeed:0,maxSteeringRate:100,maxTurnGain:-1,turnSpeed:NaN});
  assert.equal(s.maxCurvature,5);assert.equal(s.steeringSpeed,.8);assert.equal(s.maxSteeringRate,30);assert.equal(s.minTurnGain,.5);assert.equal(s.maxTurnGain,1);
});


test('paused effects keep tracking samples current without running the geometry planner',()=>{
 const tracker=new RedirectionTracker({steeringEnabled:true,turnEnabled:true});
 tracker.sample({x:0,z:0},0,0);let plans=0;tracker.planner.sample=()=>{plans++;throw Error('paused planner ran');};
 for(let i=1;i<30;i++)assert.equal(tracker.sample({x:i*.001,z:0},i*.001,i*1000/72,{paused:true}).yawDelta,0);
 assert.equal(plans,0);assert.equal(tracker.previous.timeMs,29*1000/72);
});
