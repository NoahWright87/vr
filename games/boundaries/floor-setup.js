import { BoundaryObservation } from './boundary-observation.js';
import { FloorDrawing, segmentInside, validateFloor } from './floor-drawing.js';
import { insidePolygon, polygonArea } from '../../common/boundary-geometry.js';

AFRAME.registerComponent('boundary-floor-lab', {
  init: function () {
    const T=AFRAME.THREE;
    this.observation=new BoundaryObservation();this.drawing=new FloorDrawing();
    this.status='Watch > Floor boundary > Start drawing';this.reportStatus='';
    this.root=new T.Group();this.root.matrixAutoUpdate=false;this.root.visible=false;
    this.el.object3D.add(this.root);
    this.outline=new T.LineSegments(new T.BufferGeometry(),new T.LineBasicMaterial({vertexColors:true,depthTest:false}));
    this.corners=new T.Points(new T.BufferGeometry(),new T.PointsMaterial({color:'#f0abfc',size:.055,sizeAttenuation:true,depthTest:false}));
    this.cursor=new T.Mesh(new T.RingGeometry(.025,.04,24),new T.MeshBasicMaterial({color:'#f0abfc',side:T.DoubleSide,depthTest:false}));
    this.cursor.rotation.x=-Math.PI/2;this.cursor.visible=false;
    this.root.add(this.outline,this.corners,this.cursor);
    this.held=new Set();this.drag=-1;this.owner=null;
    this.handlers={
      'enter-vr':()=>this.attachSession(),
      'exit-vr':()=>this.endSession(),
      'headset-boundary-sample':e=>{this.observation.sample(e.detail.time,e.detail.points);this.renderStatus();},
      'headset-boundary-frame':e=>{this.boundary=e.detail;this.root.matrix.fromArray(e.detail.matrix);this.root.matrixWorldNeedsUpdate=true;this.root.visible=true;},
      'headset-boundary-reset':()=>this.invalidate('Boundary changed. Please redraw.'),
      'headset-boundary-tracking-lost':()=>this.invalidate('Tracking lost. Please redraw.'),
      'headset-boundary-unavailable':()=>this.invalidate('Waiting for the headset boundary.'),
      'headset-boundary-ended':()=>this.invalidate('Enter VR to draw a floor boundary.'),
      'watch-menu-ready':()=>this.renderStatus(),
      'projected-menu-opened':e=>{
        const pages=e.target.components['projected-menu']?.panelEl.components['menu-pages'];
        if(this.calibrating||this.interrupted)pages?.showPage('calibration');
        else if(this.active||this.savedRig)pages?.showPage('floor');
      },
      'menu-item-select':e=>this.select(e.detail.value)
    };
    for(const [name,fn] of Object.entries(this.handlers))this.el.addEventListener(name,fn);
    this.selectStart=e=>this.held.add(e.inputSource);
    this.selectEnd=e=>this.held.delete(e.inputSource);
    // Negotiate passthrough at the real entry gesture. Watch selections can
    // then reveal it without ending XR or requesting room/plane permissions.
    this.originalEnterVR=this.el.enterVR;
    const scene=this.el,original=this.originalEnterVR;
    this.enterVRWrapper=function(ar,offer) {
      if(scene.is('vr-mode')||scene.is('ar-mode'))return Promise.resolve('Already in XR');
      return original.call(scene,!!ar||AFRAME.utils.device.checkARSupport(),offer);
    };
    this.el.enterVR=this.enterVRWrapper;
  },
  attachSession: function () {
    this.endSession();this.observation=new BoundaryObservation();
    this.session=this.el.renderer.xr.getSession();
    if(!this.session)return;
    this.session.addEventListener('selectstart',this.selectStart);
    this.session.addEventListener('selectend',this.selectEnd);
    this.status='Watch > Floor boundary > Start drawing';this.renderStatus();
  },
  endSession: function () {
    if(this.session){this.session.removeEventListener('selectstart',this.selectStart);this.session.removeEventListener('selectend',this.selectEnd);}
    this.session=null;this.held.clear();this.invalidate('Enter VR to draw a floor boundary.');
  },
  invalidate: function (message) {
    // Losing tracking must stop measurement without covering the real room
    // while the person may still be walking. Cancel/Stop can restore the Lab.
    if(this.session&&this.passthrough) {
      this.interrupted=true;
      this.active=false;this.walking=false;this.cursor.visible=false;this.owner=null;this.drag=-1;
      message+=' Measurement stopped; passthrough stays on. Cancel to return to Lab.';
    } else this.stop();
    this.boundary=null;this.root.visible=false;
    this.calibrationBackup=null;this.calibrating=false;
    this.drawing=new FloorDrawing();this.status=message;this.redraw();
  },
  watches: function () {
    return ['left','right'].map(hand=>document.querySelector('#'+hand+'-hand')?.components['hand-with-watch']?.projectedMenu).filter(Boolean);
  },
  begin: function (edit=false) {
    if(!this.session || !this.boundary){this.status='Enter VR and wait for the cyan boundary.';this.renderStatus();return;}
    if(!edit && this.drawing.closed){this.status='Clear to draw again, or choose Edit corners.';this.renderStatus();return;}
    this.prepareRig();
    this.interrupted=false;
    if(this.el.is('ar-mode'))this.showPassthrough();
    this.active=true;this.walking=false;this.edit=edit;this.armed=false;this.owner=null;this.drag=-1;
    this.watches().forEach(watch=>watch.close());
    this.status=edit?'Aim at a pink corner. Hold trigger to drag.':'Aim at the floor. Hold trigger to draw. Release between strokes.';
    this.renderStatus();
  },
  prepareRig: function () {
    const rig=document.querySelector('#boundary-rig');
    if(!this.savedRig) {
      this.savedRig={position:rig.object3D.position.clone(),quaternion:rig.object3D.quaternion.clone(),locomotion:rig.getAttribute('locomotion-demo')};
      rig.removeAttribute('locomotion-demo');rig.object3D.position.set(0,0,0);rig.object3D.quaternion.identity();
      this.hidden=Array.from(this.el.querySelectorAll('[data-floor-prop]')).map(el=>({el,visible:el.object3D.visible}));
      this.hidden.forEach(({el})=>{el.object3D.visible=false;});
    }
  },
  showPassthrough: function () {
    if(this.passthrough)return;
    this.passthrough={background:this.el.object3D.background,alpha:this.el.renderer.getClearAlpha(),objects:Array.from(this.el.querySelectorAll('[data-calibration-opaque]')).map(el=>({el,visible:el.object3D.visible}))};
    this.passthrough.objects.forEach(({el})=>{el.object3D.visible=false;});
    this.el.object3D.background=null;this.el.renderer.setClearAlpha(0);
  },
  beginCalibration: function () {
    if(!this.session||!this.boundary){this.status='Enter XR and wait for the cyan boundary.';this.renderStatus();return;}
    if(!this.el.is('ar-mode') || this.session.environmentBlendMode==='opaque') {
      this.status='Walking calibration needs passthrough. It is unavailable in this session.';this.renderStatus();return;
    }
    if(!this.calibrationBackup)this.calibrationBackup=this.drawing;
    this.drawing=new FloorDrawing();this.drawing.checkpoint();
    this.calibrating=true;this.interrupted=false;this.prepareRig();this.showPassthrough();
    this.walking=true;this.active=true;this.walkBreak=false;this.cursor.visible=false;
    this.watches().forEach(watch=>watch.close());
    this.status='Walk slowly around the usable outline. Pink tracks your headset on the floor. Open watch to Confirm or Cancel.';
    this.redraw();
  },
  cancelCalibration: function () {
    this.stop();if(this.calibrationBackup)this.drawing=this.calibrationBackup;
    this.calibrationBackup=null;this.calibrating=false;
    this.status='Calibration cancelled. Previous Lab outline restored.';this.redraw();
  },
  confirmCalibration: function () {
    if(!this.calibrating){this.status='Choose Calibrate by walking first.';this.renderStatus();return;}
    this.active=false;this.cursor.visible=false;
    if(!this.drawing.closed)this.drawing.finish();
    const error=this.drawing.accept(this.boundary?.points);
    if(error){this.status=error+' Undo or edit the preview, then Confirm again.';this.redraw();return;}
    this.calibrationBackup=null;this.calibrating=false;this.stop();
    this.status=`Calibration confirmed in Lab: ${polygonArea(this.drawing.points).toFixed(2)} m²`;this.redraw();
  },
  stop: function () {
    this.active=false;this.walking=false;this.interrupted=false;this.cursor.visible=false;this.owner=null;this.drag=-1;
    if(this.passthrough) {
      this.el.object3D.background=this.passthrough.background;this.el.renderer.setClearAlpha(this.passthrough.alpha);
      this.passthrough.objects.forEach(({el,visible})=>{el.object3D.visible=visible;});this.passthrough=null;
    }
    if(this.savedRig) {
      const rig=document.querySelector('#boundary-rig');
      rig.object3D.position.copy(this.savedRig.position);rig.object3D.quaternion.copy(this.savedRig.quaternion);
      if(this.savedRig.locomotion)rig.setAttribute('locomotion-demo',this.savedRig.locomotion);
      this.hidden.forEach(({el,visible})=>{el.object3D.visible=visible;});this.savedRig=null;
    }
  },
  select: function (value) {
    switch(value) {
      case 'calibration-start':this.beginCalibration();return;
      case 'calibration-confirm':this.confirmCalibration();return;
      case 'calibration-cancel':this.cancelCalibration();return;
      case 'calibration-resume':
        if(!this.calibrating)return;
        this.drawing.checkpoint();this.drawing.closed=false;this.walking=true;this.active=true;this.walkBreak=true;
        this.watches().forEach(watch=>watch.close());this.status='Keep walking the outline. Open watch to Confirm or Cancel.';this.redraw();return;
      case 'floor-start':this.begin();return;
      case 'floor-edit':this.begin(true);return;
      case 'floor-finish':
        if(!this.boundary)return;
        this.active=false;this.cursor.visible=false;this.drawing.finish();
        this.status=validateFloor(this.drawing.points,this.boundary.points)||'Preview ready. Edit corners or Save in Lab.';break;
      case 'floor-undo':this.drawing.undo();this.status='Undone. Draw more or edit the corners.';break;
      case 'floor-clear':this.drawing.clear();this.status='Cleared. Choose Start drawing.';this.active=false;break;
      case 'floor-save':
        this.status=this.drawing.accept(this.boundary?.points)||`Saved in Lab: ${Math.abs(polygonArea(this.drawing.points)).toFixed(2)} m²`;
        if(this.drawing.saved){this.calibrationBackup=null;this.calibrating=false;this.stop();}break;
      case 'floor-stop':
        if(this.calibrating){this.cancelCalibration();return;}
        this.stop();this.status='Drawing paused. Preview kept in this XR session.';break;
      case 'save-diagnostics':this.downloadReport();return;
      default:return;
    }
    // Watch selections never continue a stroke after the menu closes.
    this.armed=false;this.owner=null;this.drag=-1;this.redraw();
  },
  tick: function () {
    if(!this.active||!this.session||!this.boundary)return;
    const frame=this.el.renderer.xr.getFrame(),space=document.querySelector('#boundary-rig').components['headset-boundary'].boundedSpace;
    if(!frame||!space)return;
    const viewer=frame.getViewerPose(space);
    if(!viewer){this.invalidate('Tracking lost. Please redraw.');return;}
    if(this.walking) {
      if(this.watches().some(watch=>watch.active||watch.visible)){this.walkBreak=true;return;}
      if(this.walkBreak){this.drawing.checkpoint();this.walkBreak=false;}
      const p=viewer.transform.position,point={x:p.x,y:p.z};
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)){this.invalidate('Tracking lost. Please redraw.');return;}
      this.drawing.add(point,.05);this.redraw();return;
    }
    const sources=Array.from(this.session.inputSources).filter(source=>source.targetRaySpace);
    const pressed=source=>source.gamepad?.buttons[0]?.pressed ?? this.held.has(source);
    if(this.watches().some(watch=>watch.active || watch.visible)) {
      this.armed=false;this.cursor.visible=false;this.owner=null;this.drag=-1;return;
    }
    if(!this.armed){this.armed=sources.every(source=>!pressed(source));this.cursor.visible=false;return;}
    if(this.owner && (!sources.includes(this.owner)||!pressed(this.owner))){this.owner=null;this.drag=-1;}
    const source=this.owner||sources.find(s=>pressed(s))||sources.find(s=>s.handedness==='right')||sources[0];
    if(!source){this.cursor.visible=false;return;}
    const pose=frame.getPose(source.targetRaySpace,space);
    const point=pose&&this.floorHit(pose.transform.matrix);
    this.cursor.visible=!!point;
    if(point){this.cursor.position.set(point.x,.048,point.y);this.cursor.material.color.set(insidePolygon(point,this.boundary.points)?'#f0abfc':'#ff5555');}
    const down=pressed(source);
    if(!down||!point)return;
    if(!this.owner) {
      this.owner=source;
      this.drawing.checkpoint();
      if(this.edit)this.drag=this.drawing.nearest(point);
    }
    if(this.edit) {
      if(this.drag>=0){this.drawing.points[this.drag]={...point};this.drawing.saved=false;}
    } else this.drawing.add(point);
    this.redraw();
  },
  floorHit: function (matrix) {
    // XR target-ray local -Z, expressed directly in bounded-floor space.
    const dy=-matrix[9],height=matrix[13];
    if(!Number.isFinite(height)||dy>=-.05)return null;
    const t=-height/dy;
    if(t<0||t>8)return null;
    const point={x:matrix[12]-matrix[8]*t,y:matrix[14]-matrix[10]*t};
    return Number.isFinite(point.x)&&Number.isFinite(point.y)?point:null;
  },
  redraw: function () {
    const T=AFRAME.THREE,points=this.drawing.points,positions=[],colors=[],dots=[];
    for(const p of points)dots.push(p.x,.048,p.y);
    const count=this.drawing.closed?points.length:Math.max(0,points.length-1);
    const color=new T.Color(this.drawing.saved?'#86efac':'#f0abfc'),red=new T.Color('#ff5555');
    for(let i=0;i<count;i++) {
      const a=points[i],b=points[(i+1)%points.length],c=this.boundary&&segmentInside(a,b,this.boundary.points)?color:red;
      positions.push(a.x,.047,a.y,b.x,.047,b.y);colors.push(c.r,c.g,c.b,c.r,c.g,c.b);
    }
    this.outline.geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    this.outline.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    this.outline.geometry.computeBoundingSphere();
    this.corners.geometry.setAttribute('position',new T.Float32BufferAttribute(dots,3));this.corners.geometry.computeBoundingSphere();
    this.renderStatus();
  },
  renderStatus: function () {
    const set=(selector,message)=>document.querySelectorAll(selector).forEach(el=>el.setAttribute('text','value',message));
    set('.boundary-observation',this.observation.text());set('.floor-status, .calibration-status',this.status);set('.report-status',this.reportStatus);
    set('.floor-detail',`${this.drawing.points.length} corners · ${this.drawing.closed?'closed preview':'open outline'}\nPink: your drawing · Red: outside · Green: saved\nSaved only for this Lab session.`);
    const status=document.querySelector('#lab-diagnostics');if(status)status.textContent=this.observation.text().replaceAll('\n',' · ')+' | '+this.status;
  },
  downloadReport: function () {
    const report={schema:2,userAgent:navigator.userAgent,boundary:this.observation,manualFloor:{points:this.drawing.points,closed:this.drawing.closed,saved:this.drawing.saved,revision:this.boundary?.revision,status:this.status},note:'All floor points use bounded-floor coordinates. The manual outline is a Lab preview within the reported boundary; redraw after tracking loss or a new XR session.'};
    const json=JSON.stringify(report,null,2);let stored=false;
    try{localStorage.setItem('boundary-lab-report',json);stored=true;}catch(_){}
    try {
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='boundary-lab-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      this.reportStatus=stored?'Saved in this browser. Download requested.':'Download requested; browser storage unavailable.';
    }catch(_){this.reportStatus=stored?'Saved in this browser; download unavailable in XR.':'Could not save diagnostics.';}
    this.renderStatus();
  },
  remove: function () {
    this.endSession();for(const [name,fn] of Object.entries(this.handlers))this.el.removeEventListener(name,fn);
    this.el.object3D.remove(this.root);for(const object of [this.outline,this.corners,this.cursor]){object.geometry.dispose();object.material.dispose();}
    if(this.el.enterVR===this.enterVRWrapper)this.el.enterVR=this.originalEnterVR;
  }
});
