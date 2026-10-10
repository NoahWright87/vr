import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLevel } from '../core/generator.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import { insideFootprint, pieceInFootprint, normalizeFootprint } from '../core/footprint.ts';
import { centroid, insideConvex, polysOverlap, distPointSeg, edgesOf, seamsBetween, lerpV } from '../core/geometry.ts';
import { createRuntime, movePlayer, DEFAULTS, visiblePieceIds } from '../core/runtime.ts';
import { beginRide, advanceRide, createRide, doorClosure, followPhysicalPose, fullyInsideCabin } from '../core/vr-runtime.ts';

const rect = [{x:0,y:0},{x:6,y:0},{x:6,y:5},{x:0,y:5}];
const l = [{x:0,y:0},{x:6,y:0},{x:6,y:2.8},{x:3.5,y:2.8},{x:3.5,y:5},{x:0,y:5}];
const notch = [{x:0,y:0},{x:7,y:0},{x:7,y:6},{x:4.5,y:6},{x:4.5,y:3.8},{x:2.5,y:3.8},{x:2.5,y:6},{x:0,y:6}];
const diagonal = [{x:1,y:0},{x:5,y:0},{x:6,y:1},{x:6,y:4},{x:5,y:5},{x:1,y:5},{x:0,y:4},{x:0,y:1}];
function params(seed=42, footprint=rect) {
  return {boundsW:Math.max(...footprint.map(p=>p.x)),boundsH:Math.max(...footprint.map(p=>p.y)),footprint,boundaryMargin:.25,minWidth:1,mix:DEFAULT_MIX,pieceCount:10,minSizePct:3,maxSizePct:15,branchChance:.3,seed,stationaryElevators:true};
}

test('concave containment rejects an edge that bridges a notch despite all vertices being inside', () => {
  const part = [{x:1,y:3},{x:6,y:3},{x:6,y:5.5},{x:1,y:5.5}];
  assert.ok(part.every(p=>insideFootprint(p,notch)));
  assert.equal(pieceInFootprint({id:'test',kind:'room',template:'test',parts:[part]},notch,.1),false);
  assert.throws(()=>normalizeFootprint([{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:4,y:0}]),/invalid|crosses/);
});

const levels = [rect,l,notch,diagonal].flatMap(footprint=>[2,7,42].map(seed=>generateLevel(params(seed,footprint))));

