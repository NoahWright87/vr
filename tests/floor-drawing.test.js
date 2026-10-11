import assert from 'node:assert/strict';
import test from 'node:test';
import { WalkingBoundary, simplifyWalk, segmentInside, validateFloor, unionWalkedAreas } from '../games/boundaries/floor-drawing.js';
import { polygonArea, insidePolygon } from '../common/boundary-geometry.js';
const rect=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
const outline=[{x:.15,y:.15},{x:4.55,y:.15},{x:4.55,y:1.95},{x:.15,y:1.95}];
const l=[{x:.15,y:.15},{x:4.55,y:.15},{x:4.55,y:.75},{x:1,y:.75},{x:1,y:1.95},{x:.15,y:1.95}];
function lap(points,noise=0) {
  const result=[];points.forEach((a,i)=>{const b=points[(i+1)%points.length],n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.06);for(let j=0;j<n;j++){const jitter=noise*Math.sin(result.length*1.618);result.push({x:a.x+(b.x-a.x)*j/n+jitter,y:a.y+(b.y-a.y)*j/n+jitter*.7});}});return result;
}
test('several noisy laps become one saveable rectangle rather than overlapping rings',()=>{
  const walk=new WalkingBoundary(rect);
  for(let i=0;i<4;i++)for(const p of lap(outline,.012))walk.add(p);
  walk.add(outline[0]);const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(walk.laps>=3);assert.ok(result.points.length<=64,result.points.length);
  assert.ok(Math.abs(polygonArea(result.points)-7.92)<.15);
  assert.ok(walk.lap.length<=1);assert.ok(walk.estimate.length<512);
});
test('walking out from the middle before doing laps discards the approach',()=>{
  const walk=new WalkingBoundary(rect);walk.add({x:2,y:1});walk.add({x:1,y:.7});
  for(let i=0;i<3;i++)for(const p of lap(outline,.008))walk.add(p);
  walk.add(outline[0]);const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(Math.abs(polygonArea(result.points)-7.92)<.15);
  assert.ok(walk.laps>=2);
});

test('saving immediately on returning from the first lap excludes the initial approach',()=>{
  const walk=new WalkingBoundary(rect);walk.add({x:2,y:1});walk.add({x:1,y:.7});
  for(const p of lap(outline))walk.add(p);walk.add(outline[0]);
  const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(Math.abs(polygonArea(result.points)-7.92)<.15);
  assert.equal(walk.laps,1);
});
test('repeated L laps preserve the indentation, including reversed walking direction',()=>{
  const walk=new WalkingBoundary(rect);
  for(const points of [l,l,[l[0],...l.slice(1).reverse()]])for(const p of lap(points,.008))walk.add(p);
  walk.add(l[0]);const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(Math.abs(polygonArea(result.points)-3.66)<.2,polygonArea(result.points));
  assert.ok(result.points.some(p=>Math.hypot(p.x-1,p.y-.75)<.1));
});
test('later laps correct a wall estimated too far inward on the first pass',()=>{
  const first=outline.map(p=>({...p,x:p.x===.15?.3:p.x})),walk=new WalkingBoundary(rect);
  for(const p of lap(first))walk.add(p);walk.add(first[0]);
  assert.equal(walk.finalise().error,'');const oldMin=Math.min(...walk.points.map(p=>p.x));
  for(let i=0;i<3;i++)for(const p of lap(outline))walk.add(p);
  walk.add(outline[0]);const result=walk.finalise();
  assert.equal(result.error,'');const newMin=Math.min(...result.points.map(p=>p.x));
  assert.ok(newMin<oldMin-.07,{oldMin,newMin});assert.ok(Math.abs(newMin-.15)<.04,{newMin});
});
test('east simplifies while the wearer is west, and west simplifies while east',()=>{
  const raw=lap(outline,.008),west={x:.15,y:1},east={x:4.55,y:1};
  const atWest=simplifyWalk(raw,{closed:true,head:west,boundary:rect});
  const atEast=simplifyWalk(raw,{closed:true,head:east,boundary:rect});
  assert.ok(atWest.filter(p=>p.x<.3).length>15);assert.ok(atWest.filter(p=>p.x>4.4).length<5);
  assert.ok(atEast.filter(p=>p.x>4.4).length>15);assert.ok(atEast.filter(p=>p.x<.3).length<5);
  for(const head of [west,east])for(const p of raw.filter(p=>Math.hypot(p.x-head.x,p.y-head.y)<.7)) {
    const result=head===west?atWest:atEast;
    assert.ok(result.some(q=>q.x===p.x&&q.y===p.y));
  }
  assert.ok(simplifyWalk(raw,{closed:true,boundary:rect}).length<12);
});
test('partial extra laps and returning from the save preview do not invalidate saving',()=>{
  const walk=new WalkingBoundary(rect);
  for(const p of lap(l))walk.add(p);walk.add(l[0]);assert.equal(walk.finalise().error,'');
  for(const p of lap(l).slice(0,80))walk.add(p);
  const result=walk.finalise();assert.equal(result.error,'');assert.ok(Math.abs(polygonArea(result.points)-3.66)<.2);
  assert.equal(walk.finalise().error,'');
});
test('simplification never crosses concave reported notches',()=>{
  const notch=[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:2.001,y:4},{x:2.001,y:1},{x:1.999,y:1},{x:1.999,y:4},{x:0,y:4}];
  assert.equal(segmentInside({x:.5,y:2},{x:3.5,y:2},notch),false);
  const simplified=simplifyWalk(lap(notch),{closed:true,boundary:notch});
  assert.equal(validateFloor(simplified,notch),'');
});
test('outside, crossed and incomplete walks are rejected with useful feedback',()=>{
  const walk=new WalkingBoundary(rect);walk.add({x:.2,y:.2});assert.match(walk.finalise().error,/perimeter/);
  assert.match(validateFloor([{x:.1,y:.1},{x:5,y:.1},{x:.1,y:1}],rect),/Outside/);
  assert.match(validateFloor([{x:.1,y:.1},{x:2,y:1},{x:.1,y:1},{x:2,y:.1}],rect),/crosses/);
  assert.match(validateFloor([{x:NaN,y:0},{x:2,y:.1},{x:1,y:1}],rect),/Invalid/);
});
test('many laps keep memory bounded and final output stays a simple polygon',()=>{
  const walk=new WalkingBoundary(rect);
  for(let i=0;i<25;i++)for(const p of lap(outline,.008))walk.add(p);
  walk.add(outline[0]);const result=walk.finalise();assert.equal(result.error,'');
  assert.ok(walk.laps>=24);assert.ok(walk.estimate.length<512);assert.ok(walk.lap.length<=1);
});

