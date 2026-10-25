import { OverlapPlanner } from '../expansive-spaces/overlap-planner.js';
import { rotateXZ } from '../expansive-spaces/redirection.js';
import { followPhysicalPose } from '../impossible-spaces/core/vr-runtime.ts';
import { clearance } from '../impossible-spaces/core/footprint.ts';
import type { Level, Vec } from '../impossible-spaces/core/types.ts';

/** Short route candidates include the threshold AND usable floor in the next piece. */
export function doorRoutes(level:Level,state:any){
  return level.doors.filter(d=>d.a===state.activeId||d.b===state.activeId).flatMap(d=>{
    const sign=d.a===state.activeId?1:-1,mid={x:(d.p1.x+d.p2.x)/2,y:(d.p1.y+d.p2.y)/2};
    const end={x:mid.x+d.normal.x*sign*.45,y:mid.y+d.normal.y*sign*.45};
    const closed=level.closedDoors;level.closedDoors=closed?.filter(id=>id!==d.id);
    try {
    const probe={...state,pos:{...state.pos}},points:Vec[]=[];let from=state.pos;
    for(const to of [mid,end]){const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/.1));
      for(let i=1;i<=steps;i++){const p={x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps};if(!followPhysicalPose(level,probe,p))return [];points.push(p);}from=to;}
    return [{id:d.id,mid,end,points,distance:Math.hypot(mid.x-state.pos.x,mid.y-state.pos.y)+.45}];
    }finally{level.closedDoors=closed;}
  });
}
export function routeClearance(points:Vec[],pivot:Vec,physical:Vec,yaw:number,boundary:Vec[],gain=1){
  let min=Infinity,penalty=0;
  for(const p of points){const v=rotateXZ({x:(p.x-pivot.x)/gain,z:(p.y-pivot.y)/gain},-yaw);
    const c=clearance({x:physical.x+v.x,y:physical.y+v.z},boundary);min=Math.min(min,c);penalty+=Math.max(0,.25-c);}
  return {min,score:min-penalty/Math.max(1,points.length)};
}
export class RoutePlanner extends OverlapPlanner {
  level:Level;getState:()=>any;
  constructor(level:Level,getState:()=>any){super();this.level=level;this.getState=getState;}
  lastBase:any={};target:any=null;lastRouteTime=-Infinity;routeInfo:any=null;routeMode=false;goalYaw:number|null=null;
  sample(position:any,context:any,time:number,options:any={}){
    const state=this.getState();
    if(this.target?.piece===state.activeId&&time-this.lastRouteTime<120&&this.goalYaw!==null){this.routeMode=true;return {...this.lastBase,minimumOverlap:0,correction:Math.atan2(Math.sin(this.goalYaw-context.mapping.yaw),Math.cos(this.goalYaw-context.mapping.yaw))};}
    const base=super.sample(position,context,time,options);this.lastBase=base;this.routeMode=false;
    if(time-this.lastRouteTime>=120||this.target?.piece!==state.activeId){
      const routes=doorRoutes(this.level,state),heading=options.heading+context.mapping.yaw;
      const rank=r=>{const dx=r.mid.x-state.pos.x,dy=r.mid.y-state.pos.y,d=Math.hypot(dx,dy)||1;
        return (-Math.sin(heading)*dx-Math.cos(heading)*dy)/d-.08*d+(this.target?.id===r.id ? .18:0);};
      routes.sort((a,b)=>rank(b)-rank(a));this.target=routes[0]?{...routes[0],piece:state.activeId}:null;this.lastRouteTime=time;
    }
    if(!this.target){this.routeInfo=null;this.goalYaw=null;return base;}
    // Rebuild sampled route as the player moves, retaining the chosen door until another is clearly preferred.
    const route=this.target;
    const boundary=context.boundary.map(p=>({x:p.x,y:p.z})),physical={x:position.x,y:position.z},gain=context.routeGain||1;
    const evaluate=delta=>routeClearance(route.points,state.pos,physical,context.mapping.yaw+delta,boundary,gain);
    const current=evaluate(0);let best={delta:0,...current};
    for(let i=-12;i<=12;i++){const delta=i*Math.PI/12,c=evaluate(delta);const score=c.score-.012*Math.abs(delta)+(Math.sign(delta)===options.preferredSide? .002:0);
      if(score>best.score+.005)best={delta,min:c.min,score};}
    this.goalYaw=context.mapping.yaw+best.delta;this.routeMode=true;this.routeInfo={door:route.id,distance:route.distance,clearance:current.min,bestClearance:best.min,feasible:best.min>=.2};
    return {...base,correction:best.delta,minimumOverlap:0};
  }
  limitYaw(requested:number,minimumOverlap:number){return this.routeMode?requested:super.limitYaw(requested,minimumOverlap);}
}

