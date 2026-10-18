import assert from 'node:assert/strict';
import test from 'node:test';
import { insetWallFace } from '../core/wall-surfaces.ts';
import { wallSegments, pointInPiece, rot } from '../core/geometry.ts';
import type { Piece, Vec } from '../core/types.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const close = (a:Vec,b:Vec) => Math.hypot(a.x-b.x,a.y-b.y)<1e-7;
test('offset wall faces meet without cracks at rectangular and concave room corners', () => {
  for (const parts of [[rect(0,0,2,2)], [rect(0,0,3,1),rect(0,1,1,3)]]) for (const angle of [0,.392699,.785398]) for (const reverse of [false,true]) {
    const piece:Piece={id:'room',kind:'room',template:'test',parts:parts.map(poly=>{const p=poly.map(v=>rot(v,angle));return reverse?p.reverse():p;})};
    const walls=wallSegments(piece,[]), faces=walls.map(([a,b])=>insetWallFace(piece,walls,a,b));
    for(let i=0;i<walls.length;i++) for(let j=i+1;j<walls.length;j++) for(let a=0;a<2;a++) for(let b=0;b<2;b++) {
      if(close(walls[i][a],walls[j][b])) assert.ok(close(faces[i][a],faces[j][b]), JSON.stringify({i,j,faces}));
    }
    assert.ok(faces.flat().every(p=>pointInPiece(p,piece)));
  }
});

test('opposite faces of a shared wall are separated by 2 mm',()=>{
  const left:Piece={id:'a',kind:'room',template:'test',parts:[rect(0,0,2,2)]};
  const right:Piece={id:'b',kind:'room',template:'test',parts:[rect(2,0,4,2)]};
  const a=insetWallFace(left,wallSegments(left,[]),{x:2,y:.5},{x:2,y:1.5});
  const b=insetWallFace(right,wallSegments(right,[]),{x:2,y:.5},{x:2,y:1.5});
  assert.ok(a.every(p=>Math.abs(p.x-1.999)<1e-9));assert.ok(b.every(p=>Math.abs(p.x-2.001)<1e-9));
});

test('doorway and visibility cuts retain their endpoint along the wall',()=>{
  const piece:Piece={id:'a',kind:'room',template:'test',parts:[rect(0,0,2,2)]};
  const original: [Vec,Vec]=[{x:2,y:.6},{x:2,y:1.4}];
  const face=insetWallFace(piece,wallSegments(piece,[]),...original);
  assert.equal(face[0].y,.6);assert.equal(face[1].y,1.4);
  assert.deepEqual(original,[{x:2,y:.6},{x:2,y:1.4}]);
});
