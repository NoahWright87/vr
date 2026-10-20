import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorPaint, polygonFromPaint } from '../games/boundaries/floor-paint.js';
import { validateFloor, segmentInside, containsWalkedArea } from '../games/boundaries/floor-drawing.js';
import { insidePolygon, polygonArea } from '../common/boundary-geometry.js';

const rect=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
const l=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:.8},{x:1.2,y:.8},{x:1.2,y:2.1},{x:0,y:2.1}];
function stroke(paint,points,{id='walk',radius=.06,closed=true,noise=0}={}){
  const path=closed?[...points,points[0]]:points;paint.endStroke(id);let index=0;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.035);
    for(let j=0;j<=n;j++){const jitter=noise*Math.sin(index++*1.6);paint.paint(id,{x:a.x+(b.x-a.x)*j/n+jitter,y:a.y+(b.y-a.y)*j/n+jitter*.7},radius);}
  }paint.endStroke(id);paint.flush();
}
test('walking a rectangle or concave perimeter flood-fills its area and saves a simple polygon',()=>{
  for(const shape of [rect,l,[...l].reverse()]){
    const paint=new FloorPaint();stroke(paint,shape,{noise:.008});
    const result=paint.finalise();assert.equal(result.error,'');assert.equal(validateFloor(result.points),'');
    assert.ok(result.points.length<=16,`${result.points.length} corners`);
    assert.ok(containsWalkedArea(result.points,paint.points));
    for(const p of shape)assert.ok(insidePolygon(p,result.points));
    assert.ok(paint.area>=polygonArea(shape));assert.ok(paint.area<polygonArea(shape)+1);
    if(shape!==rect)assert.equal(insidePolygon({x:3,y:1.5},result.points),false);
  }
});
test('later inward laps and interior travel never erase a single painted cell',()=>{
  const paint=new FloorPaint();stroke(paint,rect);const old=new Set(paint.cells),area=paint.area;
  for(let lap=0;lap<4;lap++)stroke(paint,rect.map(p=>({x:p.x<1?p.x+.2:p.x-.2,y:p.y<1?p.y+.2:p.y-.2})),{noise:.01});
  stroke(paint,[{x:.5,y:.5},{x:2,y:1},{x:4,y:1.5}],{closed:false});
  for(const cell of old)assert.ok(paint.cells.has(cell));assert.ok(paint.area>=area);
});
test('walking and painting share one mask; a controller loop repairs a clipped corner without fans or spikes',()=>{
  const clipped=[{x:0,y:.5},{x:.5,y:0},...rect.slice(1)],paint=new FloorPaint();stroke(paint,clipped);
  assert.equal(paint.has({x:.05,y:.05}),false);const before=new Set(paint.cells);
  // Trace from inside, around the missing corner, and back into the fill.
  stroke(paint,[{x:.05,y:.7},{x:0,y:0},{x:.7,y:0},{x:.7,y:.5}],{id:'controller',closed:false,radius:.1});
  const result=paint.finalise();assert.equal(result.error,'');assert.ok(paint.has({x:.05,y:.05}));
  for(const cell of before)assert.ok(paint.cells.has(cell));
  for(const p of result.points){assert.ok(p.x>=-.16&&p.x<=4.86);assert.ok(p.y>=-.16&&p.y<=2.26);}
  assert.ok(result.points.length<=16,result.points.length);assert.ok(containsWalkedArea(result.points,paint.points));
});
test('painting can create the whole boundary with no walked lap and accepts points beyond any reported rectangle',()=>{
  const paint=new FloorPaint();stroke(paint,l,{id:'left-controller',radius:.1});
  const result=paint.finalise();assert.equal(result.error,'');assert.ok(result.points.some(p=>p.x<1));assert.ok(result.points.some(p=>p.x>3));
  assert.equal(insidePolygon({x:3,y:1.5},result.points),false);
});
test('release, pause, two controllers and tracking jumps never connect unrelated strokes',()=>{
  const paint=new FloorPaint();stroke(paint,[{x:0,y:0},{x:1,y:0}],{id:'left',closed:false});
  stroke(paint,[{x:3,y:1},{x:4,y:1}],{id:'right',closed:false});
  assert.equal(paint.has({x:2,y:.5}),false);assert.match(paint.finalise().error,/Connect/);
  assert.equal(paint.contours.length,2);for(const ring of paint.contours)assert.equal(validateFloor(ring),'');
  paint.paint('walk',{x:0,y:0});assert.equal(paint.paint('walk',{x:3,y:3}),false);assert.match(paint.error,/jumped/);
  assert.equal(paint.paint('walk',{x:3.1,y:3}),false);assert.equal(paint.has({x:1.5,y:1.5}),false);
  paint.endStrokes();assert.equal(paint.paint('walk',{x:3.1,y:3}),true);
});
test('a gap remains visibly open until actually painted; closing it fills the enclosed floor',()=>{
  const paint=new FloorPaint();stroke(paint,[{x:0,y:0},{x:3,y:0},{x:3,y:2},{x:0,y:2}],{closed:false});
  assert.equal(paint.has({x:1,y:1}),false);
  stroke(paint,[{x:0,y:2},{x:0,y:0}],{id:'controller',closed:false,radius:.1});
  assert.ok(paint.has({x:1,y:1}));assert.equal(paint.finalise().error,'');
});
test('sweeping a brush across a missing area adds only the brushed region, never its global convex hull',()=>{
  const paint=new FloorPaint();stroke(paint,l);
  for(let y=.7;y<1.5;y+=.12)stroke(paint,[{x:1,y},{x:1.6,y}],{id:'controller',closed:false,radius:.1});
  assert.ok(paint.has({x:1.5,y:1.3}));assert.equal(paint.has({x:3,y:1.5}),false);
  assert.equal(paint.finalise().error,'');
});
test('final simplification covers every painted cell and never accumulates inward creep across repeated previews',()=>{
  const paint=new FloorPaint();stroke(paint,l,{noise:.012});const original=paint.points,mask=new Set(paint.cells);
  const first=paint.finalise();assert.equal(first.error,'');
  for(let i=0;i<20;i++){const result=paint.finalise();assert.deepEqual(result,first);assert.ok(containsWalkedArea(result.points,original));}
  assert.deepEqual(paint.cells,mask);assert.equal(insidePolygon({x:3,y:1.5},first.points),false);
});
test('long noisy reaches and repeated corner scribbles stay bounded and preserve the original floor',()=>{
  const paint=new FloorPaint();stroke(paint,l);const before=new Set(paint.cells);
  for(let i=0;i<20;i++)stroke(paint,[{x:4.4,y:.15},{x:4.6+Math.sin(i)*.03,y:.05},{x:4.7,y:0},{x:4.7,y:.7}],{id:'controller',closed:false,noise:.01,radius:.075});
  const result=paint.finalise();assert.equal(result.error,'');for(const cell of before)assert.ok(paint.cells.has(cell));
  assert.ok(result.points.length<28,result.points.length);assert.ok(result.points.every(p=>p.x<4.9&&p.x>-.2&&p.y>-.2&&p.y<2.3));
});
test('invalid data and excessive extents preserve existing paint and provide feedback',()=>{
  const paint=new FloorPaint({maxGridCells:10000});paint.add({x:0,y:0});const before=new Set(paint.cells);
  assert.equal(paint.add({x:NaN,y:0}),false);assert.equal(paint.paint('bad',{x:1000,y:1000}),false);assert.match(paint.error,/too large/);assert.deepEqual(paint.cells,before);
  assert.match(paint.finalise().error,/larger floor/);
});
test('polygon validation and simplification retain concave notches and handle both windings',()=>{
  const notch=[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:2.01,y:4},{x:2.01,y:1},{x:1.99,y:1},{x:1.99,y:4},{x:0,y:4}];
  assert.equal(segmentInside({x:.5,y:2},{x:3.5,y:2},notch),false);
  for(const shape of [l,[...l].reverse()]){const result=polygonFromPaint(shape);assert.equal(validateFloor(result),'');assert.ok(containsWalkedArea(result,shape));}
  assert.match(validateFloor([{x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}]),/crosses/);
});
