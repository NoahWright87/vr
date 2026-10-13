import assert from 'node:assert/strict';
import test from 'node:test';
import { WalkingBoundary, simplifyWalk, segmentInside, validateFloor, unionWalkedAreas, straightenWalk, containsWalkedArea } from '../games/boundaries/floor-drawing.js';
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
  assert.equal(result.error,'');assert.equal(walk.laps,1);assert.ok(result.points.length<=12,result.points.length);
  assert.ok(Math.abs(polygonArea(result.points)-7.92)<.35);
  assert.ok(walk.lap.length<=1);assert.ok(walk.estimate.length<512);
});
test('walking out from the middle before doing laps discards the approach',()=>{
  const walk=new WalkingBoundary(rect);walk.add({x:2,y:1});walk.add({x:1,y:.7});
  for(let i=0;i<3;i++)for(const p of lap(outline,.008))walk.add(p);
  walk.add(outline[0]);const result=walk.finalise();
  assert.equal(result.error,'');assert.ok(Math.abs(polygonArea(result.points)-7.92)<.35);
  assert.equal(walk.laps,1);
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
  assert.equal(walk.laps,1);assert.ok(walk.estimate.length<32);assert.ok(walk.lap.length<=1);
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
  assert.equal(result.error,'');assert.equal(walk.laps,1);
  for(const p of outline)assert.ok(insidePolygon(p,result.points));
});

test('an unfinished first lap cannot become a filled area through an invented closing diagonal',()=>{
  const walk=new WalkingBoundary();for(const p of lap(outline).slice(0,80))walk.add(p);
  assert.match(walk.finalise().error,/Finish one lap/);assert.equal(walk.closed,false);
});

test('each outward position immediately grows the visible area, even before another lap',()=>{
  const walk=new WalkingBoundary();assert.ok(walk.complete(outline));walk.preview({x:.15,y:.15});
  for(const p of [{x:.13,y:1},{x:.05,y:1},{x:-.1,y:1},{x:-.35,y:1},{x:-.5,y:1}]) {
    const previous=walk.points.map(p=>({...p}));
    assert.equal(walk.add(p),true);
    assert.ok(insidePolygon(p,walk.points),'current wearer must be in the fill');
    assert.ok(containsWalkedArea(walk.points,previous),'the entire previous fill must remain');
  }
  assert.equal(walk.laps,1);assert.equal(walk.finalise().error,'');
  assert.ok(insidePolygon({x:-.5,y:1},walk.points));
});

test('walking into a missed corner and returning inside permanently adds that corner',()=>{
  const clipped=[{x:.15,y:.45},{x:.45,y:.15},...outline.slice(1)];
  const walk=new WalkingBoundary();assert.ok(walk.complete(clipped));walk.preview({x:2,y:1});
  const corner={x:.15,y:.15};assert.equal(insidePolygon(corner,walk.points),false);
  walk.add({x:.3,y:.3});walk.add(corner);
  assert.ok(containsWalkedArea(walk.points,outline),'recover the whole clipped corner, not only a narrow reach');
  const grown=walk.points.map(p=>({...p}));
  for(const head of [{x:2,y:1},{x:4.5,y:1},{x:.2,y:1}]) {
    walk.add(head);walk.preview(head);
    assert.ok(insidePolygon(corner,walk.points));assert.ok(containsWalkedArea(walk.points,grown));
  }
});

test('straight walls become a small polygon while containing all measured area',()=>{
  for(const shape of [outline,l]) {
    const raw=unionWalkedAreas([],lap(shape,.012)),straight=straightenWalk(raw);
    assert.equal(validateFloor(straight),'');assert.ok(containsWalkedArea(straight,raw));
    assert.ok(straight.length<=shape.length+4,{corners:straight.length});
    if(shape===l)assert.equal(insidePolygon({x:3,y:1.5},straight),false);
  }
});

test('nearby detail, distant straightening and final saving never shrink any earlier preview',()=>{
  const walk=new WalkingBoundary();assert.ok(walk.complete(lap(l,.015)));
  let previous=walk.estimate;
  for(const head of [{x:.15,y:1},{x:4.55,y:.2},{x:1,y:1.9},{x:.15,y:1},null]) {
    walk.preview(head);assert.ok(containsWalkedArea(walk.points,previous));previous=walk.points;
  }
  const result=walk.finalise();assert.equal(result.error,'');assert.ok(containsWalkedArea(result.points,previous));
});

test('collinear reaches past either end of a wall extend corners rather than drawing zero-width lines',()=>{
  const walk=new WalkingBoundary();walk.complete(outline);walk.preview(null);
  for(const p of [{x:.15,y:.05},{x:.15,y:-.1},{x:4.65,y:.15},{x:4.75,y:.15},{x:4.55,y:2.1},{x:.05,y:1.95}]) {
    const old=walk.points;walk.add(p);
    assert.ok(insidePolygon(p,walk.points),JSON.stringify(p));assert.ok(containsWalkedArea(walk.points,old));
  }
});

test('one visit to each cut-off rectangular corner recovers the whole usable rectangle',()=>{
  const cut=[{x:.15,y:.45},{x:.45,y:.15},{x:4.25,y:.15},{x:4.55,y:.45},{x:4.55,y:1.65},{x:4.25,y:1.95},{x:.45,y:1.95},{x:.15,y:1.65}];
  const walk=new WalkingBoundary();walk.complete(cut);walk.preview(null);
  for(const p of outline){const old=walk.points;walk.add(p);assert.ok(containsWalkedArea(walk.points,old));}
  assert.ok(containsWalkedArea(walk.points,outline));
  const final=walk.finalise();assert.equal(final.error,'');assert.ok(final.points.length<=8,final.points.length);
});

test('live expansion of a concave room retains its furniture indentation',()=>{
  const walk=new WalkingBoundary();walk.complete(l);walk.preview(null);
  for(const p of [{x:0,y:1},{x:0,y:2.1},{x:.7,y:2.1},{x:4.7,y:.15},{x:4.7,y:.7}]) {
    walk.add(p);assert.ok(insidePolygon(p,walk.points));
    assert.equal(insidePolygon({x:3,y:1.5},walk.points),false);
  }
  assert.equal(walk.finalise().error,'');assert.equal(insidePolygon({x:3,y:1.5},walk.points),false);
});
