import { centroid, edgesOf, distPointSeg, insideConvex, polysOverlap } from '../impossible-spaces/core/geometry.ts';
import { seeThroughFor,computeVisibleRegions,computeVisible } from '../impossible-spaces/core/visibility.ts';
import { clearance } from '../impossible-spaces/core/footprint.ts';
import { rotateXZ } from '../expansive-spaces/redirection.js';
import type { Level,Vec } from '../impossible-spaces/core/types.ts';

export function decorateLevel(level:Level,options:any){
  level.decoration={attention:!!options.attention,floorCues:options.floorCues||'normal',switches:!!options.switches};
  level.closedDoors=[];
  for(const p of level.pieces){
    if(p.kind==='elevator')for(const d of level.doors.filter(d=>d.a===p.id||d.b===p.id))level.closedDoors.push(d.id);
    if(!options.blockers||p.kind!=='room'||p.parts.length!==1||p.parts[0].length!==4)continue;
    const poly=p.parts[0],c=centroid(poly);
    // A small fence only in a roomy convex part; a full walkable ring remains around it.
    if(edgesOf(poly).some(([a,b])=>distPointSeg(c,a,b)<1.15))continue;
    const block=[{x:c.x-.25,y:c.y-.4},{x:c.x+.25,y:c.y-.4},{x:c.x+.25,y:c.y+.4},{x:c.x-.25,y:c.y+.4}];
    if(!block.every(v=>insideConvex(v,poly))||p.id===level.startPieceId&&edgesOf(block).some(([a,b])=>distPointSeg(level.startPos,a,b)<.4)||p.id===level.startPieceId&&insideConvex(level.startPos,block))continue;
    p.blockers=[block];
  }
  if(options.switches)for(const d of level.doors){
    const a=level.pieces.find(p=>p.id===d.a)!,b=level.pieces.find(p=>p.id===d.b)!;
    if(a.kind==='room'&&b.kind!=='elevator')level.closedDoors.push(d.id);
  }
  return level;
}
export function connectedWing(level:Level,to:string,from:string){
  const ids=new Set([to]),queue=[to];
  while(queue.length){const id=queue.pop()!;for(const edge of [...level.doors,...level.portals]){
    const other=edge.a===id?edge.b:edge.b===id?edge.a:null;
    if(other&&other!==from&&!ids.has(other)){ids.add(other);queue.push(other);}
  }}return ids;
}
/** Rotate only an unseen wing, with a square stationary cabin as pivot. */
export function fitElevatorExit(level:Level,from:string,to:string,physicalBoundary:Vec[],mapping:any,resize=false){
  const cabin=level.pieces.find(p=>p.id===to)!,source=level.pieces.find(p=>p.id===from)!;
  const c=centroid(cabin.parts[0]),ids=connectedWing(level,to,from);
  // A connection back to the visible world would make this an unsafe mutation.
  if(level.doors.some(d=>(ids.has(d.a)&&d.b===from)||(ids.has(d.b)&&d.a===from)))return level;
  const d=level.doors.find(d=>d.a===to||d.b===to);if(!d)return level;
  const mid={x:(d.p1.x+d.p2.x)/2,y:(d.p1.y+d.p2.y)/2},out=d.a===to?d.normal:{x:-d.normal.x,y:-d.normal.y};
  const physical=(p:Vec)=>{const q=rotateXZ({x:p.x-mapping.x,z:p.y-mapping.z},-mapping.yaw);return {x:q.x,y:q.z};};
  const rotate=(p:Vec,angle:number)=>({x:c.x+Math.cos(angle)*(p.x-c.x)-Math.sin(angle)*(p.y-c.y),y:c.y+Math.sin(angle)*(p.x-c.x)+Math.cos(angle)*(p.y-c.y)});
  const score=(angle:number)=>{
    let score=Infinity;for(let i=0;i<=20;i++){const p=rotate({x:mid.x+out.x*i*.05,y:mid.y+out.y*i*.05},angle);score=Math.min(score,clearance(physical(p),physicalBoundary));}return score;
  };
  let angle=0,best=score(0);for(const turn of [Math.PI/2,-Math.PI/2,Math.PI]){
    // Rotation must leave the destination cabin exactly on the source cabin.
    if(!cabin.parts[0].every(v=>source.parts[0].some(q=>Math.hypot(q.x-rotate(v,turn).x,q.y-rotate(v,turn).y)<1e-6)))continue;
    const s=score(turn);if(s>best+.03){best=s;angle=turn;}
  }
  // Compress only along the exit normal, around its wall plane. The threshold and cabin stay fixed.
  // One modest change per wing, never cumulative shrinking on repeated rides.
  const ratio=resize&&!level.fittedWings?.includes(to)?(best<.25?.96:best>.6?1.04:1):1;
  if(!angle&&ratio===1)return level;
  const map=(p:Vec,cabinPoint=false)=>{
    const along=(p.x-mid.x)*out.x+(p.y-mid.y)*out.y;
    return rotate(cabinPoint?p:{x:p.x+out.x*along*(ratio-1),y:p.y+out.y*along*(ratio-1)},angle);
  };
  const copy=structuredClone(level);
  for(const p of copy.pieces)if(ids.has(p.id)){p.parts=p.parts.map(poly=>poly.map(v=>map(v,p.id===to)));p.blockers=p.blockers?.map(poly=>poly.map(v=>map(v)));}
  for(const door of copy.doors)if(ids.has(door.a)&&ids.has(door.b)){
    door.p1=map(door.p1);door.p2=map(door.p2);const dx=door.p2.x-door.p1.x,dy=door.p2.y-door.p1.y;
    const n=rotate({x:c.x+door.normal.x,y:c.y+door.normal.y},angle),sign=(-dy*(n.x-c.x)+dx*(n.y-c.y))>=0?1:-1;
    door.normal={x:-dy/Math.hypot(dx,dy)*sign,y:dx/Math.hypot(dx,dy)*sign};
    if(Math.hypot(dx,dy)<.75)return level;
  }
  copy.seeThrough=Object.fromEntries(copy.pieces.map(p=>[p.id,seeThroughFor(p,copy.doors)]));
  copy.visibleRegions=computeVisibleRegions(copy.pieces,copy.doors,copy.seeThrough);copy.visible=computeVisible(copy.visibleRegions);
  for(const regions of Object.values(copy.visibleRegions)){const entries=Object.values(regions);for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)if(polysOverlap(entries[i],entries[j]))return level;}
  copy.fittedWings=[...(level.fittedWings||[]),...(ratio!==1?[to]:[])];
  return copy;
}
