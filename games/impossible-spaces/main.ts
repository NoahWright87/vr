import { DEFAULT_MIX } from './core/templates.ts';
import { createRuntime, movePlayer, renderWalls } from './core/runtime.ts';
import { centroid } from './core/geometry.ts';
import { normalizeFootprint } from './core/footprint.ts';
import { createRide, beginRide, advanceRide, doorClosure, followPhysicalPose, nearWall } from './core/vr-runtime.ts';
import { LevelView } from './render.ts';

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
  init() {
    this.xr = false; this.level = null; this.state = null; this.view = null; this.worker = null;
    this.boundary = null; this.revision = null; this.ride = createRide(); this.keys = new Set(); this.outline = true;
    this.tracking = false; this.outside = false; this.message = ''; this.detail = ''; this.generating = false;
    this.scene = this.el.sceneEl; this.camera = $('camera'); this.world = $('world'); this.panel = $('elevator-panel');
    this.transform = new THREE.Matrix4(); this.originTransform = new THREE.Matrix4(); this.buttonPoint = new THREE.Vector3(); this.fingerPoint = new THREE.Vector3();
    this.previewOutline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#22d3ee', depthTest: false }));
    this.scene.object3D.add(this.previewOutline);
    this.recovery = new THREE.Mesh(new THREE.RingGeometry(.15,.2,32),new THREE.MeshBasicMaterial({color:'#ffe29a',side:THREE.DoubleSide,depthTest:false}));
    this.recovery.rotation.x = -Math.PI/2;this.recovery.visible=false;this.scene.object3D.add(this.recovery);
    this.handlers = [];
    this.listen = (target: any, event: string, callback: any) => { target.addEventListener(event, callback); this.handlers.push([target,event,callback]); };
    this.listen(this.scene, 'enter-vr', () => {
      this.xr = true; this.keys.clear(); this.boundary = null; this.revision = null; this.tracking = false;
      this.cancelGeneration(); this.clearLevel(); this.previewOutline.visible = false;
      $('player').object3D.position.set(0,0,0);
      const look = this.camera.components['look-controls'];
      if (look) { look.yawObject.rotation.y = 0; look.pitchObject.rotation.x = 0; }
      document.body.classList.add('xr-active'); this.status('Reading headset boundary…', 'Walk with your feet. No joystick movement.');
    });
    this.listen(this.scene, 'exit-vr', () => {
      this.xr = false; document.body.classList.remove('xr-active'); this.cancelGeneration(); this.generate(false);
    });
    this.listen(this.scene, 'headset-boundary-frame', (event: any) => this.onBoundaryFrame(event.detail));
    this.listen(this.scene, 'headset-boundary-reset', () => {
      this.cancelGeneration(); this.clearLevel(); this.revision = null; this.tracking = false;
      this.status('Boundary changed — rebuilding', 'The new level will start where you are standing.');
    });
    this.listen(this.scene, 'headset-boundary-tracking-lost', () => { if (this.xr) { this.tracking = false; this.world.object3D.visible = false; this.panel.object3D.visible = false; this.status('Tracking paused', 'Wait for headset tracking to return.'); } });
    this.listen(this.scene, 'headset-boundary-unavailable', () => { if (this.xr) this.status('Boundary unavailable', 'This browser must provide bounded-floor data. No guessed VR footprint.'); });
    this.listen(this.scene, 'menu-item-select', (event: any) => {
      if (event.detail.value === 'ride') this.requestRide();
      if (event.detail.value === 'regenerate') this.generate(true);
      if (event.detail.value === 'outline') this.toggleOutline();
      if (event.detail.value === 'margin') this.cycleSetting('margin', [.1,.25,.4]);
      if (event.detail.value === 'width') this.cycleSetting('door-width', [.8,1,1.2]);
    });
    this.listen(this.scene, 'watch-menu-ready', () => this.renderStatus());
    this.listen($('generate'), 'click', () => this.generate(true));
    this.listen($('boundary-toggle'), 'click', () => this.toggleOutline());
    for (const id of ['shape','width','depth','door-width','margin','pieces','seed']) this.listen($(id), 'change', () => this.generate(false));
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
    this.generate(false);
  },
  cycleSetting(id: string, values: number[]) {
    const input = $(id) as HTMLInputElement;
    input.value = String(values[(values.indexOf(Number(input.value)) + 1) % values.length]);
    this.generate(false);
  },
  cancelGeneration() { this.worker?.terminate(); this.worker = null; this.generating = false; },
  clearLevel() {
    this.view?.dispose(); this.view = null; this.level = null; this.state = null; this.ride = createRide();
    this.panel.object3D.visible = false; this.world.object3D.visible = false;
    this.recovery.visible = false;
    $('ride-button').classList.remove('menu-target');
    this.panel.querySelector('.elevator-surface').classList.remove('pm-surface');
  },
  status(message: string, detail = '') {
    if (this.message === message && this.detail === detail) return;
    this.message = message; this.detail = detail; this.renderStatus();
  },
  renderStatus() {
    $('status').textContent = this.message + (this.detail ? ' · ' + this.detail.replaceAll('\n',' ') : '');
    $('head-status').setAttribute('text', 'value', this.message);
    const text = $('head-status').getObject3D('text');
    if (text) { text.material.depthTest = false; text.material.depthWrite = false; text.renderOrder = 100; }
    document.querySelectorAll('.game-status').forEach(el => el.setAttribute('text','value',this.message));
    document.querySelectorAll('.game-detail').forEach(el => el.setAttribute('text','value',this.detail));
  },
  toggleOutline() {
    this.outline = !this.outline;
    const reader = $('boundary-reader').components['headset-boundary'];
    reader.showOutline = this.outline;
    reader.outline.visible = reader.corners.visible = this.xr && this.outline && this.tracking;
    this.previewOutline.visible = !this.xr && this.outline;
    $('boundary-toggle').textContent = this.outline ? 'Hide outline' : 'Show outline';
  },
  onBoundaryFrame(frame: any) {
    if (!this.xr) return;
    this.tracking = true; this.boundary = frame;
    if (this.revision !== frame.revision) {
      this.revision = frame.revision; this.generate(false);
    }
    if (!this.level) return;
    this.transform.fromArray(frame.matrix);
    this.originTransform.makeTranslation(this.footprint.origin.x, 0, this.footprint.origin.y);
    this.world.object3D.matrixAutoUpdate = false;
    this.world.object3D.matrix.copy(this.transform).multiply(this.originTransform);
    this.world.object3D.matrixWorldNeedsUpdate = true;
    const target = { x: frame.position.x - this.footprint.origin.x, y: frame.position.y - this.footprint.origin.y };
    this.outside = !followPhysicalPose(this.level, this.state, target, this.ride.phase !== 'idle');
    // Physical tracking always wins. Never correct the headset or translate the rig.
    this.world.object3D.visible = !this.outside;
    this.recovery.visible = this.outside;
    if(this.outside) {
      const point = new THREE.Vector3(this.state.pos.x + this.footprint.origin.x,.03,this.state.pos.y + this.footprint.origin.y).applyMatrix4(this.transform);
      this.recovery.position.copy(point);
    }
    this.panel.object3D.visible = !this.outside && this.level.pieces.find((p: any) => p.id === this.state.activeId)?.kind === 'elevator';
    if (this.outside) this.status('Return to the amber ring', 'You stepped through a virtual wall or tracking jumped. Walk back to the ring, or generate here.');
  },
  generate(newSeed: boolean) {
    this.cancelGeneration();
    if (newSeed) ($('seed') as HTMLInputElement).value = String((Number(($('seed') as HTMLInputElement).value) + 1) % 1000000);
    if (this.xr && !this.boundary) { this.status('Waiting for headset boundary', 'A real boundary is required to generate in VR.'); return; }
    try {
      const w = number('width',1,20), h = number('depth',1,20);
      const points = this.xr ? this.boundary.points : previewBoundary(($('shape') as HTMLSelectElement).value,w,h);
      this.footprint = normalizeFootprint(points);
      const margin = number('margin',.1,.6), minWidth = number('door-width',.8,2);
      const startAt = this.xr ? { x: this.boundary.position.x - this.footprint.origin.x, y: this.boundary.position.y - this.footprint.origin.y } : undefined;
      const params = { boundsW:this.footprint.width, boundsH:this.footprint.height, footprint:this.footprint.polygon, boundaryMargin:margin, startAt,
        stationaryElevators:true, minWidth, mix:DEFAULT_MIX, pieceCount:Math.round(number('pieces',2,24)), minSizePct:3,maxSizePct:15,branchChance:.3,seed:Math.round(number('seed',0,999999)) };
      this.clearLevel(); this.generating = true;
      this.status('Generating rooms…', `${this.footprint.width.toFixed(1)} × ${this.footprint.height.toFixed(1)} m · ${points.length} boundary corners`);
      const worker = new Worker(new URL('./generate-worker.ts', import.meta.url), {type:'module'}); this.worker = worker;
      worker.onmessage = (event: any) => {
        if (this.worker !== worker) return;
        this.cancelGeneration();
        if (event.data.error) { this.status('No level fits yet', event.data.error + ' Try a wider boundary, a smaller door width, or stand farther inside.'); return; }
        this.level = event.data.level; this.state = createRuntime(this.level); this.view = new LevelView(this.level); this.world.object3D.add(this.view.root);
        this.ride = createRide(); this.outside = false;
        if (!this.xr) {
          this.world.object3D.matrixAutoUpdate = true; this.world.object3D.position.set(0,0,0); this.world.object3D.rotation.set(0,0,0);
          $('player').object3D.position.set(this.state.pos.x,0,this.state.pos.y);
          this.camera.object3D.rotation.set(0,0,0);
          const d = this.level.doors.find((d: any) => d.a === this.state.activeId || d.b === this.state.activeId);
          const look = this.camera.components['look-controls'];
          if (look && d) { look.yawObject.rotation.y = Math.atan2(this.state.pos.x-(d.p1.x+d.p2.x)/2,this.state.pos.y-(d.p1.y+d.p2.y)/2); look.pitchObject.rotation.x = 0; }
          this.drawPreviewOutline();
        } else {
          // Undo only desktop preview offsets at XR entry, before any tracked frame is used.
          $('player').object3D.position.set(0,0,0);
          this.onBoundaryFrame(this.boundary);
        }
        this.world.object3D.visible = !this.outside; this.view.show(this.state); this.updatePanel(); this.showRoomStatus();
      };
      worker.onerror = () => { if (this.worker === worker) { this.cancelGeneration(); this.status('Generation failed', 'Reload and retry.'); } };
      worker.postMessage(params);
    } catch (error) { this.clearLevel(); this.status('Cannot generate', (error as Error).message); }
  },
  requestRide() {
    if (!this.level || this.outside || (this.xr && !this.tracking)) return;
    if (beginRide(this.level,this.state,this.ride)) this.status('Doors closing', 'Stay inside the cabin.');
    else if (this.ride.phase === 'idle') this.status('Step fully inside the elevator', 'Press RIDE once you are clear of the doorway.');
  },
  updatePanel() {
    const p = this.level.pieces.find((p: any) => p.id === this.state.activeId);
    const visible = p.kind === 'elevator' && !this.outside && (!this.xr || this.tracking);
    this.panel.object3D.visible = visible;
    $('ride-button').classList.toggle('menu-target',visible && this.ride.phase === 'idle');
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
    this.status(`${this.xr ? '' : 'Preview · '}${p.kind} ${p.id} · ${this.level.pieces.length} pieces`, `${this.footprint.width.toFixed(1)} × ${this.footprint.height.toFixed(1)} m · margin ${this.level.params.boundaryMargin.toFixed(2)} m · seed ${this.level.params.seed}${warning}${nearWall(this.level,this.state) ? '\nVirtual wall nearby — follow the doorway.' : ''}`);
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
    ctx.font='22px sans-serif';ctx.fillStyle='#d9eeff';ctx.fillText('Shared physical floor',20,26);
    ctx.lineWidth=2;ctx.strokeStyle='#22d3ee';path(this.footprint.polygon);ctx.stroke();
    for(const p of this.level.pieces) { ctx.globalAlpha=.14;ctx.strokeStyle=this.view.colors.get(p.id);for(const q of p.parts){path(q);ctx.stroke();} }
    for(const draw of renderWalls(this.level,this.state)) { ctx.globalAlpha=.5;ctx.fillStyle=this.view.colors.get(draw.pieceId);for(const q of draw.regions){path(q);ctx.fill();}ctx.globalAlpha=1;ctx.strokeStyle=this.view.colors.get(draw.pieceId);ctx.beginPath();for(const [a,b] of draw.walls){ctx.moveTo(ox+a.x*scale,oy+a.y*scale);ctx.lineTo(ox+b.x*scale,oy+b.y*scale);}ctx.stroke(); }
    ctx.globalAlpha=1;ctx.fillStyle='#ffe29a';ctx.beginPath();ctx.arc(ox+this.state.pos.x*scale,oy+this.state.pos.y*scale,5,0,Math.PI*2);ctx.fill();
  },
  tick(time: number, delta: number) {
    if (!this.level) return;
    const dt = Math.min(delta/1000,.05);
    if (!this.xr && this.ride.phase === 'idle') {
      const x = Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft'));
      const z = Number(this.keys.has('s')||this.keys.has('arrowdown'))-Number(this.keys.has('w')||this.keys.has('arrowup'));
      if (x||z) {
        const yaw = this.camera.object3D.rotation.y, length=Math.hypot(x,z), amount=1.3*dt;
        const dx=(x*Math.cos(yaw)+z*Math.sin(yaw))/length*amount, dy=(-x*Math.sin(yaw)+z*Math.cos(yaw))/length*amount;
        const n=Math.max(1,Math.ceil(amount/.015));for(let i=0;i<n;i++)movePlayer(this.level,this.state,dx/n,dy/n);
      }
      $('player').object3D.position.set(this.state.pos.x,0,this.state.pos.y);
    }
    if (!this.outside && (!this.xr||this.tracking)) advanceRide(this.level,this.state,this.ride,dt);
    this.view.show(this.state);
    const cabin=this.level.pieces.find((p:any)=>p.id===this.state.activeId)?.kind==='elevator';
    this.view.setCabin(cabin?this.state.activeId:null,doorClosure(this.ride));this.updatePanel();
    if(this.xr&&this.panel.object3D.visible&&this.ride.phase==='idle') {
      $('ride-button').object3D.getWorldPosition(this.buttonPoint);
      for(const id of ['left-hand','right-hand']) {
        const fingertip=$(id).components['hand-with-watch']?.fingertipEl;
        if(!fingertip)continue;
        fingertip.object3D.getWorldPosition(this.fingerPoint);
        const inside=this.buttonPoint.distanceTo(this.fingerPoint)<.09;
        if(inside&&!this.touching.has(id))this.requestRide();
        if(inside)this.touching.add(id);else this.touching.delete(id);
      }
    }
    if(time-(this.lastStatus||0)>250){this.lastStatus=time;if(!this.xr||this.tracking)this.showRoomStatus();if(!this.xr)this.drawMap();}
  },
  remove() {
    this.cancelGeneration(); this.clearLevel();
    for(const [target,event,callback] of this.handlers)target.removeEventListener(event,callback);
    this.previewOutline.removeFromParent(); this.previewOutline.geometry.dispose();this.previewOutline.material.dispose();
    this.recovery.removeFromParent();this.recovery.geometry.dispose();this.recovery.material.dispose();
  },
});
