import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../core/generator.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import { createRuntime,colliderWalls,walkableAreas } from '../core/runtime.ts';
import { followPhysicalPose } from '../core/vr-runtime.ts';
import { polysOverlap,pieceInBounds } from '../core/geometry.ts';
import { doorRoutes,RoutePlanner } from '../../expanding-rooms/route-planner.ts';
import { ExpandedWalker } from '../../expanding-rooms/walking.ts';
const params={boundsW:7.5,boundsH:6.25,minWidth:.8,mix:DEFAULT_MIX,pieceCount:20,minSizePct:3,maxSizePct:15,branchChance:.3,seed:42,walkingOnly:true};

test('walking-only growth makes room/hall connections and hidden overlap without lifts',()=>{
 const lv=generateLevel(params);assert.ok(lv.pieces.length>=params.pieceCount);assert.equal(lv.portals.length,0);assert.ok(lv.pieces.every(p=>p.kind!=='elevator'&&pieceInBounds(p,lv.bounds.w,lv.bounds.h)));
 assert.ok(lv.pieces.some(p=>p.template==='hall-u'));assert.equal(lv.doors.length,lv.pieces.length-1);
 for(const hall of lv.pieces.filter(p=>p.kind==='hall'))assert.equal(lv.doors.filter(d=>d.a===hall.id||d.b===hall.id).length,2,'every corridor reaches another room');
 for(const regions of Object.values(lv.visibleRegions)){const entries=Object.values(regions);for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)assert.equal(polysOverlap(entries[i],entries[j]),false);}
 assert.ok(lv.pieces.some((p,i)=>lv.pieces.slice(i+1).some(q=>polysOverlap(p.parts,q.parts))),'reuses the same floor behind corners');
 const state=createRuntime(lv),visited=new Set<string>();
 const cross=(door:string,to:string)=>{const route=doorRoutes(lv,state).find(r=>r.id===door);assert.ok(route,`path through ${door} from ${state.activeId}`);for(const point of route!.points)assert.ok(followPhysicalPose(lv,state,point),`body can walk ${door}`);assert.equal(state.activeId,to);};
 const visit=(id:string,parent='')=>{visited.add(id);for(const d of lv.doors.filter(d=>d.a===id||d.b===id)){const next=d.a===id?d.b:d.a;if(next===parent)continue;cross(d.id,next);visit(next,id);cross(d.id,id);}};
 visit(lv.startPieceId);assert.equal(visited.size,lv.pieces.length);
});

test('route planning and collision geometry reuse work between headset frames',()=>{
 const lv=generateLevel({...params,pieceCount:6}),state=createRuntime(lv);
 assert.equal(colliderWalls(lv,state),colliderWalls(lv,state));assert.equal(walkableAreas(lv,state),walkableAreas(lv,state));
 const w=new ExpandedWalker(lv,[{x:0,y:0},{x:7.5,y:0},{x:7.5,y:6.25},{x:0,y:6.25}]);
 const planner=new RoutePlanner(lv,()=>state),context={boundary:w.boundary,physicalFloor:w.floor,area:w.areas.get(state.activeId),mapping:w.transform};
 planner.sample({x:state.pos.x,z:state.pos.y},context,0,{heading:0});const route=planner.target;
 for(let i=1;i<=8;i++)planner.sample({x:state.pos.x,z:state.pos.y},context,i*13.8,{heading:0});
 assert.equal(planner.target,route);assert.equal(planner.lastRouteTime,0);
});
