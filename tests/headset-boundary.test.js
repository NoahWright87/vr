import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function fixture() {
  let definition;
  class Geometry {setAttribute(k,v){this[k]=v;}computeBoundingSphere(){}dispose(){}}
  class Material {constructor(data){Object.assign(this,data);}dispose(){}}
  class Object3D {constructor(geometry,material){this.geometry=geometry;this.material=material;}}
  class Matrix {constructor(){this.elements=[];}fromArray(a){this.elements=Array.from(a);}}
  class Vector {set(x,y,z){Object.assign(this,{x,y,z});return this;}applyMatrix4(m){const [x,y,z]=[this.x,this.y,this.z],e=m.elements;this.x=e[0]*x+e[4]*y+e[8]*z+e[12];this.y=e[1]*x+e[5]*y+e[9]*z+e[13];this.z=e[2]*x+e[6]*y+e[10]*z+e[14];return this;}}
  const AFRAME={registerComponent(name,def){definition=def;},THREE:{Matrix4:Matrix,Vector3:Vector,BufferGeometry:Geometry,LineLoop:Object3D,Points:Object3D,LineBasicMaterial:Material,PointsMaterial:Material,Float32BufferAttribute:class {constructor(array){this.array=array;}}}};
  vm.runInNewContext(readFileSync(new URL('../common/headset-boundary.js',import.meta.url),'utf8'),{AFRAME,document:{querySelectorAll:()=>[]}});
  const events=[],listeners=new Map(),spaceListeners=new Map();
  const bounded={boundsGeometry:[{x:0,y:0,z:0},{x:3,y:0,z:0},{x:3,y:0,z:2},{x:0,y:0,z:2}],addEventListener:(n,fn)=>spaceListeners.set(n,fn),removeEventListener:n=>spaceListeners.delete(n)};
  let callback;const session={requestReferenceSpace:async name=>{assert.equal(name,'bounded-floor');return bounded;},requestAnimationFrame:fn=>{callback=fn;}};
  const scene={object3D:{add(){},remove(){}},renderer:{xr:{getSession:()=>session,getReferenceSpace:()=>({})}},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n),emit:(name,detail)=>events.push({name,detail})};
  const component={...definition,el:{sceneEl:scene}};component.init();
  const frame={getPose:()=>({transform:{matrix:[0,0,-1,0,0,1,0,0,1,0,0,0,10,0,20,1]}}),getViewerPose:()=>({transform:{position:{x:1,y:1.6,z:.5}}})};
  return {component,bounded,frame,events,listeners,spaceListeners,tick:()=>callback(0,frame)};
}
test('shared Boundary Lab detector transforms bounds and publishes real pose every XR frame',async()=>{
  const f=fixture();f.component.start();await Promise.resolve();f.tick();
  const positions=Array.from(f.component.geometry.position.array);
  assert.equal(positions[0],10);assert.equal(positions[2],20);assert.equal(positions[3],10);assert.equal(positions[5],17);
  f.tick();const frames=f.events.filter(e=>e.name==='headset-boundary-frame');assert.equal(frames.length,2);
  assert.equal(frames[1].detail.position.x,1);assert.equal(frames[1].detail.position.y,.5);assert.equal(frames[1].detail.points.length,4);
  const before=f.component.revision;f.spaceListeners.get('reset')();assert.equal(f.component.revision,before+1);assert.ok(f.events.some(e=>e.name==='headset-boundary-reset'));
  f.component.stop();assert.equal(f.spaceListeners.size,0);assert.equal(f.component.outline.visible,false);
});
test('missing tracking does not publish a fabricated pose and a stopped session cannot restart',async()=>{
  const f=fixture();f.component.start();await Promise.resolve();f.frame.getViewerPose=()=>null;f.tick();assert.ok(f.events.some(e=>e.name==='headset-boundary-tracking-lost'));assert.equal(f.events.filter(e=>e.name==='headset-boundary-frame').length,0);
  f.component.stop();f.tick();assert.equal(f.events.filter(e=>e.name==='headset-boundary-frame').length,0);
});
