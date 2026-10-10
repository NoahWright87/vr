import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {BoundaryObservation} from '../games/boundaries/boundary-observation.js';

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const polygon=[{x:0,y:0,z:0},{x:2,y:0,z:0},{x:2,y:0,z:1},{x:0,y:0,z:1}];
function fixture() {
  let definition, callback, mode=null, clearAlpha=1, arSupported=true;
  const entryCalls=[];
  const storage=new Map();
  const listeners=new Map(), children=new Set(), attributes={webxr:{referenceSpaceType:'local-floor',requiredFeatures:['local-floor'],optionalFeatures:['bounded-floor','plane-detection']}};
  class Vector {
    constructor(x=0,y=0,z=0,w=1){Object.assign(this,{x,y,z,w});}
    clone(){return new Vector(this.x,this.y,this.z,this.w);}
    copy(v){Object.assign(this,v);return this;}
    set(x,y,z){Object.assign(this,{x,y,z});return this;}
    identity(){Object.assign(this,{x:0,y:0,z:0,w:1});return this;}
  }
  class Geometry {constructor(){this.attributes={};}setAttribute(n,v){this.attributes[n]=v;}computeBoundingSphere(){}dispose(){this.disposed=true;}}
  class Material {constructor(){this.color={set:v=>this.value=v};}dispose(){this.disposed=true;}}
  class Line {constructor(geometry,material){Object.assign(this,{geometry,material,matrix:{fromArray:a=>this.matrix.elements=Array.from(a)}});}}
  const AFRAME={utils:{device:{checkARSupport:()=>arSupported}},registerComponent:(name,def)=>definition=def,THREE:{LineLoop:Line,BufferGeometry:Geometry,LineBasicMaterial:Material,Float32BufferAttribute:class{constructor(a){this.array=a;}}}};
  const document={querySelector:()=>({}),querySelectorAll:()=>[]};
  vm.runInNewContext(readFileSync(new URL('../games/boundaries/room-setup.js',import.meta.url),'utf8').replace(/^import .*?;\s*/m,''),{BoundaryObservation,AFRAME,document,navigator:{userAgent:'test'},localStorage:{setItem:(k,v)=>storage.set(k,v)},URL:{createObjectURL:()=>{throw new Error('download unavailable in XR');}}});
  const opaque={object3D:{visible:true}};
  const rig={object3D:{position:new Vector(3,0,2),quaternion:new Vector(0,.5,0,.866)},components:{'locomotion-demo':{data:{speed:1.5}}},removeAttribute:n=>delete rig.components[n],setAttribute:(n,data)=>rig.components[n]={data}};
  const session={requestAnimationFrame:fn=>callback=fn};
  const scene={renderer:{xr:{getSession:()=>mode?session:null,getReferenceSpace:()=>({})},getClearAlpha:()=>clearAlpha,setClearAlpha:v=>clearAlpha=v},
    object3D:{background:'blue',add:x=>children.add(x),remove:x=>children.delete(x)},
    is:n=>n===mode,addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n),
    querySelector:()=>rig,querySelectorAll:()=>[opaque],getAttribute:n=>attributes[n],setAttribute:(n,data)=>attributes[n]=data,
    enterVR:async(ar,offer)=>{entryCalls.push({ar,offer});mode=ar?'ar-mode':'vr-mode';listeners.get('enter-vr')();}};
  const component={...definition,el:scene};component.init();
  const frame={detectedPlanes:new Set(),getViewerPose:()=>({}),getPose:()=>({transform:{matrix:identity}})};
  return {component,scene,session,frame,rig,opaque,children,attributes,listeners,entryCalls,storage,tick:(time=0)=>callback(time,frame),setMode:m=>mode=m,setARSupport:v=>arSupported=v,clearAlpha:()=>clearAlpha};
}
async function activate(f) {await f.scene.enterVR(false);f.component.enterRoomSetup();}

test('watch Room Setup uses the current headset session, initially virtual, and restores the Lab without exiting',async()=>{
  const f=fixture();assert.equal(f.attributes.webxr.requiredFeatures.includes('plane-detection'),false);
  await f.scene.enterVR(false);
  assert.equal(f.entryCalls[0].ar,true);assert.equal(f.component.session,null);
  assert.equal(f.opaque.object3D.visible,true);assert.equal(f.clearAlpha(),1);
  f.listeners.get('menu-item-select')({detail:{value:'room-test'}});
  assert.equal(f.component.session,f.session);assert.equal(f.entryCalls.length,1);
  assert.equal(f.opaque.object3D.visible,false);assert.equal(f.clearAlpha(),0);
  assert.equal(f.scene.object3D.background,null);assert.equal(f.rig.components['locomotion-demo'],undefined);
  assert.equal(f.rig.object3D.position.x,0);assert.equal(f.rig.object3D.quaternion.y,0);
  f.listeners.get('menu-item-select')({detail:{value:'room-stop'}});
  assert.equal(f.opaque.object3D.visible,true);assert.equal(f.clearAlpha(),1);
  assert.equal(f.scene.object3D.background,'blue');assert.equal(f.rig.object3D.position.x,3);
  assert.equal(f.rig.object3D.quaternion.y,.5);assert.equal(f.rig.components['locomotion-demo'].data.speed,1.5);
  assert.equal(f.attributes.webxr.requiredFeatures.includes('plane-detection'),false);
  assert.equal(f.scene.is('ar-mode'),true);assert.equal(f.entryCalls.length,1);
  f.tick(10000);assert.equal(f.component.session,null);
});

