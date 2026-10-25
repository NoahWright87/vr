import { generateLevel } from '../impossible-spaces/core/generator.ts';
import { connectedWing,decorateLevel } from './architecture.ts';
import { computeVisible,computeVisibleRegions,seeThroughFor } from '../impossible-spaces/core/visibility.ts';
import type { Level } from '../impossible-spaces/core/types.ts';
export function growWing(level:Level,from:string,to:string,seed:number,options:any={}):Level {
  const ids=connectedWing(level,to,from),cabin=level.pieces.find(p=>p.id===to)!;
  const d=level.doors.find(d=>d.a===to||d.b===to)!;
  const normal=d.a===to?d.normal:{x:-d.normal.x,y:-d.normal.y};
  const wing=generateLevel({...level.params,startAt:undefined,seed,elevatorBays:true,entryCabin:{piece:cabin,exit:{p1:d.p1,p2:d.p2,normal}}});
  decorateLevel(wing,options);
  const prefix=`wing${seed}:`,id=(old:string)=>old===wing.startPieceId?to:prefix+old;
  const next=structuredClone(level);
  next.pieces=[...next.pieces.filter(p=>!ids.has(p.id)),...wing.pieces.map(p=>({...p,id:id(p.id)}))];
  next.doors=[...next.doors.filter(d=>!ids.has(d.a)&&!ids.has(d.b)),...wing.doors.map(d=>({...d,id:prefix+d.id,a:id(d.a),b:id(d.b)}))];
  next.portals=[...next.portals.filter(p=>!ids.has(p.a)&&!ids.has(p.b)||(p.a===from&&p.b===to)||(p.b===from&&p.a===to)),...wing.portals.map(p=>({...p,id:prefix+p.id,a:id(p.a),b:id(p.b)}))];
  next.seeThrough=Object.fromEntries(next.pieces.map(p=>[p.id,seeThroughFor(p,next.doors)]));
  next.visibleRegions=computeVisibleRegions(next.pieces,next.doors,next.seeThrough);next.visible=computeVisible(next.visibleRegions);
  next.closedDoors=[...(next.closedDoors||[]).filter(id=>next.doors.some(d=>d.id===id)),...(wing.closedDoors||[]).map(d=>prefix+d)];
  return next;
}
