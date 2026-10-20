import { simplifyWalk, validateFloor, containsWalkedArea } from './floor-drawing.js';
import { polygonArea } from '../../common/boundary-geometry.js';

const STRIDE=8192,OFFSET=4096,key=(x,y)=>(x+OFFSET)*STRIDE+y+OFFSET;
const xy=k=>[Math.floor(k/STRIDE)-OFFSET,k%STRIDE-OFFSET];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
const copy=points=>points.map(p=>({...p}));
function collinear(points){
  const result=[];
  for(const p of points){while(result.length>1&&Math.abs(cross(result.at(-2),result.at(-1),p))<1e-9)result.pop();result.push(p);}
  while(result.length>3&&Math.abs(cross(result.at(-1),result[0],result[1]))<1e-9)result.shift();
  while(result.length>3&&Math.abs(cross(result.at(-2),result.at(-1),result[0]))<1e-9)result.pop();
  return result;
}

// RDP removes grid stair-steps. An outward parallel offset supplies its
// tolerance allowance; bounded bevels prevent acute miter spikes. Accept
// only a simple polygon containing the ENTIRE original painted area.
export function polygonFromPaint(source,tolerance=.025){
  if(source.length<4)return copy(source);
  const reduced=simplifyWalk(source,{closed:true,tolerance});
  if(reduced.length>=source.length)return copy(source);
  if(containsWalkedArea(reduced,source))return reduced;
  const winding=Math.sign(reduced.reduce((sum,a,i)=>{const b=reduced[(i+1)%reduced.length];return sum+a.x*b.y-a.y*b.x;},0)),offset=tolerance+.002;
  const lines=reduced.map((a,i)=>{
    const b=reduced[(i+1)%reduced.length],length=distance(a,b),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length;
    return {a:{x:a.x+dy*winding*offset,y:a.y-dx*winding*offset},dx,dy};
  });
  const result=[];
  for(let i=0;i<lines.length;i++){
    const a=lines[(i+lines.length-1)%lines.length],b=lines[i],den=a.dx*b.dy-a.dy*b.dx;
    if(Math.abs(den)<1e-9)return copy(source);
    const t=((b.a.x-a.a.x)*b.dy-(b.a.y-a.a.y)*b.dx)/den,p={x:a.a.x+a.dx*t,y:a.a.y+a.dy*t};
    if(distance(p,reduced[i])>offset*2.5)return copy(source);
    result.push(p);
  }
  return !validateFloor(result)&&containsWalkedArea(result,source)?result:copy(source);
}

/** One additive bitmap for head and controller brushes. No nearest-edge
 * fan, polygon averaging, or unsampled closing segment. Enclosed unpainted
 * cells fill by outside flood-fill, so perimeter loops and gap repairs use
 * exactly the same operation. The displayed contour comes from this mask. */
