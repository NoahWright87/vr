import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, starterPaint, snapshotPaint, restorePaint, paintSegment, makeParams, exportProject, importProject } from '../playground/model.ts';
import { containsWalkedArea } from '../../boundaries/floor-drawing.js';
import { insideFootprint, normalizeFootprint, pieceInFootprint } from '../core/footprint.ts';
import { generateRoomsFirst } from '../core/rooms-first.ts';
import { generateLevel } from '../core/generator.ts';

const extension=[{x:-1,y:-1},{x:4,y:-1},{x:4,y:1},{x:1,y:1},{x:1,y:4},{x:-1,y:4}];
function paintedExtension(){
  const paint=starterPaint();extension.forEach((a,i)=>paintSegment(paint,'pointer',a,extension[(i+1)%extension.length],.15));
  paint.endStrokes();paint.flush();return paint;
}
test('2D painted loops retain the starter and fill a concave usable footprint',()=>{
  const starter=starterPaint(),larger=paintedExtension();
  assert.ok([...starter.cells].every(cell=>larger.cells.has(cell)));assert.ok(larger.area>starter.area+5);
  assert.equal(insideFootprint({x:3,y:3},larger.points),false);
  const result=larger.finalise();assert.equal(result.error,'');assert.ok(containsWalkedArea(result.points,larger.points));
});
test('painted stroke snapshots support undo and disconnected patches need a painted bridge',()=>{
  const paint=starterPaint(),before=snapshotPaint(paint);
  paint.paint('pointer',{x:3,y:0},.15);paint.endStrokes();assert.match(paint.finalise().error,/Connect/);
  paintSegment(paint,'pointer',{x:1.4,y:0},{x:3,y:0},.15);paint.endStrokes();assert.equal(paint.finalise().error,'');
  assert.deepEqual(snapshotPaint(restorePaint(before)),before);
  assert.ok([...before.cells].every(cell=>paint.cells.has(cell)));
});
test('project round trip preserves the exact painted mask, confirmed outline, seed and generated result',()=>{
  const paint=paintedExtension(),boundary=paint.finalise().points,settings={...DEFAULT_SETTINGS,seed:71,rooms:9};
  const params=makeParams(boundary,settings),level=generateRoomsFirst(params);
  const restored=importProject(JSON.parse(JSON.stringify(exportProject(paint,boundary,settings,level))));
  assert.deepEqual(restored.paint.cells,paint.cells);assert.deepEqual(restored.boundary,boundary);
  assert.deepEqual(generateRoomsFirst(makeParams(restored.boundary,restored.settings)),level);
  assert.equal(level.pieces.filter(p=>p.kind==='room').length,9);
});
test('both 2D generators receive the complete polygon, including its notch, with matching clearance',()=>{
  const paint=paintedExtension(),points=paint.finalise().points,expected=normalizeFootprint(points);
  for(const style of ['growth','rooms-first']){
    const params=makeParams(points,{...DEFAULT_SETTINGS,style});assert.deepEqual(params.footprint,expected.polygon);assert.ok(params.footprint!.length>4);
    const level=style==='growth'?generateLevel(params):generateRoomsFirst(params);
    for(const piece of level.pieces)assert.ok(pieceInFootprint(piece,params.footprint!,params.boundaryMargin));
    assert.equal(insideFootprint({x:3-expected.origin.x,y:3-expected.origin.y},params.footprint!),false);
  }
});
test('malformed imports and invalid settings cannot allocate an unbounded grid or shrink accepted paint',()=>{
  const paint=starterPaint(),boundary=paint.finalise().points,project=exportProject(paint,boundary);
  assert.throws(()=>importProject({...project,paint:{...project.paint,bounds:{minX:-4095,minY:0,maxX:4095,maxY:4095}}}),/grid/);
  assert.throws(()=>importProject({...project,paint:{...project.paint,cells:[-1]}}),/cell/);
  assert.throws(()=>importProject({...project,boundary:[{x:0,y:0},{x:.1,y:0},{x:0,y:.1}]}),/contain/);
  assert.throws(()=>makeParams(boundary,{...DEFAULT_SETTINGS,minSize:20,maxSize:10}),/settings/);
  assert.throws(()=>makeParams(boundary,{...DEFAULT_SETTINGS,seed:NaN}),/settings/);
  assert.deepEqual(restorePaint(snapshotPaint(paint)).cells,paint.cells);
});

test('room targets above the former UI and generator caps survive export, import and generation',()=>{
  const paint=paintedExtension(),boundary=paint.finalise().points,settings={...DEFAULT_SETTINGS,rooms:100,pieces:100,roomsPerLayer:100};
  const restored=importProject(JSON.parse(JSON.stringify(exportProject(paint,boundary,settings))));
  assert.deepEqual(restored.settings,settings);
  const params=makeParams(boundary,restored.settings),level=generateRoomsFirst(params);
  assert.equal(level.pieces.filter(p=>p.kind==='room').length,100);
  assert.equal(makeParams(boundary,{...settings,style:'growth'}).pieceCount,100);
  for(const invalid of [NaN,Infinity,2.5,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>makeParams(boundary,{...settings,rooms:invalid}),/settings/);
    assert.throws(()=>generateRoomsFirst({...params,roomCount:invalid}),/Check/);
    assert.throws(()=>generateLevel({...params,pieceCount:invalid}),/whole piece/);
  }
});
