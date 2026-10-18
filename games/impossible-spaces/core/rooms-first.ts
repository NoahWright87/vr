import type { Door, GenParams, Level, Piece, Portal, Vec } from './types.ts';
import { centroid, insideConvex, mulberry32, polysOverlap, distPointSeg } from './geometry.ts';
import { pieceInFootprint, clearance } from './footprint.ts';
import { computeVisible, computeVisibleRegions, seeThroughFor } from './visibility.ts';

interface Box { x:number; y:number; w:number; h:number }
interface Port { owner:string; x:number; y:number; p1:Vec; p2:Vec; normal:Vec }
const key=(x:number,y:number)=>`${x},${y}`;
const cells=(b:Box)=>Array.from({length:b.w*b.h},(_,i)=>key(b.x+i%b.w,b.y+Math.floor(i/b.w)));
const overlap=(a:Box,b:Box)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const touches=(a:Box,b:Box)=>((a.x+a.w===b.x||b.x+b.w===a.x)&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>=2)||
  ((a.y+a.h===b.y||b.y+b.h===a.y)&&Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>=2);
const hallGap=(a:Box,b:Box)=>((a.x+a.w+2===b.x||b.x+b.w+2===a.x)&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>=2)||
  ((a.y+a.h+2===b.y||b.y+b.h+2===a.y)&&Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>=2);

/** Rooms are planned first on each physical layer, then connected by doors
 * and full-width grid routes. Stationary elevator layers reuse the footprint
 * to meet the exact room target. Failure never returns a shorter level. */
