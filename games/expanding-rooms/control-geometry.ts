import { wallSegments,insideConvex,clipSegToConvex } from '../impossible-spaces/core/geometry.ts';
import type { Level,Piece,Door,Vec } from '../impossible-spaces/core/types.ts';

/** Fixed wall mounting beside this door, independent of player position/active room. */
export function wallControl(piece:Piece,door:Door,doors:Door[]){
  const candidates=[];
  for(const [a,b] of wallSegments(piece,doors))for(const [start,end] of [[a,b],[b,a]]){
    if(![door.p1,door.p2].some(p=>Math.hypot(p.x-start.x,p.y-start.y)<1e-5))continue;
    const length=Math.hypot(end.x-start.x,end.y-start.y);if(length<.28)continue;
    const u={x:(end.x-start.x)/length,y:(end.y-start.y)/length},distance=Math.min(.4,length-.14);
    const point={x:start.x+u.x*distance,y:start.y+u.y*distance};
    let normal={x:-u.y,y:u.x};
    if(!piece.parts.some(poly=>insideConvex({x:point.x+normal.x*.02,y:point.y+normal.y*.02},poly)))normal={x:-normal.x,y:-normal.y};
    candidates.push({point,normal,jamb:start,length});
  }
  return candidates.sort((a,b)=>b.length-a.length)[0]||null;
}
export function pointVisible(level:Level,active:string,owner:string,p:Vec){
  return (level.visibleRegions[active]?.[owner]||[]).some(poly=>insideConvex(p,poly,1e-5));
}
/** Clip a door to actual visible regions, including rooms seen through another doorway. */
export function visibleDoorSegments(level:Level,active:string,door:Door):[Vec,Vec][]{
  const dx=door.p2.x-door.p1.x,dy=door.p2.y-door.p1.y,L=dx*dx+dy*dy;
  if(!L)return [];
  const ranges:number[][]=[];
  for(const owner of [door.a,door.b])for(const poly of level.visibleRegions[active]?.[owner]||[]){
    const clip=clipSegToConvex(door.p1,door.p2,poly,1e-7);if(!clip)continue;
    const ts=clip.map(p=>((p.x-door.p1.x)*dx+(p.y-door.p1.y)*dy)/L).sort((a,b)=>a-b);
    if(ts[1]-ts[0]>1e-6)ranges.push(ts);
  }
  ranges.sort((a,b)=>a[0]-b[0]);const merged:number[][]=[];
  for(const range of ranges){const last=merged[merged.length-1];if(last&&range[0]<=last[1]+1e-6)last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
  return merged.map(([a,b])=>[{x:door.p1.x+dx*a,y:door.p1.y+dy*a},{x:door.p1.x+dx*b,y:door.p1.y+dy*b}]);
}
