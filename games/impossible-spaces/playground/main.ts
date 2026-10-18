import { DEFAULT_SETTINGS, STORAGE_KEY, STARTER, starterPaint, snapshotPaint, restorePaint, paintSegment, makeParams, exportProject, importProject } from './model.ts';
import { normalizeFootprint } from '../core/footprint.ts';
import { createRuntime, movePlayer, renderWalls } from '../core/runtime.ts';
import { createRide, beginRide, advanceRide, doorClosure, fullyInsideCabin } from '../core/vr-runtime.ts';
import { centroid, lerpV } from '../core/geometry.ts';
import type { Vec, Level } from '../core/types.ts';

const $=(id:string)=>document.getElementById(id) as any;
const canvas=$('map') as HTMLCanvasElement,ctx=canvas.getContext('2d')!;
let paint=starterPaint(),boundary:Vec[]|null=null,pending:Vec[]|null=null,settings={...DEFAULT_SETTINGS};
let validSettings={...DEFAULT_SETTINGS};
let level:Level|null=null,runtime:ReturnType<typeof createRuntime>|null=null,ride=createRide(),worker:Worker|null=null;
let phase:'edit'|'review'|'ready'='edit',tool='paint',history:ReturnType<typeof snapshotPaint>[]=[];
let origin={x:0,y:0},goal:Vec|null=null,drag:any=null,width=0,height=0,dpr=1,scale=65,center={x:0,y:0},lastMask=0;
const held=new Set<string>();let lastTime=performance.now(),lastHud='';
const message=(text:string)=>{$('status').textContent=text;};
const color=(id:string)=>{const index=level?.pieces.findIndex(p=>p.id===id)??0;return `hsl(${(index*137.508+265)%360} 57% 66%)`;};
const world=(p:Vec):Vec=>({x:p.x+origin.x,y:p.y+origin.y});
const screen=(p:Vec):Vec=>({x:(p.x-center.x)*scale+width/2,y:(p.y-center.y)*scale+height/2});
function pointer(e:PointerEvent):Vec{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-width/2)/scale+center.x,y:(e.clientY-r.top-height/2)/scale+center.y};}
function stopWorker(){worker?.terminate();worker=null;}
function discardLevel(){stopWorker();level=null;runtime=null;ride=createRide();goal=null;held.clear();$('counts').textContent='';$('warning').textContent='';}
function save(){
  // A half-edited numeric field must not make a valid floor unrestorable.
  try{makeParams(boundary||STARTER,settings);validSettings={...settings};}catch{}
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(exportProject(paint,boundary,validSettings)));}catch{$('storage-note').textContent='Storage is unavailable or full. Export a copy to keep this boundary.';}
}
function remember(){history.push(snapshotPaint(paint));if(history.length>20)history.shift();}
function path(points:Vec[]){ctx.beginPath();points.forEach((p,i)=>{const s=screen(p);if(i)ctx.lineTo(s.x,s.y);else ctx.moveTo(s.x,s.y);});ctx.closePath();}
function line(a:Vec,b:Vec){const p=screen(a),q=screen(b);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}
function fit(){
  const points=boundary||paint.contours.flat();if(!points.length)return;
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  center={x:(minX+maxX)/2,y:(minY+maxY)/2};scale=Math.min(130,(width-55)/Math.max(6,maxX-minX+2),(height-70)/Math.max(6,maxY-minY+2));
}
function syncSettings(){
  const form=$('settings') as HTMLFormElement;
  for(const [name,value] of Object.entries(settings)){const field=form.elements.namedItem(name) as HTMLInputElement;if(field)field.value=String(value);}
  $('target').value=String(settings.style==='growth'?settings.pieces:settings.rooms);
  $('target-title').textContent=settings.style==='growth'?'Target pieces':'Target rooms';
  document.querySelectorAll('[data-style]').forEach((el:HTMLElement)=>{el.hidden=el.dataset.style!==settings.style;});
}
function readSettings(){
  const oldStyle=settings.style,values=new FormData($('settings'));
  for(const [key,value] of values)settings[key]=['style','connectionMode'].includes(key)?String(value):Number(value);
  if(oldStyle===settings.style)settings[settings.style==='growth'?'pieces':'rooms']=Number($('target').value);
  else $('target').value=String(settings.style==='growth'?settings.pieces:settings.rooms);
  syncSettings();save();
}
function refresh(){
  const edit=phase==='edit',review=phase==='review',has=!!level;
  canvas.dataset.phase=phase;canvas.dataset.activePiece=runtime?.activeId||'';
  $('drawing-actions').hidden=!edit;$('review-actions').hidden=!review;$('edit-tools').hidden=!edit;
  $('walk-controls').hidden=!has;$('explore-card').hidden=!has;$('edit-ready').hidden=edit||review||has;
  $('generate').disabled=phase!=='ready'||!!worker;$('new-seed').disabled=phase!=='ready'||!!worker;
  $('generate').textContent=worker?'Generating…':'Generate level';
  $('phase-label').textContent=edit?'01 / DRAW YOUR AREA':review?'REVIEW / FINAL OUTLINE':has?'03 / EXPLORE THE LEVEL':'02 / READY TO GENERATE';
  $('map-title').textContent=edit?'Start small. Make room.':review?'Does this outline look right?':has?'One floor. Many places.':'Your boundary is ready.';
  $('area').textContent=`${(boundary?Math.abs(boundary.reduce((n,a,i)=>{const b=boundary![(i+1)%boundary!.length];return n+a.x*b.y-a.y*b.x;},0))/2:paint.area).toFixed(2)} m²`;
  $('generation-note').textContent=phase!=='ready'?'Set and confirm your boundary first.':settings.style==='growth'?'Original growth can stop short of its piece target; the result reports any shortfall.':'Rooms first returns the connected-room target or a failure. More layers can mean more elevator trips.';
  document.querySelectorAll('[data-tool]').forEach((el:HTMLElement)=>el.setAttribute('aria-pressed',String(el.dataset.tool===tool)));
  $('layer-label').hidden=$('view').value!=='inspect'||!level?.roomsFirst;
  if(has&&runtime){
    $('piece').value=runtime.activeId;$('piece-title').textContent=`${level!.pieces.find(p=>p.id===runtime!.activeId)!.kind} ${runtime.activeId}`;
    const destinations=level!.portals.filter(p=>p.a===runtime!.activeId||p.b===runtime!.activeId).map(p=>p.a===runtime!.activeId?p.b:p.a);
    const layers=level!.roomsFirst?.layers,index=layers?.findIndex(l=>l.cabinId===runtime!.activeId)??-1;
    const available=fullyInsideCabin(level!,runtime)&&ride.phase==='idle';
    $('ride-prev').hidden=!layers||index<=0||index===layers.length-1;
    $('ride-prev').disabled=!available||index<=0;
    $('ride-next').disabled=!available||!destinations.length;
    $('ride-next').textContent=ride.phase!=='idle'?`Doors ${ride.phase}`:layers?(index===layers.length-1?'Return':'Next layer'):'Ride elevator';
  }
}
function editBoundary(){discardLevel();phase='edit';boundary=null;pending=null;paint.endStrokes();message('Hold and drag to paint more floor. Close a loop to fill it, or brush across gaps.');refresh();save();}
function generate(newSeed=false){
  if(phase!=='ready'||!boundary)return;
  try{
    readSettings();if(newSeed){settings.seed=(settings.seed+1)%1000000;syncSettings();}
    const params=makeParams(boundary,settings);discardLevel();origin=normalizeFootprint(boundary).origin;
    const next=new Worker(new URL('../generate-worker.ts',import.meta.url),{type:'module'});worker=next;
    message('Generating inside the full confirmed polygon…');refresh();save();
    next.onmessage=event=>{
      if(worker!==next)return;stopWorker();
      if(event.data.error){message(`Generation did not fit: ${event.data.error}`);$('warning').textContent='Try a smaller room or door width, or a larger boundary. No short result has been substituted.';refresh();return;}
      level=event.data.level;runtime=createRuntime(level!);ride=createRide();
      $('piece').replaceChildren(...level!.pieces.map(p=>new Option(`${p.kind} ${p.id}`,p.id)));
      $('layer').replaceChildren(...(level!.roomsFirst?.layers||[]).map(l=>new Option(`Layer ${l.index+1} · ${l.roomIds.length} rooms`,String(l.index))));
      const count=(kind:string)=>level!.pieces.filter(p=>p.kind===kind).length;
      $('counts').textContent=`${count('room')} rooms · ${count('hall')} halls · ${count('elevator')} cabins${level!.roomsFirst?`\n${level!.roomsFirst.layers.length} layers · target ${settings.rooms} rooms`:`\n${level!.pieces.length} / ${settings.pieces} target pieces`}`;
      $('warning').textContent=level!.warning||'';message('Level ready. Tap the map to walk, or use the arrows. Enter a cabin fully to ride.');refresh();
    };
    next.onerror=()=>{if(worker===next){stopWorker();message('Generation failed. Adjust settings and try again.');refresh();}};
    next.postMessage(params);
  }catch(error){message((error as Error).message);refresh();}
}
function rideTo(previous=false){
  if(!level||!runtime)return;
  const layers=level.roomsFirst?.layers,index=layers?.findIndex(l=>l.cabinId===runtime!.activeId)??-1;
  const destination=layers?(layers[index+(previous?-1:1)]?.cabinId||(!previous?layers[index-1]?.cabinId:undefined)):undefined;
  if(layers&&!destination)return;
  if(beginRide(level,runtime,ride,destination)){goal=null;held.clear();message('Doors closing. The outside changes while the player stays in place.');refresh();}
}
function populateImport(raw:any){
  const restored=importProject(raw);discardLevel();paint=restored.paint;boundary=restored.boundary;settings=restored.settings;
  pending=null;history=[];phase=boundary?'ready':'edit';syncSettings();fit();refresh();save();
}

canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.isPrimary||drag)return;canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);const p=pointer(e);
  if(phase==='review')return;
  if(phase==='ready'){if(level&&runtime){goal={x:p.x-origin.x,y:p.y-origin.y};}return;}
  drag={id:e.pointerId,last:p,x:e.clientX,y:e.clientY,center:{...center}};
  if(tool==='paint'){remember();paint.paint('pointer',p,.15);}
});
canvas.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;const p=pointer(e);
  if(tool==='pan')center={x:drag.center.x-(e.clientX-drag.x)/scale,y:drag.center.y-(e.clientY-drag.y)/scale};
  else if(tool==='paint'){paintSegment(paint,'pointer',drag.last,p,.15);drag.last=p;}
});
function endPointer(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;paint.endStrokes();paint.flush();drag=null;if(paint.error)message(paint.error);refresh();save();}
canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
document.querySelectorAll('[data-tool]').forEach((el:HTMLElement)=>el.addEventListener('click',()=>{tool=el.dataset.tool!;paint.endStrokes();drag=null;message(tool==='paint'?'Hold and drag to paint. Close a loop to fill it, or brush directly across gaps.':'Drag the map to pan. Use + / − to zoom.');refresh();}));
$('undo').addEventListener('click',()=>{if(history.length)paint=restorePaint(history.pop()!);message('Last edit undone.');refresh();save();});
$('reset').addEventListener('click',()=>{remember();paint=starterPaint();message('Back to the starter square. Undo can restore your previous area.');fit();refresh();save();});
$('review').addEventListener('click',()=>{const result=paint.finalise();if(result.error){message(result.error);return;}pending=result.points;phase='review';message('Review the yellow polygon. It contains all painted floor, with a small allowance for straighter edges.');refresh();});
$('keep-editing').addEventListener('click',()=>{pending=null;phase='edit';message('Continue adding to the purple area.');refresh();});
$('confirm').addEventListener('click',()=>{boundary=pending!.map(p=>({...p}));pending=null;phase='ready';message('Boundary confirmed. Choose a style and Generate level.');refresh();save();if(innerWidth<=850)document.querySelector('.settings')!.scrollIntoView({block:'start'});});
$('edit-boundary').addEventListener('click',editBoundary);$('edit-ready').addEventListener('click',editBoundary);
$('settings').addEventListener('submit',e=>{e.preventDefault();generate();});
$('settings').addEventListener('change',()=>{readSettings();refresh();});
$('new-seed').addEventListener('click',()=>generate(true));$('fit').addEventListener('click',fit);
$('zoom-in').addEventListener('click',()=>{scale=Math.min(180,scale*1.25);});$('zoom-out').addEventListener('click',()=>{scale=Math.max(8,scale/1.25);});
$('view').addEventListener('change',refresh);$('layer').addEventListener('change',()=>{message('Inspecting one physical layer; walking still uses the current piece.');});
$('piece').addEventListener('change',()=>{if(!level||!runtime)return;runtime.activeId=$('piece').value;runtime.pos=centroid(level.pieces.find(p=>p.id===runtime!.activeId)!.parts[0]);runtime.doorsClosed=false;ride=createRide();goal=null;held.clear();message('Jumped to this piece for 2D inspection.');refresh();});
$('ride-prev').addEventListener('click',()=>rideTo(true));$('ride-next').addEventListener('click',()=>rideTo());
const movement:Record<string,Vec>={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
document.querySelectorAll('[data-move]').forEach((el:HTMLElement)=>{
  el.addEventListener('pointerdown',(e:PointerEvent)=>{el.setPointerCapture(e.pointerId);held.add(el.dataset.move!);goal=null;});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,()=>held.delete(el.dataset.move!));
});
const keyMap:Record<string,string>={w:'up',ArrowUp:'up',s:'down',ArrowDown:'down',a:'left',ArrowLeft:'left',d:'right',ArrowRight:'right'};
window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName))return;const key=keyMap[e.key]||keyMap[e.key.toLowerCase()];if(key&&level){held.add(key);goal=null;e.preventDefault();}if(e.key.toLowerCase()==='e'&&level)rideTo();});
window.addEventListener('keyup',e=>held.delete(keyMap[e.key]||keyMap[e.key.toLowerCase()]));
window.addEventListener('blur',()=>{held.clear();goal=null;});document.addEventListener('visibilitychange',()=>{held.clear();goal=null;});
$('export').addEventListener('click',()=>{
  try{readSettings();makeParams(boundary||STARTER,settings);const project={...exportProject(paint,boundary,settings,level),player:runtime?{piece:runtime.activeId,position:runtime.pos}:null};
    const url=URL.createObjectURL(new Blob([JSON.stringify(project)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='impossible-spaces-2d.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Exported the painted floor, boundary, settings and current layout.');
  }catch(error){message((error as Error).message);}
});
$('import').addEventListener('change',async()=>{const file=$('import').files?.[0];if(!file)return;try{if(file.size>12000000)throw new Error('Choose a JSON file smaller than 12 MB.');populateImport(JSON.parse(await file.text()));message('Boundary and settings loaded. Generate to reproduce the layout.');}catch(error){message(`Could not load: ${(error as Error).message}`);}finally{$('import').value='';}});

function floorPieces(){
  if(!level?.roomsFirst)return level?.pieces||[];
  const layer=level.roomsFirst.layers[Number($('layer').value)||0],ids=new Set([layer.cabinId,...layer.roomIds]);
  for(let changed=true;changed;){changed=false;for(const d of level.doors)if(ids.has(d.a)!==ids.has(d.b)){ids.add(d.a);ids.add(d.b);changed=true;}}
  return level.pieces.filter(p=>ids.has(p.id));
}
function draw(now:number){
  if(paint.dirty&&now-lastMask>100){paint.flush();lastMask=now;$('area').textContent=`${paint.area.toFixed(2)} m²`;}
  ctx.clearRect(0,0,width,height);ctx.lineWidth=1;ctx.font='10px system-ui';
  const minX=Math.floor(center.x-width/(2*scale)),maxX=Math.ceil(center.x+width/(2*scale)),minY=Math.floor(center.y-height/(2*scale)),maxY=Math.ceil(center.y+height/(2*scale));
  for(let x=minX;x<=maxX;x++){ctx.strokeStyle=x===0?'#314c64':'#1c2e41';line({x,y:minY},{x,y:maxY});if(scale>=32){ctx.fillStyle='#60778e';ctx.fillText(String(x),screen({x,y:0}).x+4,14);}}
  for(let y=minY;y<=maxY;y++){ctx.strokeStyle=y===0?'#314c64':'#1c2e41';line({x:minX,y},{x:maxX,y});}
  if(!level){
    for(const ring of paint.rings){path(ring);ctx.fillStyle='#9576cf38';ctx.fill();ctx.strokeStyle='#bc9ce6';ctx.lineWidth=1.3;ctx.stroke();}
    if(phase==='edit'){const c=screen({x:0,y:0});ctx.fillStyle='#b7a9cd';ctx.textAlign='center';ctx.fillText('3 × 3 m starter',c.x,c.y);ctx.textAlign='left';}
  }else if(runtime){
    const inspect=$('view').value==='inspect';
    if(inspect)for(const piece of floorPieces())for(const poly of piece.parts){path(poly.map(world));ctx.fillStyle=color(piece.id);ctx.globalAlpha=.15;ctx.fill();ctx.globalAlpha=.55;ctx.strokeStyle=color(piece.id);ctx.lineWidth=1;ctx.stroke();}ctx.globalAlpha=1;
    for(const draw of renderWalls(level,runtime)){
      for(const poly of draw.regions){path(poly.map(world));ctx.fillStyle=color(draw.pieceId);ctx.globalAlpha=inspect ? .28 : .42;ctx.fill();}ctx.globalAlpha=1;
      ctx.strokeStyle=color(draw.pieceId);ctx.lineWidth=draw.pieceId===runtime.activeId?3:2;for(const [a,b] of draw.walls)line(world(a),world(b));
      const poly=draw.regions[0];if(poly){const c=screen(world(centroid(poly)));ctx.fillStyle='#edf3fa';ctx.textAlign='center';ctx.fillText(draw.pieceId,c.x,c.y);ctx.textAlign='left';}
    }
    const shown=new Set(renderWalls(level,runtime).map(p=>p.pieceId));
    for(const door of level.doors.filter(d=>shown.has(d.a)&&shown.has(d.b)||d.a===runtime!.activeId||d.b===runtime!.activeId)){
      const closing=ride.phase!=='idle'&&(door.a===runtime.activeId||door.b===runtime.activeId)?doorClosure(ride):0;
      ctx.strokeStyle='#8af2d8';ctx.lineWidth=4;ctx.globalAlpha=.55;line(world(door.p1),world(door.p2));ctx.globalAlpha=1;
      if(closing){ctx.strokeStyle='#ffd784';ctx.lineWidth=5;line(world(door.p1),world(lerpV(door.p1,door.p2,closing/2)));line(world(door.p2),world(lerpV(door.p2,door.p1,closing/2)));}
    }
    const p=screen(world(runtime.pos));ctx.beginPath();ctx.arc(p.x,p.y,Math.max(5,.16*scale),0,Math.PI*2);ctx.fillStyle='#fff3b2';ctx.fill();ctx.strokeStyle='#473c20';ctx.lineWidth=2;ctx.stroke();
    if(goal){const g=screen(world(goal));ctx.beginPath();ctx.arc(g.x,g.y,5,0,Math.PI*2);ctx.strokeStyle='#fff3b2';ctx.lineWidth=1;ctx.stroke();}
  }
  const outline=pending||boundary;if(outline){path(outline);ctx.lineWidth=2;ctx.strokeStyle=pending?'#ffe079':'#64e3c6';ctx.stroke();if(pending){ctx.fillStyle='#ffe07913';ctx.fill();}}
}
function frame(now:number){
  const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;
  if(level&&runtime){
    if(ride.phase==='idle'){
      let x=0,y=0;for(const key of held){x+=movement[key]?.x||0;y+=movement[key]?.y||0;}
      if(!x&&!y&&goal){x=goal.x-runtime.pos.x;y=goal.y-runtime.pos.y;}
      const length=Math.hypot(x,y);
      if(length>.005){const amount=Math.min(1.3*dt,goal?length:Infinity),n=Math.max(1,Math.ceil(amount/.01)),before={...runtime.pos};for(let i=0;i<n;i++)movePlayer(level,runtime,x/length*amount/n,y/length*amount/n);
        if(goal&&(Math.hypot(runtime.pos.x-goal.x,runtime.pos.y-goal.y)<.03||Math.hypot(runtime.pos.x-before.x,runtime.pos.y-before.y)<.0001)){if(Math.hypot(runtime.pos.x-goal.x,runtime.pos.y-goal.y)>.05)message('A wall blocks this route. Walk through a doorway, or choose a closer point.');goal=null;}}
      else if(goal)goal=null;
    }else advanceRide(level,runtime,ride,dt);
    const hud=`${runtime.activeId}:${ride.phase}:${fullyInsideCabin(level,runtime)}`;if(hud!==lastHud){lastHud=hud;refresh();}
  }
  draw(now);requestAnimationFrame(frame);
}
new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect(),first=!width;width=rect.width;height=rect.height;dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(first)fit();}).observe(canvas);
try{const stored=localStorage.getItem(STORAGE_KEY);if(stored){populateImport(JSON.parse(stored));message(boundary?'Saved boundary restored. Choose a style and Generate level.':'Saved painted floor restored. Keep drawing or Set boundary.');}}catch{$('storage-note').textContent='Could not restore a saved floor. Export a copy after drawing to keep it.';}
syncSettings();refresh();requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>{stopWorker();held.clear();});
