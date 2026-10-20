import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, Episode, jobs, seen, validateConfig, totalJobs, DT, boundaryFor, localPath } from '../../expanding-rooms/simulator/model.ts';
import { summarize, failed } from '../../expanding-rooms/simulator/results.ts';
import { createRuntime } from '../core/runtime.ts';
import { followPhysicalPose } from '../core/vr-runtime.ts';
import type { Level } from '../core/types.ts';
const first=(changes:any={})=>jobs({...DEFAULT_CONFIG,...changes}).next().value!;
const run=(changes:any={},record=false)=>{const e=new Episode(first(changes),record);while(!e.outcome)e.step();return e;};
test('door discovery respects independent gaze, distance and wall occlusion',()=>{
  const from={x:0,y:0},door={x:0,y:-2};
  assert.equal(seen(from,door,0,[]),true);
  assert.equal(seen(from,door,Math.PI,[]),false);
  assert.equal(seen(from,{x:0,y:-9},0,[]),false);
  assert.equal(seen(from,door,0,[[{x:-1,y:-1},{x:1,y:-1}]]),false);
  assert.equal(seen(from,door,0,[[{x:2,y:-1},{x:3,y:-1}]]),true);
});
test('batch crosses settings with paired seeds and validates imported inputs',()=>{
  const c=validateConfig({...DEFAULT_CONFIG,seeds:2,shapes:['oblong','l'],profiles:['purposeful','curious'],scales:[1,1.5],gains:[1,1.2]});
  const list=[...jobs(c)];assert.equal(list.length,32);assert.equal(totalJobs(c),32);
  assert.equal(list.filter(j=>j.seed===42).length,16);
  assert.deepEqual(boundaryFor('l',42),boundaryFor('l',42));
  assert.notDeepEqual(boundaryFor('l',43),boundaryFor('l',42));
  for(const bad of [{seconds:NaN},{gains:[Infinity]},{scales:[0]},{profiles:['oracle']},{steeringEnabled:'false'},{seeds:0}])assert.throws(()=>validateConfig({...c,...bad}));
});
test('completed episodes and their replay are deterministic across execution chunks',()=>{
  const a=run({scales:[1]},true),b=new Episode(first({scales:[1]}),true);
  while(!b.outcome)for(let frame=0;frame<180&&!b.outcome;frame++)b.step();
  assert.equal(a.outcome,'completed');assert.deepEqual(a.result(),b.result());assert.deepEqual(a.trace,b.trace);
  assert.ok(a.trace.length>2);assert.equal(a.trace[0].time,0);assert.equal(a.trace.at(-1).outcome,'completed');
  assert.ok(a.trace.some(f=>Math.abs(f.head-f.body)>.1));
  assert.ok(a.trace.some(f=>Math.hypot(f.physical.x-f.virtual.x,f.physical.y-f.virtual.y)>.01));
  assert.equal(a.walker.stats.recoveries,0);
  assert.ok(Math.abs(a.time/DT-Math.round(a.time/DT))<1e-7);
});
test('boundary failures stop the episode without teleporting or counting success',()=>{
  const e=run({scales:[1.5]},true);
  assert.equal(e.outcome,'boundary-stop');assert.ok(e.minClearance<.2);
  assert.ok(e.trace.some(f=>Math.abs(f.yaw)>.01),'The shared redirection code should actually turn the world.');
  assert.equal(e.walker.stats.recoveries,0);const before=e.snapshot();e.step();assert.deepEqual(e.snapshot(),before);
  const groups=summarize([e.result(),failed(e.job,new Error('No room fits'))]);
  assert.equal(groups[0].runs,2);assert.equal(groups[0].completed,0);
  assert.equal(groups[0].outcomes['generation-failed'],1);
});
test('different walker profiles change walking and scanning without changing generated world',()=>{
  const a=run({seconds:20,profiles:['purposeful']}),b=run({seconds:20,profiles:['cautious']});
  assert.deepEqual(a.level,b.level);
  assert.notEqual(a.walker.stats.physicalMetres,b.walker.stats.physicalMetres);
  assert.notEqual(a.headTravel,b.headTravel);
});
test('local motor routes around a concave corner using the shared body clearance',()=>{
  const level={pieces:[{id:'r',kind:'room',parts:[
    [{x:0,y:0},{x:4,y:0},{x:4,y:1},{x:0,y:1}],
    [{x:0,y:1},{x:1,y:1},{x:1,y:4},{x:0,y:4}],
  ]}],doors:[],portals:[],startPieceId:'r',startPos:{x:3.5,y:.5}} as unknown as Level;
  const state=createRuntime(level),goal={x:.5,y:3.5},path=localPath(level,state,goal);
  assert.ok(path&&path.length>1);
  for(const point of path) {
    const old={...state.pos},n=Math.ceil(Math.hypot(point.x-old.x,point.y-old.y)/.02);
    for(let i=1;i<=n;i++)assert.equal(followPhysicalPose(level,state,{x:old.x+(point.x-old.x)*i/n,y:old.y+(point.y-old.y)*i/n}),true);
  }
  assert.ok(Math.hypot(state.pos.x-goal.x,state.pos.y-goal.y)<1e-6);
});
