import { ExpandedWalker, expandBoundary } from '../walking.ts';
import { generateLevel } from '../../impossible-spaces/core/generator.ts';
import { normalizeFootprint } from '../../impossible-spaces/core/footprint.ts';
import { DEFAULT_MIX } from '../../impossible-spaces/core/templates.ts';
import { createRuntime, colliderWalls, walkableAreas } from '../../impossible-spaces/core/runtime.ts';
import { createRide, beginRide, advanceRide } from '../../impossible-spaces/core/vr-runtime.ts';
import { centroid, insideConvex, distPointSeg, segIntersect, edgesOf, signedArea } from '../../impossible-spaces/core/geometry.ts';
import { wrapYaw } from '../../expansive-spaces/redirection.js';
import type { Level, Vec } from '../../impossible-spaces/core/types.ts';

export const VERSION = 1;
export const DT = 1 / 90;
export const SHAPES = ['oblong', 'rectangle', 'l', 'notch'];
export const PROFILES = ['purposeful', 'cautious', 'curious'];
export const DEFAULT_CONFIG = {
  shapes: ['oblong'], profiles: ['purposeful'], scales: [1.25], gains: [1.2],
  seeds: 1, startSeed: 42, seconds: 180, pieces: 12, boundaryStop: true,
  speedForMax: 2, steeringEnabled: true, turnEnabled: true, maxCurvature: 5,
  steeringSpeed: 2, maxSteeringRate: 6, lookAhead: 1.5, wallMargin: .4,
  minTurnGain: .9, maxTurnGain: 200 / 180, turnSpeed: 180, alignmentStrength: 1,
};
export type Config = typeof DEFAULT_CONFIG;
export type Job = Config & { shape: string; profile: string; scale: number; gain: number; seed: number };
export function validateConfig(raw: any): Config {
  const c = { ...DEFAULT_CONFIG, ...raw };
  const range = (key: string, min: number, max: number, integer = false) => {
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max || (integer && !Number.isInteger(c[key])))
      throw new Error(`Invalid ${key}: expected ${min}–${max}${integer ? ' whole numbers' : ''}.`);
  };
  for (const [key, allowed] of [['shapes', SHAPES], ['profiles', PROFILES]] as const) {
    if (!Array.isArray(c[key]) || !c[key].length || c[key].length > allowed.length || c[key].some(v => !allowed.includes(v))) throw new Error(`Choose valid ${key}.`);
    c[key] = [...new Set(c[key])];
  }
  for (const key of ['scales', 'gains']) {
    if (!Array.isArray(c[key]) || !c[key].length || c[key].length > 10 || c[key].some(v => !Number.isFinite(v) || v < 1 || v > 2)) throw new Error(`${key} must contain 1–10 values between 1 and 2.`);
    c[key] = [...new Set(c[key])];
  }
  range('seeds', 1, 10000, true); range('startSeed', 0, 999999, true);
  range('seconds', 10, 600); range('pieces', 2, 100, true);
  range('speedForMax', .8, 4); range('maxCurvature', 0, 20); range('steeringSpeed', .8, 4);
  range('maxSteeringRate', 1, 30); range('lookAhead', .5, 3); range('wallMargin', .1, 1);
  range('minTurnGain', .5, 1); range('maxTurnGain', 1, 1.5); range('turnSpeed', 60, 360); range('alignmentStrength', 0, 1);
  for (const key of ['boundaryStop', 'steeringEnabled', 'turnEnabled']) if (typeof c[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
  if (c.seeds * c.shapes.length * c.profiles.length * c.scales.length * c.gains.length > 100000) throw new Error('Limit a batch to 100,000 episodes; split larger sweeps.');
  return c;
}
export function* jobs(config: Config): Generator<Job> {
  const c = validateConfig(config);
  // Same seed across settings means the same physical shape and personality.
  for (let i = 0; i < c.seeds; i++) for (const shape of c.shapes) for (const profile of c.profiles)
    for (const scale of c.scales) for (const gain of c.gains)
      yield { ...c, shape, profile, scale, gain, seed: (c.startSeed + i) % 1000000 };
}
export const totalJobs = (c: Config) => c.seeds * c.shapes.length * c.profiles.length * c.scales.length * c.gains.length;
function random(seed: number) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function boundaryFor(shape: string, seed: number): Vec[] {
  const rng = random(seed + 103);
  const w = shape === 'oblong' ? 4.7 : 4 + rng() * 2;
  const h = shape === 'oblong' ? 2.1 : 3 + rng() * 1.5;
  let points = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (shape === 'l') points = [{x:0,y:0},{x:w,y:0},{x:w,y:h*.55},{x:w*.55,y:h*.55},{x:w*.55,y:h},{x:0,y:h}];
  if (shape === 'notch') points = [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:w*.65,y:h},{x:w*.65,y:h*.6},{x:w*.35,y:h*.6},{x:w*.35,y:h},{x:0,y:h}];
  // Rotate the whole footprint, never fill in concavities.
  const angle = seed === 42 ? 0 : (rng() - .5) * .5, c = Math.cos(angle), s = Math.sin(angle);
  return points.map(p => ({ x: p.x*c-p.y*s, y: p.x*s+p.y*c }));
}
const distance = (a: Vec, b: Vec) => Math.hypot(a.x-b.x, a.y-b.y);
const heading = (a: Vec, b: Vec) => Math.atan2(-(b.x-a.x), -(b.y-a.y));
const turn = (a: number, b: number, rate: number) => a + Math.max(-rate*DT, Math.min(rate*DT, wrapYaw(b-a)));
export function seen(from: Vec, target: Vec, yaw: number, walls: [Vec,Vec][], fov = Math.PI*.55, range = 6): boolean {
  if (distance(from,target) > range || Math.abs(wrapYaw(heading(from,target)-yaw)) > fov/2) return false;
  return !walls.some(([a,b]) => { const t = segIntersect(from,target,a,b); return t !== null && t > .00001 && t < .9999; });
}
export function exitFor(level: Level): string {
  const distances = new Map([[level.startPieceId,0]]), queue = [level.startPieceId];
  for (let i=0;i<queue.length;i++) for (const edge of [...level.doors,...level.portals]) {
    const other = edge.a === queue[i] ? edge.b : edge.b === queue[i] ? edge.a : null;
    if (other && !distances.has(other)) { distances.set(other,distances.get(queue[i])!+1); queue.push(other); }
  }
  return level.pieces.filter(p=>p.kind==='room'&&distances.has(p.id)).sort((a,b)=>distances.get(b.id)!-distances.get(a.id)!)[0]?.id || level.startPieceId;
}
// Local room navigation only. It knows the current room's collision geometry,
// not hidden doors or the global route to the exit. This is an optimistic local
// motor model, not a claim of empirically realistic human navigation.
export function localPath(level: Level, state: any, goal: Vec): Vec[] | null {
  const areas = walkableAreas(level,state), walls = colliderWalls(level,state), step = .14;
  const clear = (p: Vec) => areas.some(poly=>insideConvex(p,poly)) && walls.every(([a,b])=>distPointSeg(p,a,b)>=.175);
  const segment = (a: Vec,b: Vec) => {
    const n = Math.max(1,Math.ceil(distance(a,b)/.05));
    for(let i=1;i<=n;i++) if(!clear({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n})) return false;
    return true;
  };
  if(segment(state.pos,goal)) return [goal];
  const points=areas.flat(),minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
  const width=Math.ceil((Math.max(...points.map(p=>p.x))-minX)/step)+1,height=Math.ceil((Math.max(...points.map(p=>p.y))-minY)/step)+1;
  const count=width*height;if(count>30000)return null;
  const point=(id:number)=>({x:minX+(id%width)*step,y:minY+Math.floor(id/width)*step});
  const valid=new Uint8Array(count),previous=new Int32Array(count).fill(-2),queue:number[]=[];
  for(let id=0;id<count;id++) if(clear(point(id))) {
    valid[id]=1;
    if(distance(state.pos,point(id))<step*2&&segment(state.pos,point(id))) { previous[id]=-1;queue.push(id); }
  }
  let end=-1;
  for(let i=0;i<queue.length;i++) {
    const id=queue[i],p=point(id),x=id%width,y=Math.floor(id/width);
    if(distance(p,goal)<step*2&&segment(p,goal)){end=id;break;}
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx=x+dx,ny=y+dy,next=ny*width+nx;
      if(nx<0||nx>=width||ny<0||ny>=height||!valid[next]||previous[next]!==-2||!segment(p,point(next)))continue;
      previous[next]=id;queue.push(next);
    }
  }
  if(end<0)return null;
  const path=[goal];for(let id=end;id>=0;id=previous[id])path.push(point(id));
  path.reverse();
  const smooth:Vec[]=[];let anchor=state.pos,index=0;
  while(index<path.length) {
    let next=index;while(next+1<path.length&&segment(anchor,path[next+1]))next++;
    smooth.push(path[next]);anchor=path[next];index=next+1;
  }
  return smooth;
}