function stationaryTour(level: ReturnType<typeof generateLevel>) {
  const state=createRuntime(level),visited=new Set<string>();
  function step(target: {x:number;y:number}) {
    for(let i=0;i<2000;i++) {
      const dx=target.x-state.pos.x,dy=target.y-state.pos.y,d=Math.hypot(dx,dy);
      if(d<.005)return;
      const k=Math.min(.01,d)/d;
      assert.ok(followPhysicalPose(level,state,{x:state.pos.x+dx*k,y:state.pos.y+dy*k}),`seed ${level.params.seed}: blocked in ${state.activeId}`);
    }
    assert.fail('walking failed to converge');
  }
  function inside(target: {x:number;y:number}) {
    const parts=level.pieces.find(p=>p.id===state.activeId)!.parts;
    const from=parts.findIndex(q=>insideConvex(state.pos,q)),to=parts.findIndex(q=>insideConvex(target,q));
    if(from>=0&&to>=0&&from!==to) {
      const previous=new Map<number,number>([[from,-1]]),queue=[from];
      while(queue.length){const i=queue.shift()!;for(let j=0;j<parts.length;j++)if(!previous.has(j)&&seamsBetween(parts[i],parts[j]).length){previous.set(j,i);queue.push(j);}}
      assert.ok(previous.has(to));const path=[];for(let i=to;i!==-1;i=previous.get(i)!)path.unshift(i);
      for(let k=0;k<path.length-1;k++){step(centroid(parts[path[k]]));const [a,b]=seamsBetween(parts[path[k]],parts[path[k+1]])[0];step(lerpV(a,b,.5));}
      step(centroid(parts[to]));
    }
    step(target);
  }
  function through(d: typeof level.doors[number]) {
    const id=state.activeId,out=d.a===id?d.normal:{x:-d.normal.x,y:-d.normal.y},c=lerpV(d.p1,d.p2,.5);
    inside({x:c.x-out.x*.3,y:c.y-out.y*.3});step({x:c.x+out.x*.3,y:c.y+out.y*.3});
    assert.equal(state.activeId,d.a===id?d.b:d.a);
  }
  function ride(to: string) {
    inside(centroid(level.pieces.find(p=>p.id===state.activeId)!.parts[0]));
    const before={...state.pos},ride=createRide();assert.ok(beginRide(level,state,ride));
    for(let i=0;i<150;i++)advanceRide(level,state,ride,.02);
    assert.equal(state.activeId,to);assert.deepEqual(state.pos,before);
  }
  function visit(id: string) {
    visited.add(id);
    const portal=level.portals.find(p=>p.a===id||p.b===id),other=portal?(portal.a===id?portal.b:portal.a):null;
    if(other&&!visited.has(other)){ride(other);visit(other);ride(id);}
    for(const d of level.doors.filter(d=>d.a===id||d.b===id)) {
      const next=d.a===id?d.b:d.a;if(visited.has(next))continue;
      through(d);visit(next);through(d);
    }
  }
  visit(state.activeId);return visited;
}
test('every VR room can be walked to and back across polygon shapes and stationary elevator rides', () => {
  for(const level of levels)assert.equal(stationaryTour(level).size,level.pieces.length);
});
test('VR levels fit varied physical polygons with clearance and retain disjoint visible regions', () => {
  for(const level of levels) {
    for(const p of level.pieces) assert.ok(pieceInFootprint(p,level.params.footprint!,.25),`seed ${level.params.seed} ${p.id}`);
    for(const reg of Object.values(level.visibleRegions)) {
      const ids=Object.keys(reg);
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)assert.equal(polysOverlap(reg[ids[i]],reg[ids[j]]),false);
    }
  }
});

test('start room contains the actual headset pose; unsupported small spaces fail explicitly', () => {
  const startAt={x:2,y:1.9}, p={...params(9,l),startAt};
  const level=generateLevel(p);
  assert.deepEqual(level.startPos,startAt);
  assert.ok(level.pieces.find(p=>p.id===level.startPieceId)!.parts.some(poly=>insideConvex(startAt,poly)));
  assert.deepEqual(generateLevel(p),level);
  const nearEdge={x:.5,y:2.5},edgeLevel=generateLevel({...params(9),startAt:nearEdge});
  assert.deepEqual(edgeLevel.startPos,nearEdge);
  assert.ok(pieceInFootprint(edgeLevel.pieces.find(p=>p.id===edgeLevel.startPieceId)!,rect,.25));
  assert.throws(()=>generateLevel({...params(),boundsW:1,boundsH:1,footprint:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}),/too small/);
  assert.throws(()=>generateLevel({...params(),startAt:{x:.1,y:.1}}),/farther inside/);
});

test('paired elevator cabins and their doors occupy the identical physical space', () => {
  let checked=0;
  for(const level of levels)for(const portal of level.portals) {
    const a=level.pieces.find(p=>p.id===portal.a)!,b=level.pieces.find(p=>p.id===portal.b)!;
    assert.deepEqual(a.parts,b.parts);
    const da=level.doors.find(d=>d.a===a.id||d.b===a.id)!,db=level.doors.find(d=>d.a===b.id||d.b===b.id)!;
    assert.deepEqual([da.p1,da.p2],[db.p1,db.p2]);checked++;
  }
  assert.ok(checked>2,`${checked} cabin pairs`);
});