export function generateRoomsFirst(P:GenParams):Level {
  const target=P.roomCount??P.pieceCount,perLayer=P.roomsPerLayer??3;
  const roomSide=P.roomSize??1.2,margin=P.boundaryMargin??.1,w=P.minWidth,step=w/2;
  if(!Number.isSafeInteger(target)||target<1||!Number.isSafeInteger(perLayer)||perLayer<1||!Number.isFinite(roomSide)||roomSide<w||!Number.isFinite(w)||w<.8||!Number.isFinite(margin)||margin<0||!Number.isFinite(P.boundsW)||!Number.isFinite(P.boundsH))
    throw new Error('Check the room target, room size, width and margin.');
  const footprint=P.footprint??[{x:0,y:0},{x:P.boundsW,y:0},{x:P.boundsW,y:P.boundsH},{x:0,y:P.boundsH}];
  if(P.startAt&&clearance(P.startAt,footprint)<margin+.16)throw new Error('Step farther inside your traced area, then Generate!');
  const cols=Math.floor((P.boundsW-2*margin)/step+1e-7),rows=Math.floor((P.boundsH-2*margin)/step+1e-7);
  if(cols<2||rows<2)throw new Error('No room and elevator fit at this width. Try a smaller room or margin.');
  const rng=mulberry32(P.seed),shuffle=<T>(items:T[])=>items.map(value=>({value,sort:rng()})).sort((a,b)=>a.sort-b.sort).map(p=>p.value);
  const point=(x:number,y:number):Vec=>({x:margin+x*step,y:margin+y*step});
  const polygon=(b:Box):Vec[]=>[point(b.x,b.y),point(b.x+b.w,b.y),point(b.x+b.w,b.y+b.h),point(b.x,b.y+b.h)];
  const fitsCache=new Map<string,boolean>();
  const fits=(b:Box)=>{
    const k=`${b.x},${b.y},${b.w},${b.h}`;
    if(!fitsCache.has(k))fitsCache.set(k,b.x>=0&&b.y>=0&&b.x+b.w<=cols&&b.y+b.h<=rows&&pieceInFootprint({id:'fit',kind:'room',template:'fit',parts:[polygon(b)]},footprint,margin));
    return fitsCache.get(k)!;
  };
  const ports=(owner:string,b:Box):Port[]=>{
    const result:Port[]=[];
    for(let y=0;y<=b.h-2;y++) {
      result.push({owner,x:b.x-2,y:b.y+y,p1:point(b.x,b.y+y),p2:point(b.x,b.y+y+2),normal:{x:-1,y:0}});
      result.push({owner,x:b.x+b.w,y:b.y+y,p1:point(b.x+b.w,b.y+y),p2:point(b.x+b.w,b.y+y+2),normal:{x:1,y:0}});
    }
    for(let x=0;x<=b.w-2;x++) {
      result.push({owner,x:b.x+x,y:b.y-2,p1:point(b.x+x,b.y),p2:point(b.x+x+2,b.y),normal:{x:0,y:-1}});
      result.push({owner,x:b.x+x,y:b.y+b.h,p1:point(b.x+x,b.y+b.h),p2:point(b.x+x+2,b.y+b.h),normal:{x:0,y:1}});
    }
    return result;
  };
  const size=Math.max(3,Math.ceil(roomSide/step-1e-7)),candidates:Box[]=[];
  for(const [rw,rh] of [[size,size],[size+1,size],[size,size+1]])for(let y=0;y+rh<=rows;y++)for(let x=0;x+rw<=cols;x++) {
    const box={x,y,w:rw,h:rh};if(fits(box))candidates.push(box);
  }
  let baseline:Box|undefined,lift:Box|undefined,liftDoor:Port|undefined,anchorRoom:Box|undefined,bestScore=-Infinity;
  const anchors=P.startAt?candidates.filter(box=>insideConvex(P.startAt!,polygon(box))&&!polygon(box).some((a,i)=>distPointSeg(P.startAt!,a,polygon(box)[(i+1)%4])<.18)):[];
  for(const box of shuffle(candidates)) {
    for(const port of shuffle(ports('baseline',box))) {
      const cabin={x:port.x,y:port.y,w:2,h:2};if(!fits(cabin))continue;
      const anchor=P.startAt?(anchors.find(a=>a===box)||anchors.find(a=>!overlap(a,box)&&!overlap(a,cabin)&&touches(a,box))):undefined;
      if(P.startAt&&!anchor)continue;
      if(anchor&&anchor!==box&&(perLayer===1||target===1))continue;
      const neighbors=candidates.filter(a=>!overlap(a,box)&&!overlap(a,cabin)&&touches(a,box)).length;
      const score=neighbors*4-box.w*box.h*3-(anchor&&anchor!==box?anchor.w*anchor.h:0);
      if(score>bestScore){bestScore=score;baseline=box;lift=cabin;liftDoor=port;anchorRoom=anchor;}
    }
  }
  if(!baseline||!lift||!liftDoor)throw new Error('No connected room and stationary elevator fit here. Reduce room size or width, or stand farther inside.');
  const pieces:Piece[]=[],doors:Door[]=[],portals:Portal[]=[],layers:NonNullable<Level['roomsFirst']>['layers']=[];
  const seeThrough:Level['seeThrough']={},visibleRegions:Level['visibleRegions']={};
  let doorSerial=0;
  const makeDoor=(a:string,b:string,p:Port):Door=>({id:`d${doorSerial++}`,a,b,p1:{...p.p1},p2:{...p.p2},normal:{...p.normal}});
  const sameDoor=(a:Port,b:Door)=>distPointSeg(a.p1,b.p1,b.p2)<1e-6&&distPointSeg(a.p2,b.p1,b.p2)<1e-6;
  const used=(p:Port)=>doors.some(d=>(d.a===p.owner||d.b===p.owner)&&
    (distPointSeg(p.p1,d.p1,d.p2)<1e-6||distPointSeg(p.p2,d.p1,d.p2)<1e-6||sameDoor(p,d)));
  let remaining=target;
  while(remaining>0) {
    const layer=layers.length,cabinId=`e${layer}`,firstId=`r${layer}_0`,floorPieces:Piece[]=[],planned=[{...baseline}],ids=[firstId];
    const desired=Math.min(perLayer,remaining);
    if(layer===0&&anchorRoom&&anchorRoom!==baseline){planned.push(anchorRoom);ids.push(`r${layer}_1`);}
    while(planned.length<desired) {
      const available=shuffle(candidates).filter(box=>!overlap(box,lift)&&!planned.some(b=>overlap(b,box)));
      const preferHall=P.connectionMode==='halls'||(P.connectionMode!=='doors'&&rng()<.5);
      // Rooms are still placed before halls. Favor shared full-width walls
      // and leave at least a corridor-width gap elsewhere, rather than
      // scattering boxes with unusable half-width cracks between them.
      available.sort((a,b)=>{
        const score=(box:Box)=>(planned.some(p=>hallGap(p,box))?(preferHall?2000:1000):planned.some(p=>touches(p,box))?(preferHall?1000:2000):0)-box.w*box.h;
        return score(b)-score(a);
      });
      if(!available.length)break;
      planned.push(available[0]);ids.push(`r${layer}_${ids.length}`);
    }
    const room=(i:number):Piece=>({id:ids[i],kind:'room',template:'room-rect',parts:[polygon(planned[i])]});
    const cabin:Piece={id:cabinId,kind:'elevator',template:'alcove',parts:[polygon(lift)]};
    pieces.push(cabin,room(0));floorPieces.push(cabin,room(0));
    doors.push(makeDoor(firstId,cabinId,{...liftDoor,owner:firstId}));
    const connected=[0],floorRoomIds=[firstId],hallCells=new Set<string>();
    for(let i=1;i<planned.length;i++) {
      const targetPorts=shuffle(ports(ids[i],planned[i])),sourcePorts=shuffle(connected.flatMap(j=>ports(ids[j],planned[j]))).filter(p=>!used(p));
      const direct=sourcePorts.flatMap(s=>targetPorts.filter(t=>Math.hypot(s.p1.x-t.p1.x,s.p1.y-t.p1.y)<1e-6&&Math.hypot(s.p2.x-t.p2.x,s.p2.y-t.p2.y)<1e-6&&s.normal.x===-t.normal.x&&s.normal.y===-t.normal.y).map(t=>({s,t})))[0];
      if(direct) {
        const piece=room(i);pieces.push(piece);floorPieces.push(piece);doors.push(makeDoor(direct.s.owner,ids[i],direct.s));connected.push(i);floorRoomIds.push(ids[i]);continue;
      }
      const blocked=new Set([...cells(lift),...planned.flatMap(cells),...hallCells]);
      const validBlock=(x:number,y:number)=>fits({x,y,w:2,h:2})&&[key(x,y),key(x+1,y),key(x,y+1),key(x+1,y+1)].every(c=>!blocked.has(c));
      const goals=new Map(targetPorts.filter(p=>validBlock(p.x,p.y)).map(p=>[key(p.x,p.y),p]));
      const queue:{x:number;y:number}[]=[],parent=new Map<string,string|null>(),origin=new Map<string,Port>();
      for(const p of sourcePorts)if(validBlock(p.x,p.y)&&!parent.has(key(p.x,p.y))){const k=key(p.x,p.y);queue.push(p);parent.set(k,null);origin.set(k,p);}
      let found:string|undefined;
      for(let q=0;q<queue.length;q++) {
        const p=queue[q],k=key(p.x,p.y);if(goals.has(k)){found=k;break;}
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const x=p.x+dx,y=p.y+dy,next=key(x,y);
          if(parent.has(next)||!validBlock(x,y))continue;
          parent.set(next,k);origin.set(next,origin.get(k)!);queue.push({x,y});
        }
      }
      if(!found)continue; // Unconnected plans are retried on additional layers.
      const path:string[]=[];for(let k:string|null=found;k!==null;k=parent.get(k)!)path.unshift(k);
      const occupied=new Set<string>();for(const k of path){const [x,y]=k.split(',').map(Number);for(const c of cells({x,y,w:2,h:2}))occupied.add(c);}
      // Tile the corridor into disjoint rectangles. Shared seams disappear
      // in wallSegments; overlapping route squares never become double walls.
      const parts:Vec[][]=[];
      while(occupied.size) {
        const first=[...occupied].map(k=>k.split(',').map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0])[0],x=first[0],y=first[1];
        let rw=1,rh=1;while(occupied.has(key(x+rw,y)))rw++;
        while(Array.from({length:rw},(_,i)=>occupied.has(key(x+i,y+rh))).every(Boolean))rh++;
        const box={x,y,w:rw,h:rh};parts.push(polygon(box));for(const c of cells(box)){occupied.delete(c);hallCells.add(c);}
      }
      const hall:Piece={id:`h${layer}_${i}`,kind:'hall',template:'hall-routed',parts,joints:parts.map((_,j)=>j)};
      const piece=room(i),s=origin.get(found)!,t=goals.get(found)!;
      pieces.push(hall,piece);floorPieces.push(hall,piece);
      doors.push(makeDoor(s.owner,hall.id,s),makeDoor(ids[i],hall.id,t));
      connected.push(i);floorRoomIds.push(ids[i]);
    }
    const floorDoors=doors.filter(d=>floorPieces.some(p=>p.id===d.a)&&floorPieces.some(p=>p.id===d.b));
    for(const p of floorPieces)seeThrough[p.id]=seeThroughFor(p,floorDoors);
    Object.assign(visibleRegions,computeVisibleRegions(floorPieces,floorDoors,seeThrough));
    // The floor is an ordinary non-overlapping layout. Other floors may
    // reuse it freely, but are never connected by an open sightline.
    for(let i=0;i<floorPieces.length;i++)for(let j=i+1;j<floorPieces.length;j++)
      if(polysOverlap(floorPieces[i].parts,floorPieces[j].parts))throw new Error('Room connection overlap. Try another seed.');
    layers.push({index:layer,roomIds:floorRoomIds,cabinId});remaining-=floorRoomIds.length;
    if(layer>0)portals.push({id:`p${layer-1}`,a:layers[layer-1].cabinId,b:cabinId});
  }
  if(pieces.filter(p=>p.kind==='room').length!==target)throw new Error('The requested room count could not be completed.');
  // A single floor has no elevator destination. Remove the reserved cabin
  // rather than displaying a dead-end elevator with a non-working button.
  if(layers.length===1){
    const id=layers[0].cabinId;pieces.splice(pieces.findIndex(p=>p.id===id),1);
    for(let i=doors.length-1;i>=0;i--)if(doors[i].a===id||doors[i].b===id)doors.splice(i,1);
    delete seeThrough[id];for(const p of pieces)seeThrough[p.id]=seeThroughFor(p,doors);
    for(const id of Object.keys(visibleRegions))delete visibleRegions[id];
    Object.assign(visibleRegions,computeVisibleRegions(pieces,doors,seeThrough));layers[0].cabinId='';
  }
  const start=P.startAt?pieces.find(p=>p.kind==='room'&&layers[0].roomIds.includes(p.id)&&insideConvex(P.startAt!,p.parts[0]))!:pieces.find(p=>p.id===layers[0].roomIds[0])!;
  if(!start)throw new Error('No connected starting room fits where you are standing. Step farther inside.');
  return {version:1,params:{...P,generationStyle:'rooms-first',roomCount:target},bounds:{w:P.boundsW,h:P.boundsH},pieces,doors,portals,
    seeThrough,visible:computeVisible(visibleRegions),visibleRegions,startPieceId:start.id,startPos:P.startAt?{...P.startAt}:centroid(start.parts[0]),
    roomsFirst:{requestedRooms:target,layers}};
}
