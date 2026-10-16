import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRoomsFirst } from '../core/rooms-first.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import { pieceInFootprint, normalizeFootprint } from '../core/footprint.ts';
import { centroid, insideConvex, polysOverlap, distPointSeg, lerpV } from '../core/geometry.ts';
import { createRuntime, colliderWalls, DEFAULTS } from '../core/runtime.ts';
import { beginRide, advanceRide, createRide, doorClosure, followPhysicalPose } from '../core/vr-runtime.ts';
import type { Level, Vec } from '../core/types.ts';

const rect=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
const narrowL=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:1.45},{x:1.45,y:1.45},{x:1.45,y:2.1},{x:0,y:2.1}];
const large=[{x:0,y:0},{x:6,y:0},{x:6,y:5},{x:0,y:5}];
const notch=[{x:0,y:0},{x:6,y:0},{x:6,y:5},{x:4,y:5},{x:4,y:2},{x:2,y:2},{x:2,y:5},{x:0,y:5}];
const rotated=normalizeFootprint(large.map(p=>({x:p.x*Math.cos(.3)-p.y*Math.sin(.3),y:p.x*Math.sin(.3)+p.y*Math.cos(.3)}))).polygon;
function params(footprint=rect,seed=42){return {boundsW:Math.max(...footprint.map(p=>p.x)),boundsH:Math.max(...footprint.map(p=>p.y)),footprint,boundaryMargin:.1,minWidth:.8,mix:DEFAULT_MIX,pieceCount:8,roomCount:8,roomsPerLayer:3,roomSize:1.2,minSizePct:3,maxSizePct:15,branchChance:.3,seed,stationaryElevators:true,connectionMode:'halls' as const};}
const levels=[rect,narrowL,large,notch,rotated].flatMap(shape=>[2,7,42].map(seed=>generateRoomsFirst(params(shape,seed))));

function walkingTour(level:Level){
  const state=createRuntime(level),visited=new Set<string>();
  function step(target:Vec){
    for(let i=0;i<3000;i++){
      const dx=target.x-state.pos.x,dy=target.y-state.pos.y,d=Math.hypot(dx,dy);if(d<.005)return;
      const k=Math.min(.01,d)/d;
      assert.ok(followPhysicalPose(level,state,{x:state.pos.x+dx*k,y:state.pos.y+dy*k}),`seed ${level.params.seed}: blocked ${state.activeId} at ${JSON.stringify(state.pos)} toward ${JSON.stringify(target)}`);
    }assert.fail('Walking failed to converge');
  }
  function inside(target:Vec){
    const parts=level.pieces.find(p=>p.id===state.activeId)!.parts,walls=colliderWalls(level,state);
    const safe=(p:Vec)=>parts.some(q=>insideConvex(p,q))&&walls.every(([a,b])=>distPointSeg(p,a,b)>=DEFAULTS.radius-1e-6);
    const segment=(a:Vec,b:Vec)=>{const n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.01);for(let i=0;i<=n;i++)if(!safe(lerpV(a,b,n?i/n:0)))return false;return true;};
    assert.ok(safe(state.pos)&&safe(target));
    if(segment(state.pos,target)){step(target);return;}
    // Independent body-clearance pathfinding avoids cutting diagonally
    // across an inside corner merely because two points share a rectangle.
    const points=parts.flat(),minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxX=Math.max(...points.map(p=>p.x)),maxY=Math.max(...points.map(p=>p.y));
    const grid=new Map<string,Vec>(),key=(x:number,y:number)=>`${x},${y}`;
    for(let x=0;minX+x*.1<=maxX;x++)for(let y=0;minY+y*.1<=maxY;y++){const p={x:minX+x*.1,y:minY+y*.1};if(safe(p))grid.set(key(x,y),p);}
    const previous=new Map<string,string|null>(),queue:string[]=[];
    for(const [k,p] of grid)if(Math.hypot(p.x-state.pos.x,p.y-state.pos.y)<.2&&segment(state.pos,p)){previous.set(k,null);queue.push(k);}
    let found:string|undefined;
    for(let q=0;q<queue.length;q++){
      const k=queue[q],p=grid.get(k)!;if(Math.hypot(p.x-target.x,p.y-target.y)<.2&&segment(p,target)){found=k;break;}
      const [x,y]=k.split(',').map(Number);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const next=key(x+dx,y+dy),point=grid.get(next);if(!previous.has(next)&&point&&segment(p,point)){previous.set(next,k);queue.push(next);}}
    }
    assert.ok(found,`No body-width path through ${state.activeId}`);const path:Vec[]=[];for(let k:string|null=found;k!==null;k=previous.get(k)!)path.unshift(grid.get(k)!);
    for(const p of path)step(p);step(target);
  }
  function through(d:Level['doors'][number]){
    const id=state.activeId,out=d.a===id?d.normal:{x:-d.normal.x,y:-d.normal.y},c=lerpV(d.p1,d.p2,.5);
    inside({x:c.x-out.x*.3,y:c.y-out.y*.3});step({x:c.x+out.x*.3,y:c.y+out.y*.3});assert.equal(state.activeId,d.a===id?d.b:d.a);
  }
  function ride(to:string){
    inside(centroid(level.pieces.find(p=>p.id===state.activeId)!.parts[0]));
    const before={...state.pos},ride=createRide();assert.ok(beginRide(level,state,ride,to));
    for(let i=0;i<150;i++)advanceRide(level,state,ride,.02);
    assert.equal(state.activeId,to);assert.deepEqual(state.pos,before);
  }
  function visit(id:string){
    visited.add(id);
    for(const portal of level.portals.filter(p=>p.a===id||p.b===id)){
      const other=portal.a===id?portal.b:portal.a;if(!visited.has(other)){ride(other);visit(other);ride(id);}
    }
    for(const d of level.doors.filter(d=>d.a===id||d.b===id)){
      const next=d.a===id?d.b:d.a;if(visited.has(next))continue;through(d);visit(next);through(d);
    }
  }visit(state.activeId);return visited;
}

