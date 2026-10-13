import { insidePolygon, polygonArea } from '../../common/boundary-geometry.js';
import polygonClipping from 'polygon-clipping';

const EPS = 1e-8;
const cross = (a,b) => a.x*b.y-a.y*b.x;
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const copy = points => points.map(p=>({...p}));

// Split at every boundary crossing, including collinear overlaps. Checking
// each resulting interval catches edges that cut across a concave notch.
export function segmentInside(a,b,boundary) {
  if (!insidePolygon(a,boundary) || !insidePolygon(b,boundary)) return false;
  const r=sub(b,a), rr=r.x*r.x+r.y*r.y, cuts=[0,1];
  if (rr<EPS*EPS) return true;
  for(let i=0;i<boundary.length;i++) {
    const c=boundary[i],d=boundary[(i+1)%boundary.length],s=sub(d,c),q=sub(c,a),den=cross(r,s);
    if(Math.abs(den)>EPS) {
      const t=cross(q,s)/den,u=cross(q,r)/den;
      if(t>=0&&t<=1&&u>=-EPS&&u<=1+EPS) cuts.push(t);
    } else if(Math.abs(cross(q,r))<EPS) {
      for(const p of [c,d]) {const v=sub(p,a),t=(v.x*r.x+v.y*r.y)/rr;if(t>0&&t<1)cuts.push(t);}
    }
  }
  cuts.sort((x,y)=>x-y);
  return cuts.slice(1).every((t,i)=>insidePolygon({x:a.x+r.x*(t+cuts[i])/2,y:a.y+r.y*(t+cuts[i])/2},boundary));
}

function intersects(a,b,c,d) {
  const r=sub(b,a),s=sub(d,c),q=sub(c,a),den=cross(r,s);
  if(Math.abs(den)>EPS) {const t=cross(q,s)/den,u=cross(q,r)/den;return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS;}
  if(Math.abs(cross(q,r))>EPS)return false;
  return Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))+EPS &&
    Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))+EPS;
}

export function validateFloor(points,boundary=null) {
  if(points.length<3)return 'Walk around the perimeter before saving.';
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return 'Invalid floor coordinates.';
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(distance(a,b)<1e-7)return 'Two corners overlap. Continue walking a clean lap.';
    if(boundary&&!segmentInside(a,b,boundary))return 'Outside the reference polygon.';
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1 || (i===0&&j===points.length-1))continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return 'The outline crosses itself. Walk a clean lap around the perimeter.';
    }
    const c=points[(i+2)%points.length],r=sub(b,a),s=sub(c,b);
    if(Math.abs(cross(r,s))<EPS && r.x*s.x+r.y*s.y<0)return 'The outline doubles back. Continue around the perimeter.';
  }
  if(Math.abs(polygonArea(points))<.02)return 'The area is too small. Walk a wider outline.';
  return '';
}

const projection = (p,a,b) => {
  const r=sub(b,a),length=r.x*r.x+r.y*r.y;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*r.x+(p.y-a.y)*r.y)/length)):0;
  return {x:a.x+r.x*t,y:a.y+r.y*t,t};
};
const clean = points => {
  const result=points.filter((p,i)=>i===0||distance(p,points[i-1])>1e-7);
  if(result.length>3&&distance(result[0],result.at(-1))<1e-7)result.pop();
  // A lap may begin with a short adjustment onto the perimeter. Remove a
  // collinear return over that approach, rather than rejecting every later
  // lap for a doubled-back starting tail. Preserve even tiny concave notches.
  for(let changed=true;changed&&result.length>3;) {
    changed=false;
    for(let i=0;i<result.length;i++) {
      const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length],r=sub(b,a),s=sub(c,b);
      if(Math.abs(cross(r,s))<1e-7 && r.x*s.x+r.y*s.y<0 && Math.min(distance(a,b),distance(b,c))<.3){result.splice(i,1);changed=true;break;}
    }
  }
  return copy(result);
};

