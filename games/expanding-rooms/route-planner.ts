import { OverlapPlanner,overlapFrame } from '../expansive-spaces/overlap-planner.js';
import { colliderWalls,walkableAreas,DEFAULTS } from '../impossible-spaces/core/runtime.ts';
import { clipSegToConvex,distPointSeg,segIntersect,centroid,seamsBetween } from '../impossible-spaces/core/geometry.ts';
import type { Level, Vec } from '../impossible-spaces/core/types.ts';

/** Sweep the body once against cached geometry, instead of simulating many physics frames. */
function clearSegment(level:Level,state:any,a:Vec,b:Vec,door:string){
  for(const [c,d] of colliderWalls(level,state,DEFAULTS,door)){
    if(segIntersect(a,b,c,d)!==null||Math.min(distPointSeg(a,c,d),distPointSeg(b,c,d),distPointSeg(c,a,b),distPointSeg(d,a,b))<DEFAULTS.radius-1e-6)return false;
  }
  const dx=b.x-a.x,dy=b.y-a.y,L=dx*dx+dy*dy;if(L<1e-12)return true;
  const intervals=walkableAreas(level,state).flatMap(poly=>{const clip=clipSegToConvex(a,b,poly,1e-8);return clip?[clip.map(p=>((p.x-a.x)*dx+(p.y-a.y)*dy)/L).sort((a,b)=>a-b)]:[];}).sort((a,b)=>a[0]-b[0]);
  let end=0;for(const [lo,hi]of intervals){if(lo>end+1e-6)return false;end=Math.max(end,hi);}return end>=1-1e-6;
}
function approach(level:Level,state:any,goal:Vec,door:string):Vec[]|null {
  if(clearSegment(level,state,state.pos,goal,door))return [goal];
  const piece=level.pieces.find(p=>p.id===state.activeId)!;
  const points=[state.pos,goal,...piece.parts.map(centroid)];
  for(let i=0;i<piece.parts.length;i++)for(let j=i+1;j<piece.parts.length;j++)for(const [a,b]of seamsBetween(piece.parts[i],piece.parts[j])){const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},length=Math.hypot(b.x-a.x,b.y-a.y),offset=Math.min(.3,length*.4);points.push(mid);for(const sign of [-1,1])points.push({x:mid.x-(b.y-a.y)/length*offset*sign,y:mid.y+(b.x-a.x)/length*offset*sign});}
  const distance=new Array(points.length).fill(Infinity),previous=new Array(points.length).fill(-1),done=new Set<number>();distance[0]=0;
  while(done.size<points.length){
    let at=-1;for(let i=0;i<points.length;i++)if(!done.has(i)&&(at<0||distance[i]<distance[at]))at=i;
    if(at<0||!Number.isFinite(distance[at]))break;if(at===1){const path=[];for(let id=1;id>0;id=previous[id])path.unshift(points[id]);return path;}
    done.add(at);
    for(let next=0;next<points.length;next++)if(!done.has(next)){
      const d=distance[at]+Math.hypot(points[at].x-points[next].x,points[at].y-points[next].y);
      if(d<distance[next]&&clearSegment(level,state,points[at],points[next],door)){distance[next]=d;previous[next]=at;}
    }
  }
  return null;
}
/** Routes include both the approach and usable floor beyond the actual threshold. */
export function doorRoutes(level:Level,state:any){
  return level.doors.filter(d=>d.a===state.activeId||d.b===state.activeId).flatMap(d=>{
    const sign=d.a===state.activeId?1:-1,mid={x:(d.p1.x+d.p2.x)/2,y:(d.p1.y+d.p2.y)/2};
    const end={x:mid.x+d.normal.x*sign*.45,y:mid.y+d.normal.y*sign*.45};
    const neighbor={...state,activeId:d.a===state.activeId?d.b:d.a};
    const path=approach(level,state,mid,d.id);if(!path||!clearSegment(level,neighbor,mid,end,d.id))return [];
    const points:Vec[]=[];let from=state.pos;
    let distance=0;for(const to of [...path,end]){distance+=Math.hypot(to.x-from.x,to.y-from.y);const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/.15));for(let i=1;i<=steps;i++)points.push({x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps});from=to;}
    return [{id:d.id,mid,end,points,distance,approach:path[0]}];
  });
}
const boundaries=new WeakMap<Vec[],[Vec,Vec][]>();
function boundaryClearance(p:Vec,boundary:Vec[]){
  let edges=boundaries.get(boundary);if(!edges){edges=boundary.map((a,i)=>[a,boundary[(i+1)%boundary.length]]);boundaries.set(boundary,edges);}
  let inside=false,min=Infinity;
  for(const [a,b] of edges){min=Math.min(min,distPointSeg(p,a,b));if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}
  return min<1e-8?0:(inside?min:-min);
}
export function routeClearance(points:Vec[],pivot:Vec,physical:Vec,yaw:number,boundary:Vec[],gain=1){
  let min=Infinity,penalty=0;const c=Math.cos(-yaw),s=Math.sin(-yaw);
  for(const p of points){const dx=(p.x-pivot.x)/gain,dy=(p.y-pivot.y)/gain;
    const distance=boundaryClearance({x:physical.x+c*dx+s*dy,y:physical.y-s*dx+c*dy},boundary);
    min=Math.min(min,distance);penalty+=Math.max(0,.25-distance);}
  return {min,score:min-penalty/Math.max(1,points.length)};
}
export class RoutePlanner extends OverlapPlanner {
  level:Level;getState:()=>any;
  constructor(level:Level,getState:()=>any){super();this.level=level;this.getState=getState;}
  boundarySource:any=null;boundary:Vec[]=[];lastOverlap=-Infinity;lastPiece='';lastBase:any={};target:any=null;lastRouteTime=-Infinity;routeInfo:any=null;routeMode=false;goalYaw:number|null=null;
  sample(position:any,context:any,time:number,options:any={}){
    const state=this.getState();
    if(this.lastPiece===state.activeId&&time-this.lastRouteTime<120){return {...this.lastBase,minimumOverlap:0,correction:this.goalYaw===null?0:Math.atan2(Math.sin(this.goalYaw-context.mapping.yaw),Math.cos(this.goalYaw-context.mapping.yaw))};}
    const frame=time-this.lastOverlap>=1000||this.lastPiece!==state.activeId?overlapFrame(position,context):null;if(frame)this.lastOverlap=time;
    const base={overlap:frame?.fraction??this.lastBase.overlap??null,bestOverlap:frame?.fraction??this.lastBase.overlap??null,correction:0,minimumOverlap:0};this.lastBase=base;this.routeMode=false;this.lastPiece=state.activeId;
    if(time-this.lastRouteTime>=120||this.target?.piece!==state.activeId){
      const routes=doorRoutes(this.level,state),heading=options.heading+context.mapping.yaw;
      const rank=r=>{const dx=r.approach.x-state.pos.x,dy=r.approach.y-state.pos.y,d=Math.hypot(dx,dy)||1;
        return (-Math.sin(heading)*dx-Math.cos(heading)*dy)/d-.08*d+(this.target?.id===r.id ? .18:0);};
      routes.sort((a,b)=>rank(b)-rank(a));this.target=routes[0]?{...routes[0],piece:state.activeId}:null;this.lastRouteTime=time;
    }
    if(!this.target){this.routeInfo=null;this.goalYaw=null;return base;}
    // Rebuild sampled route as the player moves, retaining the chosen door until another is clearly preferred.
    const route=this.target;
    if(this.boundarySource!==context.boundary){this.boundarySource=context.boundary;this.boundary=context.boundary.map(p=>({x:p.x,y:p.z}));}
    const boundary=this.boundary,physical={x:position.x,y:position.z},gain=context.routeGain||1;
    const evaluate=delta=>routeClearance(route.points,state.pos,physical,context.mapping.yaw+delta,boundary,gain);
    const current=evaluate(0);let best={delta:0,...current};
    for(let i=-12;i<=12;i++){const delta=i*Math.PI/12,c=evaluate(delta);const score=c.score-.012*Math.abs(delta)+(Math.sign(delta)===options.preferredSide? .002:0);
      if(score>best.score+.005)best={delta,min:c.min,score};}
    this.goalYaw=context.mapping.yaw+best.delta;this.routeMode=true;this.routeInfo={door:route.id,distance:route.distance,clearance:current.min,bestClearance:best.min,feasible:best.min>=.2};
    return {...base,correction:best.delta,minimumOverlap:0};
  }
  limitYaw(requested:number,minimumOverlap:number){return this.routeMode?requested:0;}
}

