import { insidePolygon, polygonArea } from '../../common/boundary-geometry.js';

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

export function validateFloor(points,boundary) {
  if(points.length<3)return 'Draw at least three corners.';
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return 'Invalid floor coordinates.';
  if(!boundary || boundary.length<3)return 'Wait for the headset boundary.';
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(distance(a,b)<.001)return 'Two corners overlap. Move or undo one.';
    if(!segmentInside(a,b,boundary))return 'Outside the cyan boundary. Move or undo the red section.';
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1 || (i===0&&j===points.length-1))continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return 'The outline crosses itself. Move or undo a corner.';
    }
    const c=points[(i+2)%points.length],r=sub(b,a),s=sub(c,b);
    if(Math.abs(cross(r,s))<EPS && r.x*s.x+r.y*s.y<0)return 'The outline doubles back. Move or undo a corner.';
  }
  if(Math.abs(polygonArea(points))<.02)return 'The drawn area is too small. Draw a wider outline.';
  return '';
}

export class FloorDrawing {
  constructor() {this.points=[];this.history=[];this.closed=false;this.saved=false;}
  checkpoint() {this.history.push({points:copy(this.points),closed:this.closed});if(this.history.length>50)this.history.shift();this.saved=false;}
  add(point, spacing=.03) {
    if(this.closed || this.points.length>=512)return;
    const points=this.points,last=points.at(-1);
    if(last&&distance(last,point)<spacing)return;
    // Reduce straight strokes without smoothing away corners or concavity.
    const previous=points.at(-2);
    if(previous) {
      const r=sub(last,previous),s=sub(point,last),length=distance(previous,point);
      if(length>0 && Math.abs(cross(r,s))/length<.008 && r.x*s.x+r.y*s.y>0)points.pop();
    }
    points.push({...point});this.saved=false;
  }
  finish() {
    this.checkpoint();
    if(this.points.length>3 && distance(this.points[0],this.points.at(-1))<.03)this.points.pop();
    this.closed=true;
  }
  nearest(point) {let best=-1,min=.12;this.points.forEach((p,i)=>{const d=distance(p,point);if(d<min){best=i;min=d;}});return best;}
  undo() {const state=this.history.pop();if(state){this.points=state.points;this.closed=state.closed;this.saved=false;}}
  clear() {this.checkpoint();this.points=[];this.closed=false;}
  accept(boundary) {const error=validateFloor(this.points,boundary);this.saved=this.closed&&!error;return error || (this.closed?'':'Finish the outline first.');}
}