function reduceOpen(points,tolerance,head,boundary,winding=0) {
  if(points.length<3)return copy(points);
  const keep=new Set([0,points.length-1]);
  points.forEach((p,i)=>{if(head&&distance(p,head)<.75)keep.add(i);});
  const anchors=Array.from(keep).sort((a,b)=>a-b),stack=anchors.slice(1).map((end,i)=>[anchors[i],end]);
  while(stack.length) {
    const [start,end]=stack.pop();if(end-start<2)continue;
    const a=points[start],b=points[end];let split=-1,max=tolerance,outer=0;
    for(let i=start+1;i<end;i++) {
      const d=distance(points[i],projection(points[i],a,b));
      const outside=-cross(sub(b,a),sub(points[i],a))*winding;
      // A shortcut may smooth a shallow inward wobble, but must keep an
      // outward extremum: simplification cannot undo a measured outer edge.
      if(outside>Math.max(EPS,outer)){outer=outside;split=i;}
      else if(!outer&&d>max){max=d;split=i;}
    }
    if(split<0&&boundary&&!segmentInside(a,b,boundary))split=Math.floor((start+end)/2);
    if(split>=0){keep.add(split);stack.push([start,split],[split,end]);}
  }
  return Array.from(keep).sort((a,b)=>a-b).map(i=>({...points[i]}));
}

export function simplifyWalk(points,{closed=false,head=null,boundary=null,tolerance=.035,preserveOuter=false}={}) {
  if(points.length<3)return copy(points);
  if(!closed)return reduceOpen(points,tolerance,head,boundary);
  const source=clean(points);
  const winding=preserveOuter?Math.sign(source.reduce((n,a,i)=>n+cross(a,source[(i+1)%source.length]),0)):0;
  // Two separated anchors avoid the coincident endpoints of a closed RDP pass.
  let opposite=1;
  for(let i=2;i<source.length;i++)if(distance(source[0],source[i])>distance(source[0],source[opposite]))opposite=i;
  const first=reduceOpen(source.slice(0,opposite+1),tolerance,head,boundary,winding);
  const second=reduceOpen(source.slice(opposite).concat([source[0]]),tolerance,head,boundary,winding);
  const result=first.slice(0,-1).concat(second.slice(0,-1));
  // Simplification never turns a valid polygon into an invalid one.
  if(validateFloor(result,boundary)&&!validateFloor(source,boundary))return source;
  return result;
}

function nearestOn(p,polygon) {
  let best=null;
  polygon.forEach((a,i)=>{
    const hit=projection(p,a,polygon[(i+1)%polygon.length]),d=distance(p,hit);
    if(!best||d<best.distance)best={...hit,index:i,distance:d};
  });
  return best;
}
const ring=points=>[points.map(p=>[p.x,p.y])];
export function containsWalkedArea(outer,inner) {
  if(!inner.length)return true;
  if(outer.length<3)return false;
  return polygonClipping.difference(ring(inner),ring(outer)).every(poly=>
    polygonArea(poly[0].map(([x,y])=>({x,y})))<1e-10);
}

// RDP finds nearly straight stretches. Move each replacement line OUT to
// support its furthest sample, then intersect adjacent lines to recover
// corners. Accept only a simple polygon containing the entire source area.
export function straightenWalk(points,{head=null,tolerance=.035}={}) {
  if(points.length<4)return copy(points);
  const source=clean(points),anchors=simplifyWalk(source,{closed:true,head,tolerance});
  if(anchors.length>=source.length||anchors.length<3)return copy(source);
  const winding=Math.sign(source.reduce((n,a,i)=>n+cross(a,source[(i+1)%source.length]),0));
  const indices=anchors.map(p=>source.findIndex(q=>distance(p,q)<1e-7));
  if(indices.some(i=>i<0))return copy(source);
  const lines=anchors.map((a,i)=>{
    const b=anchors[(i+1)%anchors.length],edge=sub(b,a),length=distance(a,b);
    let offset=0,index=indices[i];
    for(let count=0;index!==indices[(i+1)%anchors.length]&&count<source.length;count++) {
      offset=Math.max(offset,-cross(edge,sub(source[index],a))*winding/length);
      index=(index+1)%source.length;
    }
    const normal={x:edge.y*winding/length,y:-edge.x*winding/length};
    return {a:{x:a.x+normal.x*offset,y:a.y+normal.y*offset},edge};
  });
  const result=[];
  for(let i=0;i<lines.length;i++) {
    const previous=lines[(i+lines.length-1)%lines.length],current=lines[i],den=cross(previous.edge,current.edge);
    let p;
    if(Math.abs(den)<EPS) {
      // Parallel protected segments can meet unchanged. Different offsets
      // would require a step; retain the original instead of inventing one.
      if(Math.abs(cross(sub(current.a,previous.a),current.edge))>EPS)return copy(source);
      p={...current.a};
    } else {
      const t=cross(sub(current.a,previous.a),current.edge)/den;
      p={x:previous.a.x+previous.edge.x*t,y:previous.a.y+previous.edge.y*t};
    }
    if(distance(p,anchors[i])>tolerance*3)return copy(source);
    result.push(p);
  }
  if(validateFloor(result)||!containsWalkedArea(result,source))return copy(source);
  return result;
}

