import { BoundaryObservation } from './boundary-observation.js';
import { validateFloor } from './floor-drawing.js';
import { FloorPaint } from './floor-paint.js';
import { polygonArea } from '../../common/boundary-geometry.js';

AFRAME.registerComponent('boundary-floor-lab', {
  schema: {
    rig: {type:'selector',default:'#boundary-rig'},
    reader: {type:'selector',default:'#boundary-rig'}
  },
  init: function () {
    const T=AFRAME.THREE;
    this.observation=new BoundaryObservation();this.walk=null;this.savedPoints=[];
    this.phase='idle';this.status='Watch > Calibrate boundary';this.reportStatus='';
    this.inputItem={kind:'select',id:'calibration-input',label:'Input',value:'both',options:[{value:'both',label:'Walk + paint'},{value:'walk',label:'Walking only'},{value:'paint',label:'Controller only'}]};
    this.brushItem={kind:'select',id:'calibration-brush',label:'Paint brush width',value:.2,options:[.1,.2,.3].map(value=>({value,label:`${Math.round(value*100)} cm`}))};
    this.pressed=new Set();this.paintCursors=new Map();
    this.root=new T.Group();this.root.matrixAutoUpdate=false;this.root.visible=false;this.el.object3D.add(this.root);
    this.trace=new T.LineSegments(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#f0abfc',depthTest:false}));
    this.fill=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color:'#f0abfc',side:T.DoubleSide,transparent:true,opacity:.12,depthTest:false,depthWrite:false}));
    this.preview=new T.LineLoop(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#fde047',depthTest:false}));
    this.savedOutline=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color:'#4ade80',side:T.DoubleSide,depthTest:false}));
    this.walkerMarker=new T.Mesh(new T.RingGeometry(.028,.05,24),new T.MeshBasicMaterial({color:'#f0abfc',side:T.DoubleSide,depthTest:false}));
    this.walkerMarker.rotation.x=-Math.PI/2;this.walkerMarker.visible=false;this.walkerMarker.renderOrder=6;
    this.fill.renderOrder=2;this.trace.renderOrder=3;this.preview.renderOrder=4;this.savedOutline.renderOrder=5;
    this.root.add(this.fill,this.trace,this.preview,this.savedOutline,this.walkerMarker);
    this.handlers={
      'enter-vr':()=>this.attachSession(),'exit-vr':()=>this.endSession(),
      'headset-boundary-sample':e=>{this.observation.sample(e.detail.time,e.detail.points);},
      'headset-boundary-frame':e=>{this.boundary=e.detail;this.root.matrix.fromArray(e.detail.matrix);this.root.matrixWorldNeedsUpdate=true;this.root.visible=true;this.passthrough?.references.forEach(({object})=>{object.visible=false;});},
      'headset-boundary-reset':()=>this.invalidate('Boundary changed. Start calibration again.'),
      'headset-boundary-unavailable':()=>this.invalidate('Waiting for the headset boundary.'),
      'headset-boundary-ended':()=>this.invalidate('Enter XR to calibrate.'),
      'headset-boundary-tracking-lost':()=>this.invalidate('Tracking paused. Calibration stopped.',true),
      'watch-menu-ready':()=>this.renderStatus(),
      'menu-action':e=>this.select(e.detail.id),
      'menu-commit':e=>{if(e.detail.id==='calibration-input'||e.detail.id==='calibration-brush'){this.pauseDrawing();this.renderStatus();}}
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
      action('calibration-confirm','Yes, save boundary'),action('calibration-resume','Keep editing'),action('calibration-cancel','Cancel calibration')
    ];
    return [action('calibration-start','Start new calibration'),this.inputItem,this.brushItem,action('calibration-resume','Continue editing'),action('calibration-save','Save boundary'),action('calibration-cancel','Cancel')];
  },
  focusCalibration: function (component) {
    if(!this.walk&&!this.pending&&!this.interrupted)return;
    const menu=component.menu;menu.reset();
    const index=menu.level().items.findIndex(item=>item.id==='boundary-calibration');
    if(index>=0){menu.moveFocus(index);menu.activate();}
  },
  attachSession: function () {
    this.endSession();this.observation=new BoundaryObservation();this.session=this.el.renderer.xr.getSession();
    this.onPaintStart=e=>{if(this.active&&!this.pending&&this.inputItem.value!=='walk'&&!this.menuVisible()&&e.inputSource.targetRayMode==='tracked-pointer')this.pressed.add(e.inputSource);};
    this.onPaintEnd=e=>{this.pressed.delete(e.inputSource);this.walk?.endStroke(e.inputSource);};
    this.session?.addEventListener('selectstart',this.onPaintStart);this.session?.addEventListener('selectend',this.onPaintEnd);
    this.status='Watch > Calibrate boundary';this.renderStatus();
  },
  endSession: function () {
    this.session?.removeEventListener('selectstart',this.onPaintStart);this.session?.removeEventListener('selectend',this.onPaintEnd);this.pauseDrawing();
    this.session=null;this.invalidate('Enter XR to calibrate.');
  },
  invalidate: function (message,trackingOnly=false) {
    this.pauseDrawing();
    // Keep passthrough visible if measurement stops while someone is walking.
    if(this.session&&this.passthrough){this.active=false;this.interrupted=true;message+=' Passthrough stays on; choose Cancel to return.';}
    else this.stop();
    this.walk=null;this.pending=null;this.boundary=null;this.root.visible=false;
    if(!trackingOnly)this.savedPoints=[];
    this.phase=this.savedPoints.length?'saved':'idle';this.status=message;this.redraw();
    this.el.emit('walking-calibration-invalidated',{trackingOnly},false);
  },
  start: function () {
    if(!this.session||!this.boundary){this.status='Enter XR and wait for the cyan boundary.';this.renderStatus();return;}
    if(!this.el.is('ar-mode')||this.session.environmentBlendMode==='opaque') {
      this.status='Floor calibration needs passthrough. It is unavailable in this session.';this.renderStatus();return;
    }
    this.pauseDrawing();this.walk=new FloorPaint();this.pending=null;this.phase='walking';this.active=true;this.interrupted=false;this.lastDraw=-Infinity;
    this.showPassthrough();this.closeWatches();
    this.status='Walk a closed perimeter, or point down and hold the trigger to paint. Both add to the same floor. Open watch to Save.';this.redraw();
    this.el.emit('walking-calibration-started',{},false);
  },
  showPassthrough: function () {
    if(this.passthrough)return;
    const rig=this.data.rig,reader=this.data.reader.components['headset-boundary'];
    this.passthrough={background:this.el.object3D.background,alpha:this.el.renderer.getClearAlpha(),position:rig.object3D.position.clone(),quaternion:rig.object3D.quaternion.clone(),locomotion:rig.getAttribute('locomotion-demo'),objects:Array.from(this.el.querySelectorAll('[data-calibration-opaque]')).map(el=>({el,visible:el.object3D.visible})),references:[reader.outline,reader.corners,reader.fitOutline].map(object=>({object,visible:object.visible}))};
    rig.removeAttribute('locomotion-demo');rig.object3D.position.set(0,0,0);rig.object3D.quaternion.identity();
    this.passthrough.objects.forEach(({el})=>{el.object3D.visible=false;});
    this.passthrough.references.forEach(({object})=>{object.visible=false;});
    this.el.object3D.background=null;this.el.renderer.setClearAlpha(0);
  },
  stop: function () {
    this.pauseDrawing();
    this.active=false;this.interrupted=false;
    if(!this.passthrough)return;
    const rig=this.data.rig,old=this.passthrough;
    this.el.object3D.background=old.background;this.el.renderer.setClearAlpha(old.alpha);
    old.objects.forEach(({el,visible})=>{el.object3D.visible=visible;});
    old.references.forEach(({object,visible})=>{object.visible=visible;});
    rig.object3D.position.copy(old.position);rig.object3D.quaternion.copy(old.quaternion);
    if(old.locomotion)rig.setAttribute('locomotion-demo',old.locomotion);
    this.passthrough=null;
  },
  closeWatches: function () {
    this.watches().forEach(w=>w.projectedMenu?.close());
    this.el.systems['visor-menu']?.component?.menu.close();
  },
  select: function (id) {
    if(id==='calibration-start'){this.start();return;}
    if(id==='calibration-cancel') {
      this.stop();this.walk=null;this.pending=null;this.phase=this.savedPoints.length?'saved':'idle';
      this.status='Calibration cancelled. Previous saved boundary kept.';this.redraw();return;
    }
    if(id==='calibration-resume') {
      if(!this.walk||!this.boundary){this.status='Choose Start new calibration first.';this.renderStatus();return;}
      this.pauseDrawing();this.pending=null;this.phase='walking';this.active=true;this.closeWatches();
      this.status='Walk or hold a controller trigger to paint missing areas. Closed outlines fill automatically. Open watch to Save.';this.redraw();return;
    }
    if(id==='calibration-save') {
      if(!this.walk||!this.boundary){this.status='Start calibration, then walk or paint the floor area.';this.renderStatus();return;}
      this.active=false;
      this.pauseDrawing();
      const result=this.walk.finalise();
      if(result.error){this.status=result.error+' Choose Continue editing.';this.redraw();return;}
      this.pending={points:result.points,revision:this.boundary.revision};this.phase='review';
      this.status='Save this boundary? Review the yellow outline, then choose Yes, save boundary.';
      this.redraw();this.watches().forEach(w=>{if(w.crossbarComponent?.menu.isOpen)this.focusCalibration(w.crossbarComponent);});
      const visor=this.el.systems['visor-menu']?.component;if(visor?.menu.isOpen)this.focusCalibration(visor);return;
    }
    if(id==='calibration-confirm') {
      if(!this.pending||!this.boundary)return;
      const error=this.pending.revision!==this.boundary.revision?'Tracking reference changed. Calibrate again.':validateFloor(this.pending.points);
      if(error){this.pending=null;this.status=error;this.redraw();return;}
      this.savedPoints=this.pending.points.map(p=>({...p}));this.pending=null;this.walk=null;this.phase='saved';this.stop();
      this.status=`Boundary saved: ${polygonArea(this.savedPoints).toFixed(2)} m². Green is your confirmed floor.`;
      // Storage failure must not prevent locking or drawing this session's
      // accepted polygon. New sessions require a new tracking alignment.
      try{localStorage.setItem('boundary-lab-calibration',JSON.stringify({schema:1,points:this.savedPoints,reportedBoundary:this.boundary.points,revision:this.boundary.revision}));}
      catch(_){this.status+=' Browser storage unavailable; saved for this session.';}
      this.redraw();this.el.emit('walking-calibration-confirmed',{points:this.savedPoints.map(p=>({...p})),revision:this.boundary.revision},false);return;
    }
    if(id==='save-diagnostics')this.downloadReport();
  },
  menuVisible: function () {return this.watches().some(w=>w.projectedMenu?.active||w.projectedMenu?.visible)||!!this.el.systems['visor-menu']?.component?.menu.isOpen;},
  pauseDrawing: function () {
    this.walk?.endStrokes();this.pressed?.clear();this.paintCursors?.forEach(cursor=>{cursor.group.visible=false;});
  },
  cursorFor: function (source) {
    let cursor=this.paintCursors.get(source);if(cursor)return cursor;
    const T=AFRAME.THREE,group=new T.Group(),material=new T.MeshBasicMaterial({color:'#f0abfc',side:T.DoubleSide,transparent:true,opacity:.8,depthTest:false,depthWrite:false});
    const brush=new T.Mesh(new T.RingGeometry(.85,1,32),material);brush.rotation.x=-Math.PI/2;
    const beam=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#f0abfc',transparent:true,opacity:.5,depthTest:false}));
    group.add(brush,beam);group.renderOrder=7;this.root.add(group);cursor={group,brush,beam};this.paintCursors.set(source,cursor);return cursor;
  },
  tick: function (time) {
    time=Number.isFinite(time)?time:performance.now();
    if(time-(this.statusTime||0)>500){this.statusTime=time;this.renderStatus();}
    if(!this.active||!this.walk||!this.session||!this.boundary)return;
    const frame=this.el.renderer.xr.getFrame(),space=this.data.reader.components['headset-boundary'].boundedSpace;
    if(!frame||!space)return;
    const viewer=frame.getViewerPose(space);
    if(!viewer){this.invalidate('Tracking lost. Calibration stopped.',true);return;}
    const p=viewer.transform.position;
    if(!Number.isFinite(p.x)||!Number.isFinite(p.z)){this.invalidate('Tracking lost. Calibration stopped.',true);return;}
    const paused=this.menuVisible();
    this.walkerMarker.position.set(p.x,.057,p.z);this.walkerMarker.visible=true;
    this.walkerMarker.material.color.set(paused?'#fde047':'#f0abfc');
    if(paused){this.pauseDrawing();return;}
    let changed=false;
    if(this.inputItem.value!=='paint')changed=this.walk.add({x:p.x,y:p.z});else this.walk.endStroke('walk');
    this.walkerMarker.visible=this.inputItem.value!=='paint';
    const sources=new Set(this.session.inputSources||[]);
    for(const [source,cursor] of this.paintCursors)if(!sources.has(source)){this.pressed.delete(source);this.walk.endStroke(source);this.root.remove(cursor.group);cursor.brush.geometry.dispose();cursor.brush.material.dispose();cursor.beam.geometry.dispose();cursor.beam.material.dispose();this.paintCursors.delete(source);}
    for(const source of sources){
      if(source.targetRayMode!=='tracked-pointer')continue;
      const cursor=this.cursorFor(source),pose=frame.getPose?.(source.targetRaySpace,space);cursor.group.visible=false;
      if(this.inputItem.value==='walk'||!pose){this.walk.endStroke(source);this.pressed.delete(source);continue;}
      const origin=pose.transform.position,direction=new AFRAME.THREE.Vector3(0,0,-1).applyQuaternion(pose.transform.orientation);
      const reach=-origin.y/direction.y;
      if(direction.y>=-.12||reach<=0||reach>4||![origin.x,origin.y,origin.z,reach].every(Number.isFinite)){this.walk.endStroke(source);this.pressed.delete(source);continue;}
      const hit={x:origin.x+direction.x*reach,y:origin.z+direction.z*reach},radius=this.brushItem.value/2;
      cursor.group.visible=true;cursor.brush.position.set(hit.x,.058,hit.y);cursor.brush.scale.setScalar(radius);
      cursor.brush.material.color.set(this.pressed.has(source)?'#fde047':'#f0abfc');
      cursor.beam.geometry.setAttribute('position',new AFRAME.THREE.Float32BufferAttribute([origin.x,origin.y,origin.z,hit.x,.058,hit.y],3));cursor.beam.geometry.computeBoundingSphere();
      if(this.pressed.has(source))changed=this.walk.paint(source,hit,radius)||changed;else this.walk.endStroke(source);
    }
    if(this.walk.error)this.status=this.walk.error;
    else if(changed)this.status='Purple is painted floor. Close an outline to fill it, or hold a trigger to paint gaps. Open watch to Save.';
    if((changed||this.walk.dirty)&&time-(this.lastDraw||0)>=100){this.lastDraw=time;this.redraw();}
  },
  redraw: function () {
    const T=AFRAME.THREE,contours=this.walk?.contours||[],points=contours[0]||[];
    // LineSegments draws each contour separately. Never connect a stray
    // island or a controller release to another stroke with a diagonal.
    const line=contours.flatMap(ring=>ring.flatMap((p,i)=>{const q=ring[(i+1)%ring.length];return [p.x,.047,p.y,q.x,.047,q.y];}));
    this.trace.geometry.setAttribute('position',new T.Float32BufferAttribute(line,3));this.trace.geometry.computeBoundingSphere();
    this.trace.visible=!!points.length&&!this.pending;
    this.preview.geometry.setAttribute('position',new T.Float32BufferAttribute((this.pending?.points||[]).map(p=>[p.x,.05,p.y]).flat(),3));this.preview.geometry.computeBoundingSphere();this.preview.visible=!!this.pending;
    // Draw the mask's actual connected contours, including open brush
    // ribbons. The final polygon is yellow in review and green after saving.
    const areas=this.pending?[this.pending.points]:this.walk?contours:[this.savedPoints];
    const filled=areas.flatMap(area=>{const contour=area.map(p=>new T.Vector2(p.x,p.y)),triangles=contour.length>=3?T.ShapeUtils.triangulateShape(contour,[]):[];return triangles.flatMap(face=>face.flatMap(index=>[area[index].x,.043,area[index].y]));});
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
    if(!this.active||!this.walk)this.walkerMarker.visible=false;
    this.renderStatus();
  },
  describe: function () {
    const points=this.pending?.points||this.walk?.points||this.savedPoints;
    return [this.status,`${points.length} corners · ${(this.walk&&!this.pending?this.walk.area:points.length>2?polygonArea(points):0).toFixed(2)} m²`,this.pending?'Yellow: final polygon preview':'Purple: painted floor · Green: saved',this.walk?.error||'', 'Trigger: paint floor · Watch pauses both inputs. Headset rectangle is a reference only.'].filter(Boolean).join('\n');
  },
  renderStatus: function () {
    document.querySelectorAll('.calibration-status').forEach(el=>el.setAttribute('text','value',this.status));
    this.watches().forEach(w=>{if(w.crossbarComponent?.menu.isOpen)w.crossbarComponent.menu.refresh();});
    const label=document.querySelector('#lab-diagnostics');if(label)label.textContent=this.observation.text().replaceAll('\n',' · ')+' | '+this.status;
  },
  downloadReport: function () {
    const json=JSON.stringify({schema:4,boundary:this.observation,manualFloor:{points:this.savedPoints,pending:this.pending,contours:this.walk?.contours,cellSize:this.walk?.cellSize,input:this.inputItem.value,brushWidth:this.brushItem.value,status:this.status}},null,2);
    let stored=false;try{localStorage.setItem('boundary-lab-report',json);stored=true;}catch(_){}
    try{const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='boundary-lab-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.reportStatus=stored?'Saved in browser. Download requested.':'Download requested.';}
    catch(_){this.reportStatus=stored?'Saved in browser; download unavailable.':'Could not save diagnostics.';}
    this.renderStatus();
  },
  remove: function () {
    this.endSession();for(const [name,fn] of Object.entries(this.handlers))this.el.removeEventListener(name,fn);
    this.el.object3D.remove(this.root);for(const object of [this.fill,this.trace,this.preview,this.savedOutline,this.walkerMarker]){object.geometry.dispose();object.material.dispose();}
    this.paintCursors.forEach(cursor=>{cursor.brush.geometry.dispose();cursor.brush.material.dispose();cursor.beam.geometry.dispose();cursor.beam.material.dispose();});this.paintCursors.clear();
    if(this.el.enterVR===this.enterVRWrapper)this.el.enterVR=this.originalEnterVR;
  }
});
