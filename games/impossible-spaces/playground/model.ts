import { FloorPaint } from '../../boundaries/floor-paint.js';
import { validateFloor, containsWalkedArea } from '../../boundaries/floor-drawing.js';
import { normalizeFootprint } from '../core/footprint.ts';
import { DEFAULT_MIX } from '../core/templates.ts';
import type { GenParams, Vec } from '../core/types.ts';

export const DEFAULT_SETTINGS={style:'rooms-first',rooms:8,pieces:12,roomsPerLayer:3,roomSize:1.2,connectionMode:'halls',width:.8,margin:.1,seed:42,minSize:3,maxSize:15,branches:.3};
export const STORAGE_KEY='impossible-spaces-2d-v1';
export const STARTER=[{x:-1.5,y:-1.5},{x:1.5,y:-1.5},{x:1.5,y:1.5},{x:-1.5,y:1.5}];
export type PaintSnapshot={cellSize:number;cells:number[];bounds:{minX:number;minY:number;maxX:number;maxY:number}|null};

/** Pointer movement is deliberate drawing: resample its segments before
 * passing them to the same brush implementation used by XR. */
export function paintSegment(paint:FloorPaint,id:string,a:Vec,b:Vec,radius=.06){
  const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.04));
  for(let i=0;i<=n;i++)paint.paint(id,{x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n},radius);
}
export function starterPaint(){
  const paint=new FloorPaint();
  STARTER.forEach((a,i)=>paintSegment(paint,'starter',a,STARTER[(i+1)%STARTER.length]));
  paint.endStrokes();paint.flush();return paint;
}
export function snapshotPaint(paint:FloorPaint):PaintSnapshot{
  paint.flush();return {cellSize:paint.cellSize,cells:[...paint.cells],bounds:paint.bounds?{...paint.bounds}:null};
}
export function restorePaint(raw:PaintSnapshot){
  if(!raw||raw.cellSize!==.025||!Array.isArray(raw.cells)||raw.cells.length>1000000||!raw.bounds)throw new Error('This file has no valid painted floor.');
  const b=raw.bounds;
  if(![b.minX,b.minY,b.maxX,b.maxY].every(v=>Number.isInteger(v)&&Math.abs(v)<4094)||b.maxX<b.minX||b.maxY<b.minY||(b.maxX-b.minX+3)*(b.maxY-b.minY+3)>1000000)throw new Error('The saved grid is too large or invalid.');
  const paint=new FloorPaint();
  for(const cell of raw.cells){
    if(!Number.isInteger(cell)||cell<0||cell>=8192*8192)throw new Error('Invalid painted cell.');
    const x=Math.floor(cell/8192)-4096,y=cell%8192-4096;
    if(x<b.minX||x>b.maxX||y<b.minY||y>b.maxY)throw new Error('Painted cells do not match the saved grid.');
    paint.cells.add(cell);
  }
  paint.bounds={...b};paint.dirty=true;paint.flush();return paint;
}
export function extendWithCorners(paint:FloorPaint,corners:Vec[]){
  const error=validateFloor(corners);if(error)throw new Error(error);
  const next=restorePaint(snapshotPaint(paint));
  corners.forEach((a,i)=>paintSegment(next,'corners',a,corners[(i+1)%corners.length]));
  next.endStrokes();next.flush();
  if(next.contours.length!==1)throw new Error('Include part of the filled area in your extension so it joins the room.');
  return next;
}
export function makeParams(points:Vec[],settings=DEFAULT_SETTINGS):GenParams{
  const error=validateFloor(points);if(error)throw new Error(error);
  const f=normalizeFootprint(points),s={...DEFAULT_SETTINGS,...settings};
  const finite=(value:number,min:number,max:number)=>Number.isFinite(value)&&value>=min&&value<=max;
  if(!['growth','rooms-first'].includes(s.style)||!['halls','doors','mixed'].includes(s.connectionMode)||
    !finite(s.rooms,2,24)||!Number.isInteger(s.rooms)||!finite(s.pieces,2,24)||!Number.isInteger(s.pieces)||
    !finite(s.roomsPerLayer,1,5)||!Number.isInteger(s.roomsPerLayer)||!finite(s.roomSize,1.2,2)||
    ![.8,1,1.2].includes(s.width)||![.1,.15,.25,.4].includes(s.margin)||![1.2,1.6,2].includes(s.roomSize)||!finite(s.seed,0,999999)||!Number.isInteger(s.seed)||
    !finite(s.minSize,1,50)||!finite(s.maxSize,s.minSize,50)||!finite(s.branches,0,.75))throw new Error('Check the generation settings and room-size range.');
  return {generationStyle:s.style as GenParams['generationStyle'],boundsW:f.width,boundsH:f.height,footprint:f.polygon,boundaryMargin:s.margin,
    stationaryElevators:true,minWidth:s.width,mix:DEFAULT_MIX,pieceCount:s.style==='growth'?s.pieces:s.rooms,roomCount:s.rooms,
    roomsPerLayer:s.roomsPerLayer,roomSize:s.roomSize,connectionMode:s.connectionMode as GenParams['connectionMode'],minSizePct:s.minSize,maxSizePct:s.maxSize,branchChance:s.branches,seed:s.seed};
}
export function exportProject(paint:FloorPaint,boundary:Vec[]|null,settings=DEFAULT_SETTINGS,level:unknown=null){
  return {format:'impossible-spaces-playground',version:1,paint:snapshotPaint(paint),boundary:boundary?.map(p=>({...p}))||null,settings:{...settings},level};
}
export function importProject(raw:any){
  if(raw?.format!=='impossible-spaces-playground'||raw.version!==1)throw new Error('Choose a boundary exported from this playground.');
  const paint=restorePaint(raw.paint),settings={...DEFAULT_SETTINGS,...raw.settings};
  const boundary=raw.boundary;
  if(boundary!==null&&(!Array.isArray(boundary)||boundary.length>10000||validateFloor(boundary)||paint.contours.length!==1||!containsWalkedArea(boundary,paint.points)))throw new Error('The saved boundary does not contain the painted floor.');
  makeParams(boundary||STARTER,settings);
  return {paint,boundary:boundary?.map((p:Vec)=>({...p}))||null,settings};
}