test('elevators require a button, switch only while fully closed, preserve pose and do not bounce', () => {
  const level=levels.find(l=>l.portals.length>0)!, portal=level.portals[0], state=createRuntime(level),ride=createRide();
  state.activeId=portal.a;state.pos=centroid(level.pieces.find(p=>p.id===portal.a)!.parts[0]);
  const position={...state.pos};
  for(let i=0;i<200;i++)advanceRide(level,state,ride,.02);
  assert.equal(state.activeId,portal.a);assert.equal(ride.phase,'idle');
  assert.ok(beginRide(level,state,ride));
  for(let i=0;i<32;i++)advanceRide(level,state,ride,.02);
  assert.equal(state.activeId,portal.a);assert.ok(doorClosure(ride)<1);
  advanceRide(level,state,ride,.02);assert.equal(ride.phase,'closed');assert.equal(doorClosure(ride),1);
  assert.deepEqual(visiblePieceIds(level,state),[portal.a]);
  for(let i=0;i<39;i++)advanceRide(level,state,ride,.02);
  assert.equal(state.activeId,portal.a);
  advanceRide(level,state,ride,.02);assert.equal(state.activeId,portal.b);assert.equal(ride.phase,'opening');assert.equal(doorClosure(ride),1);
  assert.deepEqual(state.pos,position);
  for(let i=0;i<200;i++)advanceRide(level,state,ride,.02);
  assert.equal(ride.phase,'idle');assert.equal(state.activeId,portal.b);assert.deepEqual(state.pos,position);
  assert.ok(beginRide(level,state,ride));for(let i=0;i<150;i++)advanceRide(level,state,ride,.02);
  assert.equal(state.activeId,portal.a);assert.deepEqual(state.pos,position);
});

test('a partial doorway entry cannot start a ride and leaving during closing cancels it', () => {
  const level=levels.find(l=>l.portals.length>0)!, portal=level.portals[0],state=createRuntime(level),ride=createRide();
  const d=level.doors.find(d=>d.a===portal.a||d.b===portal.a)!;
  state.activeId=portal.a;state.pos={x:(d.p1.x+d.p2.x)/2,y:(d.p1.y+d.p2.y)/2};
  assert.equal(beginRide(level,state,ride),false);
  state.pos=centroid(level.pieces.find(p=>p.id===portal.a)!.parts[0]);assert.ok(beginRide(level,state,ride));
  state.pos={x:d.p1.x,y:d.p1.y};advanceRide(level,state,ride,.02);
  assert.equal(ride.phase,'opening');assert.equal(state.activeId,portal.a);
  for(let i=0;i<100;i++)advanceRide(level,state,ride,.02);assert.equal(ride.phase,'idle');
});

test('tracked movement refuses wall crossings/discontinuities without changing pose or room', () => {
  const level=levels[0],state=createRuntime(level),old={...state.pos},id=state.activeId;
  assert.equal(followPhysicalPose(level,state,{x:old.x+2,y:old.y}),false);assert.deepEqual(state.pos,old);assert.equal(state.activeId,id);
  assert.equal(followPhysicalPose(level,state,{x:old.x+.01,y:old.y}),true);
  const piece=level.pieces.find(p=>p.id===state.activeId)!;
  // Place next to a solid wall; moving across it must leave the logical position intact.
  const edge=edgesOf(piece.parts[0]).find(([a,b])=>!level.doors.some(d=>distPointSeg(d.p1,a,b)<1e-5))!;
  const center=centroid(piece.parts[0]),mid={x:(edge[0].x+edge[1].x)/2,y:(edge[0].y+edge[1].y)/2};
  const dx=center.x-mid.x,dy=center.y-mid.y,len=Math.hypot(dx,dy);
  state.pos={x:mid.x+dx/len*.2,y:mid.y+dy/len*.2};const before={...state.pos};
  assert.equal(followPhysicalPose(level,state,{x:mid.x-dx/len*.2,y:mid.y-dy/len*.2}),false);assert.deepEqual(state.pos,before);
});