// Each outward sample extends its nearest existing edge. This
// adds the reached point immediately, including at corners or far beyond
// the reported rectangle. It never requires completing another arc or lap.
function reachedPatch(point,area) {
  const hit=nearestOn(point,area),a=area[hit.index],b=area[(hit.index+1)%area.length];
  const samples=[a,b,
    {x:point.x-.002,y:point.y-.002},{x:point.x+.002,y:point.y-.002},
    {x:point.x+.002,y:point.y+.002},{x:point.x-.002,y:point.y+.002}];
  const n=area.length,winding=Math.sign(area.reduce((sum,p,i)=>sum+cross(p,area[(i+1)%n]),0));
  // If an earlier reach made a convex tip, extend both of its exposed
  // sides together. This fills a corner instead of extruding a thin finger.
  // Stop at concave turns so furniture indentations are not bridged.
  for(const direction of [-1,1]) {
    let index=direction<0?hit.index:(hit.index+1)%n;
    for(let count=0;count<n-1;count++) {
      const previous=area[(index+n-1)%n],current=area[index],next=area[(index+1)%n];
      if(cross(sub(current,previous),sub(next,current))*winding<-EPS)break;
      const other=direction<0?previous:next;
      const from=direction<0?other:current,to=direction<0?current:other;
      if(cross(sub(to,from),sub(point,from))*winding>EPS)break;
      samples.push(other);index=(index+direction+n)%n;
    }
  }
  // A 2 mm pad gives a collinear corner reach actual area rather than a
  // zero-width line, and keeps the tracked point inside after triangulation.
  // This hull is only the local patch, never a hull of the whole room.
  samples.sort((a,b)=>a.x-b.x||a.y-b.y);
  const half=points=>{
    const result=[];
    for(const p of points) {
      while(result.length>1&&cross(sub(result.at(-1),result.at(-2)),sub(p,result.at(-1)))<=0)result.pop();
      result.push(p);
    }
    return result;
  };
  return half(samples).slice(0,-1).concat(half(samples.slice().reverse()).slice(0,-1));
}

export function unionWalkedAreas(previous,current) {
  if(current.length<3)throw new Error('Walk around the perimeter before saving.');
  const areas=previous.length?polygonClipping.union(ring(previous),ring(current)):polygonClipping.union(ring(current));
  if(areas.length!==1||areas[0].length!==1)throw new Error('Walk one connected perimeter without interior loops.');
  const result=areas[0][0].slice(0,-1).map(([x,y])=>({x,y}));
  const error=validateFloor(result);if(error)throw new Error(error);
  return result;
}

