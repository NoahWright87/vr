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
  if(points.length<3)return 'Walk a closed perimeter or paint a floor area before saving.';
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return 'Invalid floor coordinates.';
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(distance(a,b)<1e-7)return 'Two corners overlap. Paint a wider connection, then save again.';
    if(boundary&&!segmentInside(a,b,boundary))return 'Outside the reference polygon.';
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1 || (i===0&&j===points.length-1))continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return 'The outline crosses itself. Paint a wider connection, then save again.';
    }
    const c=points[(i+2)%points.length],r=sub(b,a),s=sub(c,b);
    if(Math.abs(cross(r,s))<EPS && r.x*s.x+r.y*s.y<0)return 'The outline doubles back. Paint a wider connection, then save again.';
  }
  if(Math.abs(polygonArea(points))<.02)return 'The area is too small. Paint a larger floor area.';
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

const ring=points=>[points.map(p=>[p.x,p.y])];
export function containsWalkedArea(outer,inner) {
  if(!inner.length)return true;
  if(outer.length<3)return false;
  return polygonClipping.difference(ring(inner),ring(outer)).every(poly=>
    polygonArea(poly[0].map(([x,y])=>({x,y})))<1e-10);
}