test('headsets without passthrough retain VR entry and report denied/unsupported room access in the watch',async()=>{
  const f=fixture();f.setARSupport(false);f.session.enabledFeatures=['local-floor','bounded-floor'];
  await activate(f);f.tick(0);f.tick(4000);
  assert.equal(f.entryCalls[0].ar,false);assert.equal(f.scene.is('vr-mode'),true);
  assert.match(f.component.roomMode,/passthrough unavailable/);assert.match(f.component.roomStatus,/unavailable or denied/);
  f.component.stop();assert.equal(f.clearAlpha(),1);assert.equal(f.scene.is('vr-mode'),true);
});

test('planes appear after empty frames, preserve all corners, track pose changes, and discard stale surfaces',async()=>{
  const f=fixture();await activate(f);f.tick(0);f.tick(2500);
  assert.match(f.component.roomStatus,/Waiting/);assert.equal(f.children.size,0);
  const plane={polygon:[...polygon,{x:.5,y:0,z:.5}],orientation:'horizontal',lastChangedTime:1,planeSpace:{}};
  f.frame.detectedPlanes=new Set([plane]);f.tick(4000);
  const line=f.component.planes.get(plane);assert.equal(line.geometry.attributes.position.array.length,15);
  assert.equal(line.material.value,'#86efac');assert.equal(line.visible,true);
  assert.equal(f.component.roomSnapshot[0].points.length,5);
  f.frame.getPose=()=>({transform:{matrix:[...identity.slice(0,12),3,0,4,1]}});f.tick(4100);
  assert.equal(line.matrix.elements[12],3);assert.equal(line.matrix.elements[14],4);
  f.frame.getViewerPose=()=>null;f.tick(4200);assert.equal(line.visible,false);assert.equal(f.component.roomSnapshot.length,0);
  f.frame.getViewerPose=()=>({});f.tick(4300);assert.equal(line.visible,true);
  plane.polygon=polygon;plane.lastChangedTime=2;plane.orientation='vertical';f.tick(4400);
  assert.equal(line.geometry.attributes.position.array.length,12);assert.equal(line.material.value,'#c084fc');
  f.frame.detectedPlanes=new Set();f.tick(4500);
  assert.equal(f.children.size,0);assert.equal(line.geometry.disposed,true);assert.equal(line.material.disposed,true);
});

test('current XRFrame plane set takes priority over legacy XRSession data',async()=>{
  const f=fixture();await activate(f);
  f.session.detectedPlanes=new Set([{polygon,orientation:null,planeSpace:{}}]);
  f.tick(0);assert.equal(f.component.planes.size,0);
  delete f.frame.detectedPlanes;f.tick(1000);assert.equal(f.component.planes.size,1);
  assert.equal([...f.component.planes.values()][0].material.value,'#f9a8d4');
  f.component.stop();assert.equal(f.children.size,0);
});

test('Room Setup launch waits 3 seconds, only runs without planes, and can only be requested once per session',async()=>{
  const f=fixture();let launches=0;
  f.session.initiateRoomCapture=async()=>{launches++;throw Object.assign(new Error('cancelled'),{name:'OperationError'});};
  await activate(f);f.tick(0);f.tick(2900);await f.component.captureRoom();assert.equal(launches,0);
  f.tick(3000);await f.component.captureRoom();await f.component.captureRoom();assert.equal(launches,1);
  assert.equal(f.component.capturePending,false);assert.equal(f.component.captureUsed,true);
  f.component.stop();f.component.enterRoomSetup();f.tick(4000);f.tick(7000);
  await f.component.captureRoom();assert.equal(launches,1);assert.equal(f.component.captureUsed,true);
  f.frame.detectedPlanes=new Set([{polygon,orientation:'horizontal',planeSpace:{}}]);f.tick(7100);
  await f.component.captureRoom();assert.equal(launches,1);
});

test('late capture completion cannot update an ended session or a new session',async()=>{
  const f=fixture();let finish;
  f.session.initiateRoomCapture=()=>new Promise(resolve=>finish=resolve);
  await activate(f);f.tick(0);f.tick(3000);
  const pending=f.component.captureRoom();assert.equal(f.component.capturePending,true);
  f.component.stop();f.component.enterRoomSetup();f.component.captureMessage='new diagnostic';finish();await pending;
  assert.equal(f.component.captureMessage,'new diagnostic');assert.equal(f.component.capturePending,false);
});

test('save diagnostics from the watch persists the report when XR downloads are blocked',async()=>{
  const f=fixture();await activate(f);f.tick(0);f.tick(4000);
  f.component.observation.sample(0,polygon);f.component.observation.sample(1000,polygon);
  f.listeners.get('menu-item-select')({detail:{value:'save-diagnostics'}});
  const saved=JSON.parse(f.storage.get('boundary-lab-report'));
  assert.equal(saved.boundary.frames,2);assert.equal(saved.boundary.points.length,4);
  assert.equal(saved.room.seconds,4);assert.match(f.component.reportStatus,/Saved in this browser/);
});

test('a watch action outside an XR session gives instructions rather than requesting a new session',()=>{
  const f=fixture();f.component.enterRoomSetup();
  assert.equal(f.component.session,null);assert.equal(f.entryCalls.length,0);
  assert.match(f.component.roomStatus,/Enter the Lab/);
});
