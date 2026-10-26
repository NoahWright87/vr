import { generationSettings, generationValues, focusGeneration } from './generation-menu.js';
import { DEFAULT_MIX } from './core/templates.ts';
import { createRuntime, movePlayer, renderWalls } from './core/runtime.ts';
import { centroid } from './core/geometry.ts';
import { normalizeFootprint } from './core/footprint.ts';
import { createRide, beginRide, advanceRide, doorClosure, followPhysicalPose, nearWall } from './core/vr-runtime.ts';
import { LevelView } from './render.ts';
import { ExpandedSession } from '../expanding-rooms/session.ts';

const THREE = AFRAME.THREE;
const $ = (id: string) => document.getElementById(id)!;
const number = (id: string, min: number, max: number) => {
  const n = Number(($(id) as HTMLInputElement).value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Check ${id.replaceAll('-', ' ')} (${min}–${max}).`);
  return n;
};

export function previewBoundary(shape: string, w: number, h: number) {
  if (shape === 'l') return [{x:0,y:0},{x:w,y:0},{x:w,y:h*.55},{x:w*.55,y:h*.55},{x:w*.55,y:h},{x:0,y:h}];
  if (shape === 'notch') return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:w*.65,y:h},{x:w*.65,y:h*.65},{x:w*.35,y:h*.65},{x:w*.35,y:h},{x:0,y:h}];
  if (shape === 'chamfer') { const k = Math.min(w,h)*.2; return [{x:k,y:0},{x:w-k,y:0},{x:w,y:k},{x:w,y:h-k},{x:w-k,y:h},{x:k,y:h},{x:0,y:h-k},{x:0,y:k}]; }
  return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
}

AFRAME.registerComponent('impossible-game', {
  schema:{lab:{default:false},expanded:{default:false},rig:{type:'selector',default:'#player'},camera:{type:'selector',default:'#camera'},reader:{type:'selector',default:'#boundary-reader'}},
  init() {
    this.xr = false; this.level = null; this.state = null; this.view = null; this.worker = null;
    this.style=this.data.lab?'rooms-first':'growth';this.source='traced';this.manualBoundary=null;this.labMode=false;
    this.boundary = null; this.revision = null; this.ride = createRide(); this.keys = new Set(); this.outline = true;
    this.tracking = false; this.outside = false; this.message = ''; this.detail = ''; this.generating = false;
    this.scene = this.el.sceneEl; this.rig=this.data.rig;this.camera = this.data.camera;this.reader=this.data.reader; this.world = $('world'); this.panel = $('elevator-panel');
    this.expansion = this.data.expanded ? new ExpandedSession(this) : null;
    this.transform = new THREE.Matrix4(); this.originTransform = new THREE.Matrix4(); this.buttonPoint = new THREE.Vector3(); this.fingerPoint = new THREE.Vector3();
    this.previewOutline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#22d3ee', depthTest: false }));
    this.scene.object3D.add(this.previewOutline);
    this.recovery = new THREE.Mesh(new THREE.RingGeometry(.15,.2,32),new THREE.MeshBasicMaterial({color:'#ffe29a',side:THREE.DoubleSide,depthTest:false}));
    this.recovery.rotation.x = -Math.PI/2;this.recovery.visible=false;this.scene.object3D.add(this.recovery);
    this.handlers = [];
    this.listen = (target: any, event: string, callback: any) => { if(!target)return;target.addEventListener(event, callback); this.handlers.push([target,event,callback]); };
    this.listen(this.scene, 'enter-vr', () => {
      this.xr = true; this.keys.clear(); this.boundary = null; this.revision = null; this.tracking = false;
      this.manualBoundary=null;
      this.cancelGeneration(); this.clearLevel(); this.previewOutline.visible = false;
      this.rig.object3D.position.set(0,0,0);
      const look = this.camera.components['look-controls'];
      if (look) { look.yawObject.rotation.y = 0; look.pitchObject.rotation.x = 0; }
      document.body.classList.add('xr-active'); this.status(this.expansion?'Set your boundary':'Calibrate your usable area', this.expansion?'Choose Set Boundary on the panel in front of you.':'Save and confirm your boundary, then Watch → Generate level.');
    });
    this.listen(this.scene, 'exit-vr', () => {
      this.xr = false; document.body.classList.remove('xr-active'); this.cancelGeneration();if(this.expansion){this.clearLevel();this.manualBoundary=null;}else if(this.data.lab){this.clearLevel();this.restoreLab();}else this.generate(false);
    });
    this.listen(this.scene, 'headset-boundary-frame', (event: any) => this.onBoundaryFrame(event.detail));
    this.listen(this.scene, 'headset-boundary-reset', () => {
      this.cancelGeneration(); this.clearLevel(); this.revision = null; this.tracking = false;
      this.manualBoundary=null;
      this.status('Tracking origin changed', 'Calibrate again before generating in your traced area.');
    });
    this.listen(this.scene, 'headset-boundary-tracking-lost', () => { if (this.xr) { this.expansion?.walker?.resetSamples();this.tracking = false; this.world.object3D.visible = false; this.panel.object3D.visible = false; this.status('Tracking paused', 'Wait for headset tracking to return.'); } });
    this.listen(this.scene, 'headset-boundary-unavailable', () => { if (this.xr) this.status('Boundary unavailable', 'This browser must provide bounded-floor data. No guessed VR footprint.'); });
    this.listen(this.scene, 'menu-action', (event: any) => {
      if (event.detail.id === 'ride') this.requestRide();
      if (event.detail.id === 'regenerate') this.generate(true);
      if (event.detail.id === 'generate-current') this.generate(true);
      if (event.detail.id === 'return-to-lab') {if(this.measuring())this.status('Finish calibration first','Save or Cancel before returning to the Lab.');else{this.cancelGeneration();this.clearLevel();this.restoreLab();this.status('Boundary Lab','Your saved area is ready. Watch → Generate level.');}}
      if (event.detail.id === 'outline') this.toggleOutline();
      if (event.detail.id === 'margin') this.cycleSetting('margin', [.1,.25,.4]);
      if (event.detail.id === 'width') this.cycleSetting('door-width', [.8,1,1.2]);
      if (event.detail.id === 'generate-growth') this.generate(false,'growth');
      if (event.detail.id === 'generate-rooms-first') this.generate(false,'rooms-first');
      if (event.detail.id === 'ride-next') this.requestRide(1);
      if (event.detail.id === 'ride-previous') this.requestRide(-1);
      if (event.detail.id === 'use-traced') {if(!this.manualBoundary)this.status('Calibrate your area first','The traced polygon is valid only in this XR session.');else{this.cancelGeneration();this.source='traced';this.clearLevel();this.updateFootprintDisplay();this.status('Using your traced area','Choose a style and Generate!');}}
      if (event.detail.id === 'use-headset') {this.cancelGeneration();this.source='headset';this.clearLevel();this.updateFootprintDisplay();this.status('Using headset boundary','Choose a style and Generate!');}
    });
    this.listen(this.scene,'menu-commit',()=>this.renderStatus());
    this.listen(this.scene,'walking-calibration-started',()=>{this.expansion?.walker?.resetSamples();this.cancelGeneration();this.world.object3D.visible=false;this.panel.object3D.visible=false;this.ride=createRide();});
    this.listen(this.scene,'walking-calibration-invalidated',(event:any)=>{if(!event.detail.trackingOnly){this.manualBoundary=null;if(this.xr){this.cancelGeneration();this.clearLevel();}}});
    this.listen(this.scene,'walking-calibration-confirmed',(event:any)=>{
      this.manualBoundary={points:event.detail.points.map((p:any)=>({...p})),revision:event.detail.revision};this.source='traced';this.clearLevel();
      this.status('Boundary saved — ready to explore',this.expansion?'Choose Generate level on the setup panel.':'Step inside the green outline. Watch → Generate level → Generate new rooms.');
      this.updateFootprintDisplay();
      document.querySelectorAll('[hand-with-watch]').forEach(el=>{const c=el.components['hand-with-watch']?.crossbarComponent;if(c?.menu.isOpen&&!this.expansion)focusGeneration(c);});
      const visor=this.scene.systems['visor-menu']?.component;if(visor?.menu.isOpen&&!this.expansion)focusGeneration(visor);
    });
    this.listen(this.scene, 'watch-menu-ready', () => this.renderStatus());
    this.listen($('ride-button'), 'click', () => this.requestRide());
    this.listen($('ride-back-button'),'click',()=>this.requestRide(-1));
    this.listen($('generate'), 'click', () => this.generate(true));
    this.listen($('boundary-toggle'), 'click', () => this.toggleOutline());
    for (const id of ['shape','width','depth','door-width','margin','pieces','seed']) this.listen($(id), 'change', () => {this.syncDesktopSettings();if(!this.expansion)this.generate(false);});
    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (this.xr || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes((e.target as HTMLElement)?.tagName)) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'e' && !e.repeat) this.requestRide();
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(document, 'visibilitychange', () => this.keys.clear());
    // Hardware-independent touch support, including controller-only and hand-tracked sessions.
    this.touching = new Set();
    if(!this.data.lab&&!this.expansion)this.generate(false);
  },
  enterLabLevel(){
    if(!this.data.lab||this.labMode)return;
    const rig=this.rig,reader=this.reader.components['headset-boundary'];
    this.labState={locomotion:rig.getAttribute('locomotion-demo'),position:rig.object3D.position.clone(),quaternion:rig.object3D.quaternion.clone(),objects:Array.from(this.scene.querySelectorAll('[data-level-lab-prop]')).map(el=>({el,visible:el.object3D.visible})),readerFlags:{showOutline:reader.showOutline,showFit:reader.data.showFit}};
    this.labMode=true;rig.removeAttribute('locomotion-demo');rig.object3D.position.set(0,0,0);rig.object3D.quaternion.identity();
    const look=this.camera.components['look-controls'];if(look){look.yawObject.rotation.y=0;look.pitchObject.rotation.x=0;}
    this.labState.objects.forEach(({el})=>{el.object3D.visible=false;});this.updateFootprintDisplay();
  },
  restoreLab(){
    if(!this.labState)return;
    const old=this.labState,reader=this.reader.components['headset-boundary'];this.labState=null;this.labMode=false;
    old.objects.forEach(({el,visible})=>{el.object3D.visible=visible;});
    this.rig.object3D.position.copy(old.position);this.rig.object3D.quaternion.copy(old.quaternion);
    if(old.locomotion)this.rig.setAttribute('locomotion-demo',old.locomotion);
    reader.showOutline=old.readerFlags.showOutline;reader.outline.visible=reader.corners.visible=this.xr&&reader.showOutline!==false;
    reader.fitOutline.visible=this.xr&&old.readerFlags.showFit;
    const c=this.calibration();if(c){c.redraw();c.root.visible=this.xr&&this.tracking;}
    $('head-status')?.setAttribute('visible',false);
  },
  cycleSetting(id: string, values: number[]) {
    const input = $(id) as HTMLInputElement;
    input.value = String(values[(values.indexOf(Number(input.value)) + 1) % values.length]);
    this.syncDesktopSettings();this.generate(false);
  },
  calibration(){return this.scene.components['boundary-floor-lab'];},
  measuring(){return !!this.calibration()?.passthrough;},
  syncDesktopSettings(){
    const map={pieceCount:'pieces',boundaryMargin:'margin',minWidth:'door-width',seed:'seed'};
    for(const item of generationSettings.growth){const input=map[item.id.split(':')[1]];if(input)item.value=Number($(input).value);}
  },
  cancelGeneration() { this.worker?.terminate(); this.worker = null; this.generating = false; },
  clearLevel() {
    this.expansion?.clear();
    this.view?.dispose(); this.view = null; this.level = null; this.state = null; this.ride = createRide();
    this.panel.object3D.visible = false; this.world.object3D.visible = false;
    this.recovery.visible = false;
    $('ride-button').classList.remove('menu-target');
    $('ride-back-button').classList.remove('menu-target');
    this.panel.querySelector('.elevator-surface').classList.remove('pm-surface');
  },
  status(message: string, detail = '', head = true) {
    if (this.message === message && this.detail === detail && this.headMessage === head) return;
    this.message = message; this.detail = detail; this.headMessage = head; this.renderStatus();
  },
  renderStatus() {
    if($('status'))$('status').textContent = this.message + (this.detail ? ' · ' + this.detail.replaceAll('\n',' ') : '');
    $('head-status').setAttribute('text', 'value', this.message);
    if(this.expansion)$('head-status').object3D.visible=this.headMessage!==false&&!this.measuring();
    if(this.data.lab)$('head-status').object3D.visible=this.labMode&&!this.measuring();
    const text = $('head-status').getObject3D('text');
    if (text) { text.material.depthTest = false; text.material.depthWrite = false; text.renderOrder = 100; }
    document.querySelectorAll('[hand-with-watch]').forEach(el=>{const watch=el.components['hand-with-watch'];if(watch?.crossbarComponent?.menu.isOpen)watch.crossbarComponent.menu.refresh();});
    document.querySelectorAll('.game-status').forEach(el => el.setAttribute('text','value',this.message));
    document.querySelectorAll('.game-detail').forEach(el => el.setAttribute('text','value',this.detail));
  },
  toggleOutline() {
    this.outline = !this.outline;
    const reader = this.reader.components['headset-boundary'];
    reader.showOutline = this.outline&&this.source==='headset';
    reader.outline.visible = reader.corners.visible = this.xr && reader.showOutline && this.tracking;
    this.previewOutline.visible = !this.xr && this.outline;
    if($('boundary-toggle'))$('boundary-toggle').textContent = this.outline ? 'Hide outline' : 'Show outline';
    this.updateFootprintDisplay();
  },
  updateFootprintDisplay(){
    const c=this.calibration(),reader=this.reader.components['headset-boundary'];
    if(!this.xr||this.measuring()||(this.data.lab&&!this.labMode))return;
    reader.showOutline=this.source==='headset'&&this.outline;
    reader.outline.visible=reader.corners.visible=reader.showOutline&&this.tracking;
    reader.fitOutline.visible=false;
    if(c){c.fill.visible=false;c.root.visible=this.source==='traced'&&!!this.manualBoundary&&this.outline&&this.tracking;}
  },
  onBoundaryFrame(frame: any) {
    if (!this.xr) return;
    this.tracking = true; this.boundary = frame;
    if(this.manualBoundary&&this.manualBoundary.revision!==frame.revision){this.manualBoundary=null;this.cancelGeneration();this.clearLevel();this.status('Tracking origin changed','Calibrate again before generating.');}
    this.updateFootprintDisplay();
    if(this.measuring()){this.world.object3D.visible=false;this.panel.object3D.visible=false;return;}
    if (this.revision !== frame.revision) {
      this.revision = frame.revision;if(this.source==='headset'&&(!this.data.lab||this.labMode))this.generate(false);
    }
    if (!this.level) return;
    this.transform.fromArray(frame.matrix);
    this.originTransform.makeTranslation(this.footprint.origin.x, 0, this.footprint.origin.y);
    this.world.object3D.matrixAutoUpdate = false;
    this.world.object3D.matrix.copy(this.transform).multiply(this.originTransform);
    this.world.object3D.matrixWorldNeedsUpdate = true;
    const target = { x: frame.position.x - this.footprint.origin.x, y: frame.position.y - this.footprint.origin.y };
    this.outside = this.expansion ? !this.expansion.applyFrame(frame,target) : !followPhysicalPose(this.level, this.state, target, this.ride.phase !== 'idle');
    // Physical tracking always wins. Never correct the headset or translate the rig.
    this.world.object3D.visible = !this.outside;
    this.recovery.visible = this.outside && !this.expansion?.walker?.outside;
    if(this.outside) {
      const point = new THREE.Vector3(this.state.pos.x,.03,this.state.pos.y).applyMatrix4(this.world.object3D.matrix);
      this.recovery.position.copy(point);
    }
    this.panel.object3D.visible = !this.outside && this.level.pieces.find((p: any) => p.id === this.state.activeId)?.kind === 'elevator';
    if (this.outside) this.status(this.expansion?.walker?.outside ? 'Return inside your physical boundary' : 'Return to the amber ring', this.expansion ? 'Watch / visor → Recovery. Return inside your traced area; re-anchor at a clear spot or regenerate.' : 'You stepped through a virtual wall or tracking jumped. Walk back to the ring, or generate here.');
  },
  generate(newSeed: boolean,style?:string) {
    if(this.data.lab&&!this.xr){this.status('Enter VR to generate here','Save a boundary, then Watch → Generate level.');return;}
    if(style)this.style=style;
    if(this.expansion)this.style='growth';
    if(this.measuring()){this.status('Finish calibration first','Save and confirm, or Cancel before generating.');return;}
    this.cancelGeneration();
    if (newSeed) {const item=generationSettings[this.style].find(item=>item.id.endsWith(':seed'));item.value=(Number(item.value)+1)%1000000;if($('seed'))($('seed') as HTMLInputElement).value=String(item.value);}
    if (this.xr && !this.boundary) { this.status('Waiting for headset boundary', 'A real boundary is required to generate in VR.'); return; }
    if(this.xr&&this.source==='traced'&&!this.manualBoundary){this.status('Calibrate your usable area','Watch → Calibrate area. No headset rectangle is substituted for your trace.');return;}
    try {
      const w = this.xr?0:number('width',1,20), h = this.xr?0:number('depth',1,20);
      let points = this.xr ? this.source==='traced'?this.manualBoundary.points:this.boundary.points : previewBoundary(($('shape') as HTMLSelectElement).value,w,h);
      if(this.expansion)points=this.expansion.points(points);
      this.footprint = normalizeFootprint(points);
      const settings=generationValues(this.style),margin=settings.boundaryMargin,minWidth=settings.minWidth;
      const startAt = this.xr ? { x: this.boundary.position.x - this.footprint.origin.x, y: this.boundary.position.y - this.footprint.origin.y } : undefined;
      const params = { boundsW:this.footprint.width, boundsH:this.footprint.height, footprint:this.footprint.polygon, boundaryMargin:margin, startAt,
        stationaryElevators:true,walkingOnly:!!this.expansion,minWidth, mix:this.expansion?.mix()||DEFAULT_MIX, pieceCount:settings.pieceCount??settings.roomCount, minSizePct:settings.minSizePct??3,maxSizePct:settings.maxSizePct??15,branchChance:settings.branchChance??.3,seed:settings.seed,
        generationStyle:this.style,roomCount:settings.roomCount,roomsPerLayer:settings.roomsPerLayer,roomSize:settings.roomSize,connectionMode:settings.connectionMode };
      this.enterLabLevel();this.clearLevel(); this.generating = true;
      this.status('Generating rooms…', `${this.footprint.width.toFixed(1)} × ${this.footprint.height.toFixed(1)} m · ${points.length} boundary corners`);
      const worker = new Worker(new URL('./generate-worker.ts', import.meta.url), {type:'module'}); this.worker = worker;
      worker.onmessage = (event: any) => {
        if (this.worker !== worker) return;
        this.cancelGeneration();
        if (event.data.error) { this.status('No level fits yet', event.data.error + ' Try a wider boundary, a smaller door width, or stand farther inside.'); return; }
        this.level = this.expansion?this.expansion.prepare(event.data.level):event.data.level; this.state = createRuntime(this.level); this.view = new LevelView(this.level,{roomLabels:!this.expansion}); this.world.object3D.add(this.view.root);
        this.expansion?.start();
        this.ride = createRide(); this.outside = false;
        if (!this.xr) {
          this.world.object3D.matrixAutoUpdate = true; this.world.object3D.position.set(0,0,0); this.world.object3D.rotation.set(0,0,0);
          this.rig.object3D.position.set(this.state.pos.x,0,this.state.pos.y);
          this.camera.object3D.rotation.set(0,0,0);
          const d = this.level.doors.find((d: any) => d.a === this.state.activeId || d.b === this.state.activeId);
          const look = this.camera.components['look-controls'];
          if (look && d) { look.yawObject.rotation.y = Math.atan2(this.state.pos.x-(d.p1.x+d.p2.x)/2,this.state.pos.y-(d.p1.y+d.p2.y)/2); look.pitchObject.rotation.x = 0; }
          this.drawPreviewOutline();
        } else {
          // Undo only desktop preview offsets at XR entry, before any tracked frame is used.
          this.rig.object3D.position.set(0,0,0);
          this.onBoundaryFrame(this.boundary);
        }
        this.world.object3D.visible = !this.outside; this.view.show(this.state); this.updatePanel(); this.showRoomStatus();
        if(this.expansion)this.scene.querySelectorAll('[crossbar-menu]').forEach(el=>el.components['crossbar-menu']?.menu.close());
      };
      worker.onerror = () => { if (this.worker === worker) { this.cancelGeneration(); this.status('Generation failed', 'Reload and retry.'); } };
      worker.postMessage(params);
    } catch (error) { this.clearLevel(); this.status('Cannot generate', (error as Error).message); }
  },
  requestRide(direction=1,fromMenu=false) {
    if(this.level?.params.walkingOnly)return;
    if(this.expansion?.menuOpen()&&!fromMenu)return;
    if (!this.level || this.outside || (this.xr && !this.tracking)) return;
    const layers=this.level.roomsFirst?.layers,index=layers?.findIndex(l=>l.cabinId===this.state.activeId);
    const destination=layers?(layers[index+direction]?.cabinId||(direction===1?layers[index-1]?.cabinId:undefined)):undefined;
    if(layers&&!destination){this.status('No layer in that direction','Walk back into the room.');return;}
    if (beginRide(this.level,this.state,this.ride,destination)) this.status('Doors closing', 'Stay inside the cabin.');
    else if (this.ride.phase === 'idle') this.status('Step fully inside the elevator', this.expansion?'Pull the yellow handle down once you are clear of the doorway.':'Press RIDE once you are clear of the doorway.');
  },
  updatePanel() {
    if(this.expansion){this.panel.object3D.visible=false;return;}
    const p = this.level.pieces.find((p: any) => p.id === this.state.activeId);
    const visible = p.kind === 'elevator' && !this.outside && (!this.xr || this.tracking);
    this.panel.object3D.visible = visible;
    $('ride-button').classList.toggle('menu-target',visible && this.ride.phase === 'idle');
    const layers=this.level.roomsFirst?.layers,index=layers?.findIndex(l=>l.cabinId===p.id),back=!!layers&&index>0&&index<layers.length-1;
    $('ride-back-button').object3D.visible=visible&&back;$('ride-back-button').classList.toggle('menu-target',visible&&back&&this.ride.phase==='idle');
    $('ride-button').setAttribute('width',back ? .18 : .36);$('ride-button').setAttribute('position',back?'0.11 0 0':'0 0 0');
    $('ride-button').querySelector('a-text').setAttribute('value',layers?(index<layers.length-1?'NEXT':'RETURN'):'RIDE');
    this.panel.querySelector('.elevator-surface').classList.toggle('pm-surface',visible);
    if (!visible) return;
    const d = this.level.doors.find((d: any) => d.a === p.id || d.b === p.id);
    const out = d.a === p.id ? d.normal : { x:-d.normal.x,y:-d.normal.y }, c = centroid(p.parts[0]);
    const wall = { x:c.x-out.x*(this.level.params.minWidth/2-.025),y:c.y-out.y*(this.level.params.minWidth/2-.025) };
    this.panel.object3D.position.set(wall.x,1.15,wall.y);
    this.panel.object3D.rotation.set(0,Math.atan2(out.x,out.y),0);
    // Panel uses the same bounded-space transform as the rooms, not the player rig.
    this.panel.object3D.updateMatrix();
    if (this.xr) { this.panel.object3D.matrixAutoUpdate = false; this.panel.object3D.matrix.premultiply(this.world.object3D.matrix); this.panel.object3D.matrixWorldNeedsUpdate = true; }
    else this.panel.object3D.matrixAutoUpdate = true;
    $('ride-label').setAttribute('text','value',this.ride.phase === 'idle' ? 'Press to change rooms' : this.ride.phase.toUpperCase());
    // Hidden buttons must not intercept a cursor aimed at another room/watch.
  },
  showRoomStatus() {
    if (this.outside) return;
    if (this.ride.phase !== 'idle') {
      this.status(this.ride.phase === 'closed' ? 'Changing the world outside…' : this.ride.phase === 'closing' ? 'Doors closing' : 'Doors opening', 'Stay inside the cabin.'); return;
    }
    const p = this.level.pieces.find((p: any) => p.id === this.state.activeId);
    const warning = this.level.warning ? `\n${this.level.warning}` : '';
    const count=this.level.roomsFirst?`${this.level.roomsFirst.requestedRooms} rooms · ${this.level.roomsFirst.layers.length} layers`:`${this.level.pieces.length} pieces`;
    if(this.expansion){
      const guide=this.expansion.walker?.redirection.guidance;
      const edge=guide?.wallDistance!=null&&guide.wallDistance<this.expansion.steering.wallMargin;
      this.status(edge?'Physical boundary nearby — turn back':`${this.xr?'':'Geometry preview · '}${p.kind} ${p.id} · ${count}`,
        `Virtual ${this.footprint.width.toFixed(1)} × ${this.footprint.height.toFixed(1)} m · ${this.expansion.activeScale.toFixed(2)}x · seed ${this.level.params.seed}${warning}\nWatch / visor: Exit level, Experiments, Tools & help.`,!!edge);
      return;
    }
    this.status(`${this.xr ? '' : 'Preview · '}${p.kind} ${p.id} · ${count}`, `${this.footprint.width.toFixed(1)} × ${this.footprint.height.toFixed(1)} m · ${this.xr&&this.source==='traced'?'traced area':'reported / preview area'} · margin ${this.level.params.boundaryMargin.toFixed(2)} m · seed ${this.level.params.seed}${warning}${nearWall(this.level,this.state) ? '\nVirtual wall nearby — follow the doorway.' : ''}`);
  },
  drawPreviewOutline() {
    const positions = this.footprint.polygon.flatMap((p: any) => [p.x,.028,p.y]);
    this.previewOutline.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); this.previewOutline.geometry.computeBoundingSphere(); this.previewOutline.visible = this.outline;
  },
  drawMap() {
    const canvas = $('map') as HTMLCanvasElement, ctx = canvas.getContext('2d')!;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const scale = Math.min(420/this.footprint.width,360/this.footprint.height), ox = (480-this.footprint.width*scale)/2, oy=40;
    const path = (poly: any[]) => { ctx.beginPath(); poly.forEach((p,i) => i ? ctx.lineTo(ox+p.x*scale,oy+p.y*scale) : ctx.moveTo(ox+p.x*scale,oy+p.y*scale));ctx.closePath(); };
    ctx.font='22px sans-serif';ctx.fillStyle='#d9eeff';ctx.fillText(this.expansion?'Real / expanded floor':'Shared physical floor',20,26);
    ctx.lineWidth=2;ctx.strokeStyle='#22d3ee';path(this.footprint.polygon);ctx.stroke();
    if(this.expansion){ctx.strokeStyle='#ffad54';path(this.expansion.physical.map(p=>({x:p.x-this.footprint.origin.x,y:p.y-this.footprint.origin.y})));ctx.stroke();}
    for(const p of this.level.pieces) { ctx.globalAlpha=.14;ctx.strokeStyle=this.view.colors.get(p.id);for(const q of p.parts){path(q);ctx.stroke();} }
    for(const draw of renderWalls(this.level,this.state)) { ctx.globalAlpha=.5;ctx.fillStyle=this.view.colors.get(draw.pieceId);for(const q of draw.regions){path(q);ctx.fill();}ctx.globalAlpha=1;ctx.strokeStyle=this.view.colors.get(draw.pieceId);ctx.beginPath();for(const [a,b] of draw.walls){ctx.moveTo(ox+a.x*scale,oy+a.y*scale);ctx.lineTo(ox+b.x*scale,oy+b.y*scale);}ctx.stroke(); }
    ctx.globalAlpha=1;ctx.fillStyle='#ffe29a';ctx.beginPath();ctx.arc(ox+this.state.pos.x*scale,oy+this.state.pos.y*scale,5,0,Math.PI*2);ctx.fill();
  },
  tick(time: number, delta: number) {
    this.expansion?.observeFrame(delta);
    if(!this.data.lab||this.labMode)document.querySelectorAll('.calibration-status').forEach(el=>{el.object3D.visible=this.xr&&this.measuring();});
    if(this.measuring())return;
    if (!this.level) return;
    const dt = Math.min(delta/1000,.05);
    if (!this.xr && this.ride.phase === 'idle' && !this.expansion?.menuOpen()) {
      const x = Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft'));
      const z = Number(this.keys.has('s')||this.keys.has('arrowdown'))-Number(this.keys.has('w')||this.keys.has('arrowup'));
      if (x||z) {
        const yaw = this.camera.object3D.rotation.y, length=Math.hypot(x,z), amount=1.3*dt;
        const dx=(x*Math.cos(yaw)+z*Math.sin(yaw))/length*amount, dy=(-x*Math.sin(yaw)+z*Math.cos(yaw))/length*amount;
        const n=Math.max(1,Math.ceil(amount/.015));for(let i=0;i<n;i++)movePlayer(this.level,this.state,dx/n,dy/n);
      }
      this.rig.object3D.position.set(this.state.pos.x,0,this.state.pos.y);
    }
    if (!this.outside && (!this.xr||this.tracking) && !this.expansion?.menuOpen()) advanceRide(this.level,this.state,this.ride,dt);
    this.expansion?.tick();
    this.view.show(this.state);
    const cabin=this.level.pieces.find((p:any)=>p.id===this.state.activeId)?.kind==='elevator';
    this.view.setCabin(cabin?this.state.activeId:null,doorClosure(this.ride));this.updatePanel();
    if(this.xr&&this.panel.object3D.visible&&this.ride.phase==='idle'&&!this.expansion?.menuOpen()) {
      $('ride-button').object3D.getWorldPosition(this.buttonPoint);
      for(const id of ['left-hand','right-hand']) {
        const fingertip=$(id).components['hand-with-watch']?.fingertipEl;
        if(!fingertip)continue;
        fingertip.object3D.getWorldPosition(this.fingerPoint);
        const inside=this.buttonPoint.distanceTo(this.fingerPoint)<.09;
        if(inside&&!this.touching.has(id))this.requestRide();
        if(inside)this.touching.add(id);else this.touching.delete(id);
      }
      if($('ride-back-button').object3D.visible){$('ride-back-button').object3D.getWorldPosition(this.buttonPoint);for(const id of ['left-hand','right-hand']){const finger=$(id).components['hand-with-watch']?.fingertipEl;if(!finger)continue;finger.object3D.getWorldPosition(this.fingerPoint);const inside=this.buttonPoint.distanceTo(this.fingerPoint)<.075,key=id+'-back';if(inside&&!this.touching.has(key))this.requestRide(-1);if(inside)this.touching.add(key);else this.touching.delete(key);}}
    }
    if(time-(this.lastStatus||0)>250){this.lastStatus=time;if(!this.xr||this.tracking)this.showRoomStatus();if(!this.xr)this.drawMap();}
  },
  remove() {
    this.cancelGeneration(); this.clearLevel();this.restoreLab();
    for(const [target,event,callback] of this.handlers)target.removeEventListener(event,callback);
    this.previewOutline.removeFromParent(); this.previewOutline.geometry.dispose();this.previewOutline.material.dispose();
    this.recovery.removeFromParent();this.recovery.geometry.dispose();this.recovery.material.dispose();
  },
});