export class FloorPaint {
  constructor({cellSize=.025,maxGridCells=1000000}={}){
    this.cellSize=cellSize;this.maxGridCells=maxGridCells;this.cells=new Set();
    this.strokes=new Map();this.blocked=new Set();this.error='';this.dirty=false;this.revision=0;this.rings=[];
    this.bounds=null;
  }
  endStroke(id){this.strokes.delete(id);this.blocked.delete(id);}
  endStrokes(){this.strokes.clear();this.blocked.clear();}
  add(point){return this.paint('walk',point,.06);}
  paint(id,point,radius=.1){
    if(!point||![point.x,point.y,radius].every(Number.isFinite)||radius<this.cellSize*.75||radius>.5)return false;
    if(this.blocked.has(id))return false;
    const previous=this.strokes.get(id),from=previous||point;
    if(previous&&distance(previous,point)>.6){this.blocked.add(id);this.error='Tracking or aim jumped. Release the trigger, or open the watch and Continue editing.';return false;}
    const s=this.cellSize,minX=Math.floor((Math.min(from.x,point.x)-radius)/s),maxX=Math.floor((Math.max(from.x,point.x)+radius)/s),minY=Math.floor((Math.min(from.y,point.y)-radius)/s),maxY=Math.floor((Math.max(from.y,point.y)+radius)/s);
    const b=this.bounds?{minX:Math.min(this.bounds.minX,minX),minY:Math.min(this.bounds.minY,minY),maxX:Math.max(this.bounds.maxX,maxX),maxY:Math.max(this.bounds.maxY,maxY)}:{minX,minY,maxX,maxY};
    if(Math.max(Math.abs(b.minX),Math.abs(b.minY),Math.abs(b.maxX),Math.abs(b.maxY))>=OFFSET-2||(b.maxX-b.minX+3)*(b.maxY-b.minY+3)>this.maxGridCells){this.error='Painted area is too large. Start a smaller calibration.';return false;}
    const dx=point.x-from.x,dy=point.y-from.y,length=dx*dx+dy*dy;let changed=false;
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
      const px=(x+.5)*s,py=(y+.5)*s,t=length?Math.max(0,Math.min(1,((px-from.x)*dx+(py-from.y)*dy)/length)):0;
      if(Math.hypot(px-from.x-dx*t,py-from.y-dy*t)>radius)continue;
      const k=key(x,y);if(!this.cells.has(k)){this.cells.add(k);changed=true;}
    }
    this.strokes.set(id,{...point});this.bounds=b;this.error='';
    if(changed){this.dirty=true;this.revision++;}return changed;
  }
  has(point){return this.cells.has(key(Math.floor(point.x/this.cellSize),Math.floor(point.y/this.cellSize)));}
  get area(){return this.cells.size*this.cellSize*this.cellSize;}
  get contours(){this.flush();return this.rings;}
  get points(){return this.contours[0]||[];}
  get closed(){return this.contours.length===1&&this.area>=.5;}
  flush(){
    if(!this.dirty||!this.bounds)return false;
    // Padding guarantees the outside seed is never a painted cell.
    const {minX,minY,maxX,maxY}=this.bounds,x0=minX-1,y0=minY-1,w=maxX-minX+3,h=maxY-minY+3,total=w*h;
    const mask=new Uint8Array(total),queue=new Int32Array(total);
    for(const k of this.cells){const [x,y]=xy(k);mask[(y-y0)*w+x-x0]=1;}
    let head=0,tail=1;queue[0]=0;mask[0]=2;
    const visit=i=>{if(mask[i]===0){mask[i]=2;queue[tail++]=i;}};
    while(head<tail){const i=queue[head++],x=i%w;if(x)visit(i-1);if(x<w-1)visit(i+1);if(i>=w)visit(i-w);if(i<total-w)visit(i+w);}
    for(let i=0;i<total;i++)if(mask[i]===0)this.cells.add(key(x0+i%w,y0+Math.floor(i/w)));
    const edges=new Map();
    const edge=(x,y,xx,yy)=>{const k=key(x,y),list=edges.get(k)||[];list.push(key(xx,yy));edges.set(k,list);};
    for(const k of this.cells){const [x,y]=xy(k);
      if(!this.cells.has(key(x,y-1)))edge(x,y,x+1,y);
      if(!this.cells.has(key(x+1,y)))edge(x+1,y,x+1,y+1);
      if(!this.cells.has(key(x,y+1)))edge(x+1,y+1,x,y+1);
      if(!this.cells.has(key(x-1,y)))edge(x,y+1,x,y);
    }
    const rings=[];
    while(edges.size){
      const start=edges.keys().next().value,points=[];let current=start,previous=null;
      do{
        const [x,y]=xy(current);points.push({x:x*this.cellSize,y:y*this.cellSize});
        const options=edges.get(current);if(!options?.length)break;
        // At a diagonal contact, follow the same component rather than
        // crossing through a zero-width vertex into another painted patch.
        let index=0;
        if(options.length>1&&previous!==null){const [px,py]=xy(previous);let best=-Infinity;options.forEach((next,i)=>{const [nx,ny]=xy(next),turn=(x-px)*(ny-y)-(y-py)*(nx-x);if(turn>best){best=turn;index=i;}});}
        const next=options.splice(index,1)[0];if(!options.length)edges.delete(current);previous=current;current=next;
      }while(current!==start);
      if(points.length>=3)rings.push(collinear(points));
    }
    this.rings=rings.sort((a,b)=>Math.abs(polygonArea(b))-Math.abs(polygonArea(a)));this.dirty=false;return true;
  }
  finalise(){
    this.endStrokes();this.flush();
    if(!this.cells.size)return {error:'Walk a closed perimeter or paint a floor area before saving.',points:[]};
    if(this.rings.length!==1)return {error:'Connect the painted patches with a wider painted bridge before saving.',points:[]};
    if(this.area<.5)return {error:'Close a perimeter or paint a larger floor area before saving.',points:[]};
    const points=polygonFromPaint(this.rings[0]),error=validateFloor(points);
    return {error,points:error?[]:copy(points)};
  }
}
