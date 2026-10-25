import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateLevel,fitElevatorExit,connectedWing } from '../../expanding-rooms/architecture.ts';
import { growWing } from '../../expanding-rooms/grow-wing.ts';
import { doorRoutes,RoutePlanner,routeClearance } from '../../expanding-rooms/route-planner.ts';
import { ExpandedWalker } from '../../expanding-rooms/walking.ts';
import { createRuntime,movePlayer,colliderWalls } from '../core/runtime.ts';
import { followPhysicalPose,beginRide,advanceRide,createRide } from '../core/vr-runtime.ts';
import { computeVisible,computeVisibleRegions,seeThroughFor } from '../core/visibility.ts';
import { centroid,polysOverlap } from '../core/geometry.ts';
import { generateLevel } from '../core/generator.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import type { Level } from '../core/types.ts';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
function finish(l:any):Level {l.seeThrough=Object.fromEntries(l.pieces.map(p=>[p.id,seeThroughFor(p,l.doors)]));l.visibleRegions=computeVisibleRegions(l.pieces,l.doors,l.seeThrough);l.visible=computeVisible(l.visibleRegions);return l;}
function lift(){return finish({version:1,params:{minWidth:1},bounds:{w:6,h:5},startPieceId:'a',startPos:{x:1,y:2.5},pieces:[{id:'a',kind:'room',parts:[rect(0,1,2,3)]},{id:'ca',kind:'elevator',parts:[rect(2,2,1,1)]},{id:'cb',kind:'elevator',parts:[rect(2,2,1,1)]},{id:'b',kind:'room',parts:[rect(0,1,2,3)]}],doors:[{id:'da',a:'a',b:'ca',p1:{x:2,y:2},p2:{x:2,y:3},normal:{x:1,y:0}},{id:'db',a:'cb',b:'b',p1:{x:2,y:2},p2:{x:2,y:3},normal:{x:-1,y:0}}],portals:[{id:'p',a:'ca',b:'cb'}]});}
test('lift opens a different side without moving either cabin or the player',()=>{
  const l=lift(),before=structuredClone(l),state=createRuntime(l);state.activeId='ca';state.pos={x:2.5,y:2.5};const pos={...state.pos};
  const next=fitElevatorExit(l,'ca','cb',rect(1.8,0,3.5,5),{x:0,z:0,yaw:0});assert.notEqual(next,l);
  assert.deepEqual(l,before);assert.deepEqual(next.pieces.find(p=>p.id==='ca'),l.pieces.find(p=>p.id==='ca'));
  const cabin=next.pieces.find(p=>p.id==='cb')!.parts[0];for(const v of cabin)assert.ok(before.pieces[2].parts[0].some(p=>Math.hypot(v.x-p.x,v.y-p.y)<1e-7));
  assert.ok(next.doors.find(d=>d.id==='db')!.normal.x>.9);
  const ride=createRide();assert.ok(beginRide(next,state,ride));for(let i=0;i<160;i++)advanceRide(next,state,ride,1/60);
  assert.equal(state.activeId,'cb');assert.deepEqual(state.pos,pos);
});
test('closed doors and fences block tracked walking, opening a door restores crossing',()=>{
  const l=decorateLevel(lift(),{blockers:true}),state=createRuntime(l);assert.ok(l.closedDoors?.includes('da'));
  for(let i=0;i<80;i++)movePlayer(l,state,.02,0,{radius:.16,chargeTime:1.2});assert.equal(state.activeId,'a');
  l.closedDoors=[];for(let i=0;i<50;i++)movePlayer(l,state,.02,0,{radius:.16,chargeTime:1.2});assert.equal(state.activeId,'ca');
  const room=finish({version:1,params:{minWidth:1},bounds:{w:5,h:5},pieces:[{id:'r',kind:'room',parts:[rect(0,0,5,5)]}],doors:[],portals:[],startPieceId:'r',startPos:{x:1,y:2.5}});
  decorateLevel(room,{blockers:true});assert.equal(room.pieces[0].blockers?.length,1);const s=createRuntime(room);
  for(let i=0;i<100;i++)movePlayer(room,s,.02,0,{radius:.16,chargeTime:1.2});assert.ok(s.pos.x<2.1);assert.equal(colliderWalls(room,s).length,8);
});
test('door route includes the next room and anticipates a closed door without opening it',()=>{
  const l=lift(),state=createRuntime(l);l.closedDoors=['da'];const routes=doorRoutes(l,state);assert.equal(routes.length,1);assert.deepEqual(l.closedDoors,['da']);assert.ok(routes[0].end.x>2.4);
  const short=routeClearance(routes[0].points,state.pos,state.pos,0,rect(0,0,2.2,5));assert.ok(short.min<0);
  const w=new ExpandedWalker(l,rect(0,0,2.2,5)),planner=new RoutePlanner(l,()=>state);
  const goal=planner.sample({x:1,z:2.5},{boundary:w.boundary,physicalFloor:w.floor,area:w.areas.get('a'),mapping:w.transform},0,{heading:-Math.PI/2,urgency:1,preferredSide:1});
  assert.ok(Math.abs(goal.correction)>.1);assert.ok(planner.routeInfo.bestClearance>planner.routeInfo.clearance);
});
test('generation offers elevator bays and new wings preserve the source and stationary return connection',()=>{
  const l=generateLevel({boundsW:7,boundsH:6,footprint:rect(0,0,7,6),minWidth:1,mix:DEFAULT_MIX,pieceCount:20,minSizePct:6,maxSizePct:20,branchChance:.3,seed:42,stationaryElevators:true,elevatorBays:true});
  assert.ok(l.portals.length);const portal=l.portals[0],source=structuredClone(l.pieces.find(p=>p.id===portal.a));
  const next=growWing(l,portal.a,portal.b,1042,{attention:true});assert.deepEqual(next.pieces.find(p=>p.id===portal.a),source);
  assert.ok(next.portals.some(p=>p.a===portal.a&&p.b===portal.b));assert.ok(next.pieces.some(p=>p.id.startsWith('wing1042:')));
  assert.equal(new Set(next.pieces.map(p=>p.id)).size,next.pieces.length);
  for(const regions of Object.values(next.visibleRegions)){const entries=Object.values(regions);for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)assert.equal(polysOverlap(entries[i],entries[j]),false);}
  const ca=next.pieces.find(p=>p.id===portal.a)!,cb=next.pieces.find(p=>p.id===portal.b)!;assert.deepEqual(ca.parts,cb.parts);
});
test('live gain toggles and menus never move a stationary head',()=>{
  const l=lift(),s=createRuntime(l),w=new ExpandedWalker(l,rect(0,0,6,5));w.experiments={routes:true,adaptiveGain:true,translation:false};w.redirection.setSettings({steeringEnabled:false,turnEnabled:false});
  w.sample(s.pos,0,0,s);for(let i=1;i<20;i++)w.sample({x:1+i*.01,y:2.5},0,i*10,s);
  assert.equal(w.transform.x,0);assert.equal(w.transform.z,0);w.experiments.translation=true;const before={...w.transform};
  for(let i=20;i<40;i++)w.sample({x:1.19,y:2.5},i*.03,i*10,s,true);assert.deepEqual({...w.transform},before);
});
