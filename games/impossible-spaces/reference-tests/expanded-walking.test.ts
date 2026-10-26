import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpandedWalker, expandBoundary } from '../../expanding-rooms/walking.ts';
import { createRuntime } from '../core/runtime.ts';
import { generateLevel } from '../core/generator.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import { normalizeFootprint } from '../core/footprint.ts';
import type { Level } from '../core/types.ts';

const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture() {
  const level = { pieces:[{id:'room',kind:'room',template:'room',parts:[rect(0,0,10,10)]}], doors:[],portals:[],startPieceId:'room',startPos:{x:5,y:5} } as unknown as Level;
  const state=createRuntime(level), walker=new ExpandedWalker(level,rect(0,0,10,10));
  walker.redirection.setSettings({steeringEnabled:false,turnEnabled:false});
  return {level,state,walker};
}
test('expanded footprint preserves concavity, input and metric scale',()=>{
  const points=[{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}],copy=structuredClone(points);
  const expanded=expandBoundary(points,1.25);
  assert.deepEqual(points,copy);assert.equal(expanded.length,6);
  close(expanded[1].x-expanded[0].x,5);close(expanded[3].x,2);
  assert.deepEqual(expandBoundary(points,1),points);
  assert.throws(()=>expandBoundary(points,Infinity));
});
test('gained walking is metric; menus pause effects but still follow the real head',()=>{
  const {state,walker}=fixture();walker.gain.setSettings({maxGain:2,speedForMax:.8});
  walker.sample({x:5,y:5},0,0,state);
  for(let i=1;i<=40;i++)assert.equal(walker.sample({x:5+i*.02,y:5},0,i*10,state).valid,true);
  assert.ok(state.pos.x>6.3);const offset=walker.transform.x;
  for(let i=41;i<=60;i++)walker.sample({x:5+i*.02,y:5},i*.02,i*10,state,true);
  close(walker.transform.x,offset);close(state.pos.x,6.2+offset);close(walker.transform.yaw,0);
  assert.ok(walker.stats.virtualMetres>walker.stats.physicalMetres);
});
test('artificial motion into a wall is rejected; raw crossing is recoverable without changing rooms',()=>{
  const {state,walker}=fixture();walker.gain.setSettings({maxGain:2,speedForMax:.8});
  walker.sample({x:5,y:5},0,0,state);
  for(let i=1;i<=250;i++)walker.sample({x:5+i*.02,y:5},0,i*10,state);
  assert.ok(walker.stats.rejectedGain>0);assert.ok(walker.stats.wallBlocks>0);
  assert.ok(state.pos.x<=9.84+1e-6);
  const saved={...state.pos},id=state.activeId;
  assert.equal(walker.reanchor({x:12,y:5},state),false);
  assert.equal(walker.reanchor({x:5,y:5},state),true);
  assert.deepEqual(state.pos,saved);assert.equal(state.activeId,id);
  assert.equal(walker.sample({x:5,y:5},0,3000,state).valid,true);
});
test('physical boundary excursions are counted once per excursion and suppress effects',()=>{
  const {state,level}=fixture(),walker=new ExpandedWalker(level,rect(4,4,2,2));
  walker.sample({x:5,y:5},0,0,state);
  for(let i=1;i<=70;i++)walker.sample({x:5+i*.02,y:5},0,i*10,state,true);
  assert.equal(walker.outside,true);assert.equal(walker.stats.boundaryExits,1);
  assert.equal(walker.transform.x,0);
  assert.ok(state.pos.x<=6);assert.equal(walker.stats.wallBlocks,0);
});
test('head turns pivot about the head, with independent toggles and no motion while paused',()=>{
  const {state,level}=fixture();
  level.pieces[0].parts=[rect(-1.5,-7.5,3,15)];state.pos={x:1.2,y:0};
  // The head is in the room, but much of the mapped physical floor is not.
  const raw={x:-.8,y:0};
  const active=new ExpandedWalker(level,rect(-1,-5,2,10));active.transform.x=2;
  active.redirection.setSettings({turnEnabled:true,steeringEnabled:false,turnSpeed:60,maxTurnGain:1.3});
  active.sample(raw,0,0,state);
  for(let i=1;i<=50;i++)active.sample(raw,i*.03,i*10,state);
  assert.ok(Math.abs(active.transform.yaw)>0);close(state.pos.x,1.2);close(state.pos.y,0);
  const before={x:active.transform.x,z:active.transform.z,yaw:active.transform.yaw};
  for(let i=51;i<=75;i++)active.sample(raw,i*.03,i*10,state,true);
  assert.deepEqual({x:active.transform.x,z:active.transform.z,yaw:active.transform.yaw},before);
});
test('growth generation uses expanded polygons with a fixed physical start on small and concave floors',()=>{
  const shapes=[rect(0,0,4.7,2.1),[{x:0,y:0},{x:5,y:0},{x:5,y:2},{x:3,y:2},{x:3,y:4},{x:0,y:4}]];
  for(const points of shapes)for(const scale of [1,1.25,1.5]) {
    const footprint=normalizeFootprint(expandBoundary(points,scale));
    const start={x:1-footprint.origin.x,y:1-footprint.origin.y};
    const level=generateLevel({boundsW:footprint.width,boundsH:footprint.height,footprint:footprint.polygon,startAt:start,boundaryMargin:.1,stationaryElevators:true,minWidth:.8,mix:DEFAULT_MIX,pieceCount:12,minSizePct:3,maxSizePct:15,branchChance:.3,seed:42});
    assert.deepEqual(level.startPos,start);assert.ok(level.pieces.length>1);
    const walker=new ExpandedWalker(level,points.map(p=>({x:p.x-footprint.origin.x,y:p.y-footprint.origin.y})));
    assert.equal(walker.sample(start,0,0,createRuntime(level)).valid,true);
  }
});