export class Episode {
  job: Job; level: Level; state: any; walker: ExpandedWalker; boundary: Vec[];
  physical: Vec; head = 0; body = 0; speed = 0; frame = 0; outcome = ''; reason = '';
  exit: string; exitPoint: Vec; ride = createRide(); path: Vec[] = [];
  known = new Set<string>(); used = new Map<string,number>(); visits = new Set<string>();
  ridden = new Set<string>(); target = ''; room = ''; scanUntil = 0; nextDecision = 0;
  lastProgress = 0; progressPoint: Vec; minClearance = Infinity; scans = 0; headTravel = 0; scanStartYaw = 0;
  trace: any[] = []; record: boolean; rng: ()=>number; traits: any; pauseUntil = 0;
  constructor(job: Job, record = false) {
    this.job=job;this.record=record;this.rng=random(job.seed+991);
    const original=boundaryFor(job.shape,job.seed),foot=normalizeFootprint(expandBoundary(original,job.scale));
    this.boundary=original.map(p=>({x:p.x-foot.origin.x,y:p.y-foot.origin.y}));
    // The first vertex is the lower left of all presets; start one metre inward
    // in its local axes (including the seeded boundary rotation).
    const a=original[0],b=original[1],angle=Math.atan2(b.y-a.y,b.x-a.x);
    const start={x:a.x+Math.cos(angle)-Math.sin(angle)-foot.origin.x,y:a.y+Math.sin(angle)+Math.cos(angle)-foot.origin.y};
    this.level=generateLevel({boundsW:foot.width,boundsH:foot.height,footprint:foot.polygon,startAt:start,stationaryElevators:true,
      boundaryMargin:.1,minWidth:.8,mix:DEFAULT_MIX,pieceCount:job.pieces,minSizePct:3,maxSizePct:15,branchChance:.3,seed:job.seed});
    this.state=createRuntime(this.level);this.physical={...start};this.progressPoint={...start};
    this.walker=new ExpandedWalker(this.level,this.boundary);
    this.walker.gain.setSettings({maxGain:job.gain,speedForMax:job.speedForMax});
    this.walker.redirection.setSettings(job);
    this.exit=exitFor(this.level);
    const exitPiece=this.level.pieces.find(p=>p.id===this.exit)!;
    this.exitPoint=centroid([...exitPiece.parts].sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)))[0]);
    this.traits=job.profile==='cautious'?{speed:.65,turn:1.4,scan:4,glance:.45,pause:.22}
      :job.profile==='curious'?{speed:1.05,turn:2.1,scan:3.5,glance:1.0,pause:.15}
      :{speed:1.25,turn:2.6,scan:2.8,glance:.25,pause:.04};
    this.walker.sample(this.physical,this.head,0,this.state);
    if(this.exit===this.level.startPieceId)this.finish('no-exit','Generation produced no other reachable room.');
    if(this.record)this.trace.push(this.snapshot());
  }
  get time(){return this.frame*DT;}
  finish(outcome:string,reason:string){this.outcome=outcome;this.reason=reason;}
  decide() {
    const piece=this.level.pieces.find(p=>p.id===this.state.activeId)!;
    const walls=colliderWalls(this.level,this.state),yaw=this.head+this.walker.transform.yaw;
    for(const door of this.level.doors.filter(d=>d.a===piece.id||d.b===piece.id)) {
      const mid={x:(door.p1.x+door.p2.x)/2,y:(door.p1.y+door.p2.y)/2};
      if(seen(this.state.pos,mid,yaw,walls))this.known.add(`${piece.id}:${door.id}`);
    }
    if(this.time<this.scanUntil||this.time<this.pauseUntil||this.path.length||this.ride.phase!=='idle')return;
    if(piece.id===this.exit&&seen(this.state.pos,this.exitPoint,yaw,walls)) {
      this.target='exit';this.path=localPath(this.level,this.state,this.exitPoint)||[];return;
    }
    if(this.time<this.nextDecision)return;
    this.nextDecision=this.time+.8;
    if(this.rng()<this.traits.pause){this.pauseUntil=this.time+.5+this.rng();return;}
    if(piece.kind==='elevator'&&!this.ridden.has(piece.id)) {
      this.target='ride';this.path=localPath(this.level,this.state,centroid(piece.parts[0]))||[];return;
    }
    const doors=this.level.doors.filter(d=>(d.a===piece.id||d.b===piece.id)&&this.known.has(`${piece.id}:${d.id}`))
      .sort((a,b)=>(this.used.get(a.id)||0)-(this.used.get(b.id)||0));
    for(const door of doors) {
      const sign=door.a===piece.id?1:-1;
      const goal={x:(door.p1.x+door.p2.x)/2+door.normal.x*sign*.08,y:(door.p1.y+door.p2.y)/2+door.normal.y*sign*.08};
      const path=localPath(this.level,this.state,goal);
      if(path){this.target=door.id;this.path=path;return;}
    }
    // Walk to a part centre to inspect around an occluding corner. This uses
    // local room geometry, but does not reveal hidden doors to the decision code.
    const centres=piece.parts.map(centroid).filter(p=>distance(p,this.state.pos)>.3);
    if(centres.length) this.path=localPath(this.level,this.state,centres[Math.floor(this.rng()*centres.length)])||[];
  }
  step() {
    if(this.outcome)return;
    this.frame++;
    if(this.state.activeId!==this.room) {
      if(this.target&&this.target!=='exit'&&this.target!=='ride')this.used.set(this.target,(this.used.get(this.target)||0)+1);
      this.room=this.state.activeId;this.visits.add(this.room);this.path=[];this.target='';
      this.scanUntil=this.time+this.traits.scan;this.scanStartYaw=this.body;this.scans++;this.lastProgress=this.time;this.progressPoint={...this.state.pos};
    }
    if(this.frame%9===1)this.decide();
    while(this.path.length&&distance(this.state.pos,this.path[0])<.035)this.path.shift();
    if(this.target==='exit'&&distance(this.state.pos,this.exitPoint)<.18){this.finish('completed','Reached the exit marker.');if(this.record)this.trace.push(this.snapshot());return;}
    if(this.target==='ride'&&!this.path.length&&this.ride.phase==='idle') {
      if(beginRide(this.level,this.state,this.ride))this.ridden.add(this.state.activeId);
    }
    const waypoint=this.path[0],moving=!!waypoint&&this.time>=this.scanUntil&&this.time>=this.pauseUntil&&this.ride.phase==='idle';
    const scanning=this.time<this.scanUntil;
    const desired=scanning?this.scanStartYaw+2*Math.PI*(1-(this.scanUntil-this.time)/this.traits.scan)
      :moving?heading(this.state.pos,waypoint)-this.walker.transform.yaw:this.body;
    this.body=turn(this.body,desired,this.traits.turn);
    // A full visual scan on room entry, then independent glances while walking.
    const gaze=scanning ? this.body+.6
      :this.body+Math.sin(this.time*1.7)*this.traits.glance;
    const oldHead=this.head;this.head=turn(this.head,gaze,3.8);this.headTravel+=Math.abs(wrapYaw(this.head-oldHead));
    const alignment=Math.max(0,Math.cos(wrapYaw(desired-this.body)));
    const targetSpeed=moving?this.traits.speed*alignment*Math.min(1,distance(this.state.pos,waypoint)/.15):0;
    this.speed+=Math.max(-2*DT,Math.min(1.5*DT,targetSpeed-this.speed));
    const amount=moving?Math.min(this.speed*DT,distance(this.state.pos,waypoint)):0;
    this.physical={x:this.physical.x-Math.sin(this.body)*amount,y:this.physical.y-Math.cos(this.body)*amount};
    const result=this.walker.sample(this.physical,this.head,this.time*1000,this.state,false,this.ride.phase!=='idle');
    const clearance=Math.min(...edgesOf(this.boundary).map(([a,b])=>distPointSeg(this.physical,a,b)));
    this.minClearance=Math.min(this.minClearance,clearance);
    if(result.outside)this.finish('boundary-exit','Physical head crossed the boundary.');
    else if(this.job.boundaryStop&&clearance<.2)this.finish('boundary-stop','Simulated user stopped within 20 cm of the physical edge; a reset would be required.');
    else if(!result.valid)this.finish('wall-block','Real walking crossed a virtual wall; no automatic re-anchor.');
    if(result.valid&&!result.outside)advanceRide(this.level,this.state,this.ride,DT);
    if(distance(this.progressPoint,this.state.pos)>.15){this.lastProgress=this.time;this.progressPoint={...this.state.pos};}
    if(!this.outcome&&this.time-this.lastProgress>15)this.finish('navigation-stall','No 15 cm progress for 15 seconds; local navigation or redirection needs inspection.');
    if(!this.outcome&&this.time>=this.job.seconds)this.finish('timeout','Did not reach the exit within the episode limit.');
    if(this.record&&(this.frame%9===0||this.outcome))this.trace.push(this.snapshot());
  }
  snapshot() {
    return {time:this.time,physical:{...this.physical},virtual:{...this.state.pos},head:this.head,body:this.body,
      yaw:this.walker.transform.yaw,activeId:this.state.activeId,doorsClosed:this.state.doorsClosed,
      mapping:{x:this.walker.transform.x,z:this.walker.transform.z,yaw:this.walker.transform.yaw},known:[...this.known],
      target:this.target,outcome:this.outcome,stats:{...this.walker.stats}};
  }
  result() {
    return {version:VERSION,job:this.job,outcome:this.outcome,reason:this.reason,seconds:this.time,
      stats:{...this.walker.stats},visited:this.visits.size,totalPieces:this.level.pieces.length,
      minClearance:Number.isFinite(this.minClearance)?this.minClearance:null,headTurnDegrees:this.headTravel*180/Math.PI,
      scans:this.scans,exit:this.exit,warning:this.level.warning||''};
  }
}