test('a walked concave area beyond the reported rectangle can be saved',()=>{
  const tiny=[{x:1,y:.5},{x:3,y:.5},{x:3,y:1.5},{x:1,y:1.5}],walk=new WalkingBoundary(tiny);
  for(let i=0;i<3;i++)for(const p of lap(l))walk.add(p);
  walk.add(l[0]);const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(Math.abs(polygonArea(result.points)-3.66)<.05);
  assert.ok(result.points.some(p=>!insidePolygon(p,tiny)));
});

test('later inward laps never shrink a previously walked outer edge',()=>{
  const outer=outline,inner=outer.map(p=>({x:p.x<1?p.x+.2:p.x-.2,y:p.y<1?p.y+.15:p.y-.15}));
  const walk=new WalkingBoundary(rect);
  for(const points of [outer,inner,inner,[outer[0],...outer.slice(1).reverse()]]) {
    assert.ok(walk.complete(lap(points)));walk.preview(points[0]);
    const result=walk.finalise();assert.equal(result.error,'');
    for(const p of outer)assert.ok(insidePolygon(p,result.points));
    assert.ok(polygonArea(result.points)>=7.92-1e-7);
  }
});

test('union keeps outward reaches on different laps without bridging an L-shaped obstacle',()=>{
  const a=l.map(p=>({...p,x:p.x===4.55?4.7:p.x})),b=l.map(p=>({...p,y:p.y===1.95?2.15:p.y}));
  const area=unionWalkedAreas(a,[b[0],...b.slice(1).reverse()]);
  assert.equal(validateFloor(area),'');
  for(const p of a.concat(b))assert.ok(insidePolygon(p,area));
  assert.equal(insidePolygon({x:3,y:1.5},area),false);
  const final=simplifyWalk(area,{closed:true,preserveOuter:true});
  for(const p of area)assert.ok(insidePolygon(p,final));
});

test('after completing a lap, walking across the interior does not add a stray boundary line',()=>{
  const walk=new WalkingBoundary();for(const p of lap(outline))walk.add(p);walk.add(outline[0]);
  assert.equal(walk.finalise().error,'');const accepted=JSON.stringify(walk.points);
  for(const p of [{x:.3,y:.3},{x:1,y:.7},{x:2,y:1}])walk.add(p);
  assert.equal(JSON.stringify(walk.points),accepted);assert.equal(walk.closed,true);
  assert.equal(walk.finalise().error,'');
});

test('envelope simplification cannot clip an outward peak during the final pass',()=>{
  const area=[{x:0,y:0},{x:2,y:-.02},{x:4,y:0},{x:4,y:2},{x:0,y:2}];
  const result=simplifyWalk(area,{closed:true,preserveOuter:true});
  assert.ok(insidePolygon(area[1],result));assert.equal(validateFloor(result),'');
});

test('varying the route between laps still closes and retains the widest walked area',()=>{
  const inner=outline.map(p=>({x:p.x<1?p.x+.2:p.x-.2,y:p.y<1?p.y+.15:p.y-.15}));
  const walk=new WalkingBoundary();
  for(const points of [outline,inner,inner,outline])for(const p of lap(points))walk.add(p);
  walk.add(outline[0]);const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(walk.laps>=3);
  for(const p of outline)assert.ok(insidePolygon(p,result.points));
});

test('an unfinished first lap cannot become a filled area through an invented closing diagonal',()=>{
  const walk=new WalkingBoundary();for(const p of lap(outline).slice(0,80))walk.add(p);
  assert.match(walk.finalise().error,/Finish one lap/);assert.equal(walk.closed,false);
});