test('rooms-first completes the room target and physically connects every piece in small and concave areas',()=>{
  for(const level of levels){
    assert.equal(level.pieces.filter(p=>p.kind==='room').length,8);
    assert.equal(new Set(level.doors.map(d=>d.id)).size,level.doors.length);
    assert.equal(walkingTour(level).size,level.pieces.length);
    assert.ok(level.roomsFirst!.layers.every(l=>l.roomIds.length<=3));
    for(const piece of level.pieces)assert.ok(pieceInFootprint(piece,level.params.footprint!,.1));
    for(const regions of Object.values(level.visibleRegions)){
      const ids=Object.keys(regions);for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)assert.equal(polysOverlap(regions[ids[i]],regions[ids[j]]),false);
    }
  }
  assert.ok(levels.some(l=>l.pieces.some(p=>p.kind==='hall'&&p.parts.length>1)),'Exercise a routed corridor with a turn');
});
test('rooms-first is deterministic, respects settings and starts at the actual tracked pose',()=>{
  for(const startAt of [{x:.65,y:.7},{x:2.35,y:1.05},{x:4,y:1.3}]){
    const p={...params(),roomCount:11,roomsPerLayer:2,startAt};const level=generateRoomsFirst(p);
    assert.deepEqual(generateRoomsFirst(p),level);assert.deepEqual(level.startPos,startAt);
    assert.equal(level.pieces.filter(p=>p.kind==='room').length,11);
    assert.ok(level.roomsFirst!.layers.every(l=>l.roomIds.length<=2));assert.equal(walkingTour(level).size,level.pieces.length);
  }
  const one=generateRoomsFirst({...params(large),roomCount:2,connectionMode:'doors'});
  assert.equal(one.roomsFirst!.layers.length,1);assert.equal(one.portals.length,0);assert.ok(one.pieces.every(p=>p.kind!=='elevator'));
  assert.equal(walkingTour(one).size,one.pieces.length);
});
test('multi-destination elevators change layers only when closed and preserve the physical cabin',()=>{
  const level=levels[0],layers=level.roomsFirst!.layers,state=createRuntime(level);
  assert.ok(layers.length>2);
  for(const layer of layers){
    const cabin=level.pieces.find(p=>p.id===layer.cabinId)!;
    assert.deepEqual(cabin.parts,level.pieces.find(p=>p.id===layers[0].cabinId)!.parts);
    const d=level.doors.find(d=>d.a===cabin.id||d.b===cabin.id)!,base=level.doors.find(d=>d.a===layers[0].cabinId||d.b===layers[0].cabinId)!;
    assert.deepEqual([d.p1,d.p2],[base.p1,base.p2]);
  }
  for(const target of [layers[2].cabinId,layers[0].cabinId]){
    state.activeId=layers[1].cabinId;state.pos=centroid(level.pieces.find(p=>p.id===state.activeId)!.parts[0]);const before={...state.pos},ride=createRide();
    assert.equal(beginRide(level,state,ride,'missing'),false);assert.equal(beginRide(level,state,ride,state.activeId),false);
    assert.ok(beginRide(level,state,ride,target));
    while(ride.phase==='closing'){advanceRide(level,state,ride,.02);assert.equal(state.activeId,layers[1].cabinId);}
    assert.equal(doorClosure(ride),1);assert.equal(ride.phase,'closed');assert.equal(state.doorsClosed,true);
    while(ride.phase==='closed')advanceRide(level,state,ride,.02);
    assert.equal(state.activeId,target);assert.equal(doorClosure(ride),1);assert.deepEqual(state.pos,before);
    for(let i=0;i<100;i++)advanceRide(level,state,ride,.02);assert.equal(ride.phase,'idle');
  }
});
test('unsupported footprints and settings fail explicitly rather than returning short levels',()=>{
  assert.throws(()=>generateRoomsFirst({...params(),footprint:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],boundsW:1,boundsH:1}),/No.*fit/);
  assert.throws(()=>generateRoomsFirst({...params(),startAt:{x:.1,y:.1}}),/farther inside/);
  assert.throws(()=>generateRoomsFirst({...params(),roomsPerLayer:NaN}),/Check/);
  assert.throws(()=>generateRoomsFirst({...params(),minWidth:NaN}),/Check/);
});
