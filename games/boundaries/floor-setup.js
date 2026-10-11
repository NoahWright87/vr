import { BoundaryObservation } from './boundary-observation.js';
import { WalkingBoundary, validateFloor } from './floor-drawing.js';
import { polygonArea } from '../../common/boundary-geometry.js';

AFRAME.registerComponent('boundary-floor-lab', {
  init: function () {
    const T=AFRAME.THREE;
    this.observation=new BoundaryObservation();this.walk=null;this.savedPoints=[];
    this.phase='idle';this.status='Watch > Calibrate boundary';this.reportStatus='';
    this.root=new T.Group();this.root.matrixAutoUpdate=false;this.root.visible=false;this.el.object3D.add(this.root);
    this.trace=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#f0abfc',depthTest:false}));
    this.fill=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color:'#f0abfc',side:T.DoubleSide,transparent:true,opacity:.12,depthTest:false,depthWrite:false}));
    this.preview=new T.LineLoop(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#fde047',depthTest:false}));
    this.savedOutline=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color:'#4ade80',side:T.DoubleSide,depthTest:false}));
    this.fill.renderOrder=2;this.trace.renderOrder=3;this.preview.renderOrder=4;this.savedOutline.renderOrder=5;
    this.root.add(this.fill,this.trace,this.preview,this.savedOutline);
    this.handlers={
      'enter-vr':()=>this.attachSession(),'exit-vr':()=>this.endSession(),
      'headset-boundary-sample':e=>{this.observation.sample(e.detail.time,e.detail.points);},
      'headset-boundary-frame':e=>{this.boundary=e.detail;this.root.matrix.fromArray(e.detail.matrix);this.root.matrixWorldNeedsUpdate=true;this.root.visible=true;},
      'headset-boundary-reset':()=>this.invalidate('Boundary changed. Start calibration again.'),
      'headset-boundary-unavailable':()=>this.invalidate('Waiting for the headset boundary.'),
      'headset-boundary-ended':()=>this.invalidate('Enter XR to calibrate.'),
      'headset-boundary-tracking-lost':()=>this.invalidate('Tracking paused. Calibration stopped.',true),
      'watch-menu-ready':()=>this.renderStatus(),
      'menu-action':e=>this.select(e.detail.id)
    };
    for(const [name,fn] of Object.entries(this.handlers))this.el.addEventListener(name,fn);
    // Negotiate passthrough at the actual entry gesture, without room data.
    this.originalEnterVR=this.el.enterVR;
    const scene=this.el,original=this.originalEnterVR;
    this.enterVRWrapper=function(ar,offer) {
      if(scene.is('vr-mode')||scene.is('ar-mode'))return Promise.resolve('Already in XR');
      return original.call(scene,!!ar||AFRAME.utils.device.checkARSupport(),offer);
    };
    this.el.enterVR=this.enterVRWrapper;
  },
  watches: function () {
    return Array.from(document.querySelectorAll('[hand-with-watch]')).map(el=>el.components['hand-with-watch']).filter(Boolean);
  },
  menuItems: function () {
    const action=(id,label)=>({kind:'action',id,label});
    if(this.pending)return [
      {kind:'info',id:'calibration-question',label:'Save this boundary?',info:()=>this.describe()},
      action('calibration-confirm','Yes, save boundary'),action('calibration-resume','Keep walking'),action('calibration-cancel','Cancel calibration')
    ];
    return [action('calibration-start','Start new calibration'),action('calibration-resume','Continue walking'),action('calibration-save','Save boundary'),action('calibration-cancel','Cancel')];
  },
  focusCalibration: function (component) {
    if(!this.walk&&!this.pending&&!this.interrupted)return;
    const menu=component.menu;menu.reset();
    const index=menu.level().items.findIndex(item=>item.id==='boundary-calibration');
    if(index>=0){menu.moveFocus(index);menu.activate();}
  },
  attachSession: function () {
    this.endSession();this.observation=new BoundaryObservation();this.session=this.el.renderer.xr.getSession();
    this.status='Watch > Calibrate boundary';this.renderStatus();
  },
  endSession: function () {
    this.session=null;this.invalidate('Enter XR to calibrate.');
  },
  invalidate: function (message,trackingOnly=false) {
    // Keep passthrough visible if measurement stops while someone is walking.
    if(this.session&&this.passthrough){this.active=false;this.interrupted=true;message+=' Passthrough stays on; Cancel returns to Lab.';}
    else this.stop();
    this.walk=null;this.pending=null;this.boundary=null;this.root.visible=false;
    if(!trackingOnly)this.savedPoints=[];
    this.phase=this.savedPoints.length?'saved':'idle';this.status=message;this.redraw();
  },
  start: function () {
    if(!this.session||!this.boundary){this.status='Enter XR and wait for the cyan boundary.';this.renderStatus();return;}
    if(!this.el.is('ar-mode')||this.session.environmentBlendMode==='opaque') {
      this.status='Walking calibration needs passthrough. It is unavailable in this session.';this.renderStatus();return;
    }
    this.walk=new WalkingBoundary();this.pending=null;this.phase='walking';this.active=true;this.interrupted=false;
    this.showPassthrough();this.closeWatches();
    this.status='Walk a few laps around the usable edge. Revisit corners to refine them. Open watch to Save.';this.redraw();
  },
  showPassthrough: function () {
    if(this.passthrough)return;
    const rig=document.querySelector('#boundary-rig');
    this.passthrough={background:this.el.object3D.background,alpha:this.el.renderer.getClearAlpha(),position:rig.object3D.position.clone(),quaternion:rig.object3D.quaternion.clone(),locomotion:rig.getAttribute('locomotion-demo'),objects:Array.from(this.el.querySelectorAll('[data-calibration-opaque]')).map(el=>({el,visible:el.object3D.visible}))};
    rig.removeAttribute('locomotion-demo');rig.object3D.position.set(0,0,0);rig.object3D.quaternion.identity();
    this.passthrough.objects.forEach(({el})=>{el.object3D.visible=false;});
    this.el.object3D.background=null;this.el.renderer.setClearAlpha(0);
  },
  stop: function () {
    this.active=false;this.interrupted=false;
    if(!this.passthrough)return;
    const rig=document.querySelector('#boundary-rig'),old=this.passthrough;
    this.el.object3D.background=old.background;this.el.renderer.setClearAlpha(old.alpha);
    old.objects.forEach(({el,visible})=>{el.object3D.visible=visible;});
    rig.object3D.position.copy(old.position);rig.object3D.quaternion.copy(old.quaternion);
    if(old.locomotion)rig.setAttribute('locomotion-demo',old.locomotion);
    this.passthrough=null;
  },
  closeWatches: function () {this.watches().forEach(w=>w.projectedMenu?.close());},
  select: function (id) {
    if(id==='calibration-start'){this.start();return;}
    if(id==='calibration-cancel') {
      this.stop();this.walk=null;this.pending=null;this.phase=this.savedPoints.length?'saved':'idle';
      this.status='Calibration cancelled. Previous saved boundary kept.';this.redraw();return;
    }
    if(id==='calibration-resume') {
      if(!this.walk||!this.boundary){this.status='Choose Start new calibration first.';this.renderStatus();return;}
      this.pending=null;this.phase='walking';this.active=true;this.closeWatches();
      this.status='Keep walking laps. Nearby points stay detailed; distant sections simplify.';this.redraw();return;
    }
    if(id==='calibration-save') {
      if(!this.walk||!this.boundary){this.status='Start calibration and walk the perimeter first.';this.renderStatus();return;}
      this.active=false;
      const result=this.walk.finalise();
      if(result.error){this.status=result.error+' Continue walking or start again.';this.redraw();return;}
      this.pending={points:result.points,revision:this.boundary.revision};this.phase='review';
      this.status='Save this boundary? Review the yellow outline, then choose Yes, save boundary.';
      this.redraw();this.watches().forEach(w=>{if(w.crossbarComponent?.menu.isOpen)this.focusCalibration(w.crossbarComponent);});return;
    }
    if(id==='calibration-confirm') {
      if(!this.pending||!this.boundary)return;
      const error=this.pending.revision!==this.boundary.revision?'Tracking reference changed. Calibrate again.':validateFloor(this.pending.points);
      if(error){this.pending=null;this.status=error;this.redraw();return;}
      this.savedPoints=this.pending.points.map(p=>({...p}));this.pending=null;this.walk=null;this.phase='saved';this.stop();
      this.status=`Boundary saved: ${polygonArea(this.savedPoints).toFixed(2)} m². Green is your walking boundary.`;
      // Storage failure must not prevent locking or drawing this session's
      // accepted polygon. New sessions require a new tracking alignment.
      try{localStorage.setItem('boundary-lab-calibration',JSON.stringify({schema:1,points:this.savedPoints,reportedBoundary:this.boundary.points,revision:this.boundary.revision}));}
      catch(_){this.status+=' Browser storage unavailable; saved for this session.';}
      this.redraw();return;
    }
    if(id==='save-diagnostics')this.downloadReport();
  },
  tick: function (time) {
    if(time-(this.statusTime||0)>500){this.statusTime=time;this.renderStatus();}
    if(!this.active||!this.walk||!this.session||!this.boundary)return;
    if(this.watches().some(w=>w.projectedMenu?.active||w.projectedMenu?.visible))return;
    const frame=this.el.renderer.xr.getFrame(),space=document.querySelector('#boundary-rig').components['headset-boundary'].boundedSpace;
    if(!frame||!space)return;
    const viewer=frame.getViewerPose(space);
    if(!viewer){this.invalidate('Tracking lost. Calibration stopped.',true);return;}
    const p=viewer.transform.position;
    if(!Number.isFinite(p.x)||!Number.isFinite(p.z)){this.invalidate('Tracking lost. Calibration stopped.',true);return;}
    if(this.walk.add({x:p.x,y:p.z}))this.redraw();
  },
  redraw: function () {
    const T=AFRAME.THREE,points=this.walk?.points||[],line=points.map(p=>[p.x,.047,p.y]).flat();
    if(this.walk?.closed&&points.length)line.push(points[0].x,.047,points[0].y);
    this.trace.geometry.setAttribute('position',new T.Float32BufferAttribute(line,3));this.trace.geometry.computeBoundingSphere();
    this.trace.visible=!!points.length&&!this.pending;
    this.preview.geometry.setAttribute('position',new T.Float32BufferAttribute((this.pending?.points||[]).map(p=>[p.x,.05,p.y]).flat(),3));this.preview.geometry.computeBoundingSphere();this.preview.visible=!!this.pending;
    // Completed laps display one concave filled area, without the active
    // approach/tail stroke. The same area becomes yellow for review, green
    // after confirmation. Ear clipping preserves furniture indentations.
    const area=this.pending?.points||(this.walk?.closed?points:(!this.walk?this.savedPoints:[]));
    const contour=area.map(p=>new T.Vector2(p.x,p.y)),triangles=contour.length>=3?T.ShapeUtils.triangulateShape(contour,[]):[];
    const filled=triangles.flatMap(face=>face.flatMap(index=>[area[index].x,.043,area[index].y]));
    this.fill.geometry.setAttribute('position',new T.Float32BufferAttribute(filled,3));this.fill.geometry.computeBoundingSphere();this.fill.visible=!!filled.length;
    this.fill.material.color.set(this.pending?'#fde047':this.walk?'#f0abfc':'#4ade80');
    // A floor ribbon is visible on Quest even where WebGL lines are one pixel.
    const ribbon=[];
    this.savedPoints.forEach((a,i)=>{
      const b=this.savedPoints[(i+1)%this.savedPoints.length],length=Math.hypot(b.x-a.x,b.y-a.y),dx=-(b.y-a.y)*.009/length,dz=(b.x-a.x)*.009/length;
      ribbon.push(a.x+dx,.052,a.y+dz,a.x-dx,.052,a.y-dz,b.x+dx,.052,b.y+dz,
        b.x+dx,.052,b.y+dz,a.x-dx,.052,a.y-dz,b.x-dx,.052,b.y-dz);
    });
    this.savedOutline.geometry.setAttribute('position',new T.Float32BufferAttribute(ribbon,3));this.savedOutline.geometry.computeBoundingSphere();this.savedOutline.visible=!!this.savedPoints.length&&!this.walk&&!this.pending;
    this.renderStatus();
  },
  describe: function () {
    const points=this.pending?.points||this.walk?.points||this.savedPoints;
    return [this.status,`${this.walk?.laps||0} completed laps · ${points.length} corners`,this.pending?`${polygonArea(points).toFixed(2)} m² · Yellow: final preview`:'Pink: walked area · Green: saved',this.walk?.error||'', 'Headset rectangle is a reference only. Saved for this XR session.'].filter(Boolean).join('\n');
  },
  renderStatus: function () {
    document.querySelectorAll('.calibration-status').forEach(el=>el.setAttribute('text','value',this.status));
    this.watches().forEach(w=>{if(w.crossbarComponent?.menu.isOpen)w.crossbarComponent.menu.refresh();});
    const label=document.querySelector('#lab-diagnostics');if(label)label.textContent=this.observation.text().replaceAll('\n',' · ')+' | '+this.status;
  },
  downloadReport: function () {
    const json=JSON.stringify({schema:3,boundary:this.observation,manualFloor:{points:this.savedPoints,pending:this.pending,laps:this.walk?.laps,status:this.status}},null,2);
    let stored=false;try{localStorage.setItem('boundary-lab-report',json);stored=true;}catch(_){}
    try{const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='boundary-lab-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.reportStatus=stored?'Saved in browser. Download requested.':'Download requested.';}
    catch(_){this.reportStatus=stored?'Saved in browser; download unavailable.':'Could not save diagnostics.';}
    this.renderStatus();
  },
  remove: function () {
    this.endSession();for(const [name,fn] of Object.entries(this.handlers))this.el.removeEventListener(name,fn);
    this.el.object3D.remove(this.root);for(const object of [this.fill,this.trace,this.preview,this.savedOutline]){object.geometry.dispose();object.material.dispose();}
    if(this.el.enterVR===this.enterVRWrapper)this.el.enterVR=this.originalEnterVR;
  }
});