// The visible envelope IS the stored area. Every live expansion, completed
// lap and straightening contains it, so moving away cannot undo an earlier
// preview. One initial lap establishes concavity; later points grow locally.
export class WalkingBoundary {
  constructor() {
    this.lap=[];this.estimate=[];this.points=[];
    this.laps=0;this.length=0;this.closure=null;this.error='';this.closed=false;
  }
  add(point) {
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;
    let expanded=false;
    if(this.estimate.length&&!insidePolygon(point,this.estimate)) {
      try {
        const base=straightenWalk(this.estimate);
        this.estimate=insidePolygon(point,base)?base:unionWalkedAreas(base,reachedPatch(point,base));
        expanded=true;this.error='';
      }
      catch(error){this.error=error.message;}
    }
    if(this.estimate.length) {
      // Once the first outline exists, no more lap matching is needed.
      // Keep one position rather than accumulating another stroke.
      this.lap=[{...point}];this.length=0;this.closure=null;
      if(expanded||!this.lastHead||distance(point,this.lastHead)>=.08) {
        this.lastHead={...point};this.preview(point);return true;
      }
      return false;
    }
    // The first stroke uses regular spacing. Live expansion above has no
    // such threshold: even a tiny outward position updates the area.
    if(this.lap.length&&distance(point,this.lap.at(-1))<.04)return false;
    if(this.lap.length>=8192){this.error='Too many samples in one lap. Restart calibration.';return false;}
    if(this.lap.length)this.length+=distance(point,this.lap.at(-1));
    this.lap.push({...point});
    if(this.lap.length>8&&this.length>2) {
      // Find a return to ANY earlier section. The player may have started in
      // the room's middle and walked out to the perimeter before doing laps.
      if(!this.closure) {
        let travelled=0;
        for(let i=0;i<this.lap.length-8;i++) {
          if(i)travelled+=distance(this.lap[i-1],this.lap[i]);
          if(this.length-travelled<2)break;
          const d=distance(point,this.lap[i]);
          if(d<.3){this.closure={start:i,index:this.lap.length-1,distance:d};break;}
        }
      }
      const d=this.closure?distance(point,this.lap[this.closure.start]):Infinity;
      if(this.closure&&d<this.closure.distance){this.closure.index=this.lap.length-1;this.closure.distance=d;}
      // Wait until we pass the closest return, instead of shaving a corner
      // as soon as we enter a radius around the starting position.
      if(this.closure&&d>this.closure.distance+.08) {
        const index=this.closure.index;
        if(this.complete(this.lap.slice(this.closure.start,index+1))) {
          this.lap=this.lap.slice(index);this.length=this.lap.slice(1).reduce((n,p,i)=>n+distance(p,this.lap[i]),0);
          this.closure=null;
        } else this.closure=null;
      }
    }
    if(this.estimate.length) {
      if(!insidePolygon(point,this.estimate))this.estimate=unionWalkedAreas(this.estimate,reachedPatch(point,this.estimate));
      this.lap=[{...point}];this.length=0;this.closure=null;
    }
    if(this.estimate.length||!this.lastHead||distance(point,this.lastHead)>=.08){this.lastHead={...point};this.preview(point);return true;}
    return false;
  }
  complete(raw) {
    try {this.estimate=unionWalkedAreas(this.estimate,clean(raw));}
    catch(error){this.error=error.message;return false;}
    this.laps++;this.error='';return true;
  }
  preview(head) {
    if(!this.estimate.length) {
      this.closed=false;this.points=simplifyWalk(this.lap,{head});return;
    }
    this.estimate=straightenWalk(this.estimate,{head});
    this.closed=true;this.points=copy(this.estimate);
  }
  finalise() {
    // Close the initial stroke if needed. Later positions already belong
    // to the persistent envelope; saving only straightens outward.
    if(!this.estimate.length) {
      if(!this.closure)return {error:'Finish one lap around the perimeter, returning near where it began.',points:[]};
      const raw=this.lap.slice(this.closure.start,this.closure.index+1);
      if(!this.complete(raw))return {error:this.error,points:[]};
    }
    this.preview(null);
    const points=copy(this.estimate);
    const error=validateFloor(points);
    // Returning from the confirmation preview resumes direct expansion.
    if(!error){this.lap=this.lap.length?[{...this.lap.at(-1)}]:[];this.length=0;this.closure=null;}
    return {error,points:error?[]:copy(points)};
  }
}
