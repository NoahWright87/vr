import { ExpandedWalker, expandBoundary } from './walking.ts';
import { decorateLevel,fitElevatorExit,connectedWing } from './architecture.ts';
import { BuildingControls } from './building-controls.ts';
import { LevelView } from '../impossible-spaces/render.ts';
import { DEFAULT_MIX } from '../impossible-spaces/core/templates.ts';
import { containsPoint } from '../../common/floor-overlap.js';

const THREE = AFRAME.THREE;
export class ExpandedSession {
  game: any;
  scale = 1.25;
  activeScale = 1.25;
  paused = false;
  roomTypes = 'mixed';
  experiments = { routes:true,translation:true,adaptiveGain:false,steering:true,turns:true,adaptiveRooms:false,growOnRide:false,blockers:false,attention:false,switches:false,floorCues:'normal' };
  controls: BuildingControls | null = null;
  fittedRide = '';
  growthWorker:Worker|null=null;growthResult:any=null;growthStarted=0;growthCount=0;
  seen=new Set<string>();grown=new Set<string>();
  walker: ExpandedWalker | null = null;
  physical: any[] = [];
  gain = { maxGain: 1.2, speedForMax: 2 };
  steering = { steeringEnabled: true, turnEnabled: true, maxCurvature: 5, steeringSpeed: 2,
    maxSteeringRate: 6, lookAhead: 1.5, wallMargin: .4, minTurnGain: .9,
    maxTurnGain: 200 / 180, turnSpeed: 180, alignmentStrength: 1 };
  inverse = new THREE.Matrix4();
  direction = new THREE.Vector3();
  rotation = new THREE.Matrix4();
  quaternion = new THREE.Quaternion();
  constructor(game: any) { this.game = game; }
  menuOpen() {
    return [...this.game.scene.querySelectorAll('[crossbar-menu]')].some((el: any) => el.components['crossbar-menu']?.menu.isOpen);
  }
  points(points: any[]) {
    if(this.game.xr && !containsPoint({ x:this.game.boundary.position.x,z:this.game.boundary.position.y },points.map(p=>({x:p.x,z:p.y})))) {
      throw new Error('Step inside your physical boundary before generating.');
    }
    this.physical = points.map(p => ({ ...p }));
    this.activeScale = this.scale;
    return expandBoundary(points, this.activeScale);
  }
  start() {
    const g = this.game, o = g.footprint.origin;
    this.walker = new ExpandedWalker(g.level, this.physical.map(p => ({ x: p.x - o.x, y: p.y - o.y })));
    this.sync();
    this.controls?.dispose();this.controls=new BuildingControls(g);
  }
  prepare(level:any){return decorateLevel(level,this.experiments);}
  mix(){return Object.fromEntries(Object.entries(DEFAULT_MIX).map(([key,value])=>[key,this.roomTypes==='simple'&&key.startsWith('room-')&&key!=='room-rect'?0:this.roomTypes==='bendy'&&key==='room-rect'?0:value]));}
  sync() {
    if(this.walker){this.walker.experiments=this.experiments;this.walker.gain.setSettings(this.gain);this.walker.redirection.setSettings({...this.steering,steeringEnabled:this.experiments.steering,turnEnabled:this.experiments.turns});}
    const g=this.game;if(g.level?.decoration&&g.level.decoration.floorCues!==this.experiments.floorCues){g.level.decoration.floorCues=this.experiments.floorCues;this.refreshView();}
  }
  refreshView(){const g=this.game;g.view?.dispose();g.view=new LevelView(g.level);g.world.object3D.add(g.view.root);g.view.show(g.state);}
  clear(){this.growthWorker?.terminate();this.growthWorker=null;this.growthResult=null;this.seen.clear();this.grown.clear();this.growthCount=0;this.controls?.dispose();this.controls=null;this.walker=null;this.fittedRide='';}
  replaceLevel(level:any){
    const g=this.game,old=this.walker!;g.level=level;
    this.walker=new ExpandedWalker(level,old.boundary.map(p=>({x:p.x,y:p.z})));
    Object.assign(this.walker.transform,old.transform);this.walker.stats=old.stats;
    for(const p of level.pieces)if(p.kind==='elevator'&&!g.state.elevators[p.id])g.state.elevators[p.id]={armed:true,charge:0};
    this.sync();this.refreshView();
  }
  startGrowth(){
    const g=this.game,from=g.ride.from,to=g.ride.to;
    this.grown.add(to);this.growthStarted=performance.now();
    const worker=this.growthWorker=new Worker(new URL('./grow-worker.ts',import.meta.url),{type:'module'});
    const finish=data=>{if(this.growthWorker!==worker)return;worker.terminate();this.growthWorker=null;this.growthResult=data;};
    worker.onmessage=e=>finish(e.data);worker.onerror=()=>finish({error:'Could not build this wing. Keeping the original rooms.'});
    worker.postMessage({level:g.level,from,to,seed:g.level.params.seed+(++this.growthCount)*1009,options:this.experiments});
  }
  tick(){
    const g=this.game;if(!g.level||!this.walker)return;
    if(g.ride.phase==='idle')for(const id of g.level.visible[g.state.activeId]||[])this.seen.add(id);
    if(g.ride.phase!=='closed'){this.growthWorker?.terminate();this.growthWorker=null;this.growthResult=null;}
    if(this.menuOpen()||g.outside||g.xr&&!g.tracking)return;
    if(g.ride.phase==='closed'&&this.fittedRide!==g.ride.from+'>'+g.ride.to){
      this.fittedRide=g.ride.from+'>'+g.ride.to;
      if(this.experiments.growOnRide&&!this.grown.has(g.ride.to)&&g.level.pieces.length<240&&![...connectedWing(g.level,g.ride.to,g.ride.from)].some(id=>this.seen.has(id))){this.startGrowth();}
      const level=fitElevatorExit(g.level,g.ride.from,g.ride.to,this.walker.boundary.map(p=>({x:p.x,y:p.z})),this.walker.transform,this.experiments.adaptiveRooms);
      if(!this.growthWorker&&level!==g.level)this.replaceLevel(level);
    }
    if(this.growthWorker){g.ride.elapsed=0;if(performance.now()-this.growthStarted>8000){this.growthWorker.terminate();this.growthWorker=null;this.growthResult={error:'Building took too long. Keeping the original rooms.'};}}
    if(this.growthResult&&g.ride.phase==='closed'){
      const result=this.growthResult;this.growthResult=null;
      if(result.level){const level=fitElevatorExit(result.level,g.ride.from,g.ride.to,this.walker.boundary.map(p=>({x:p.x,y:p.z})),this.walker.transform,this.experiments.adaptiveRooms);this.replaceLevel(level);}
      else {const level=fitElevatorExit(g.level,g.ride.from,g.ride.to,this.walker.boundary.map(p=>({x:p.x,y:p.z})),this.walker.transform,this.experiments.adaptiveRooms);if(level!==g.level)this.replaceLevel(level);g.status('Using the original rooms',result.error);}
    }
    // Arrival is an explicit door event. Room entry never changes a door.
    if(g.ride.phase==='opening'&&g.ride.switched)g.level.closedDoors=g.level.closedDoors.filter(id=>!g.level.doors.some(d=>d.id===id&&(d.a===g.ride.to||d.b===g.ride.to)));
    if(g.ride.phase==='idle')this.fittedRide='';
    this.controls?.update();
  }
  applyFrame(frame: any, target: any) {
    const g = this.game, w = this.walker!;
    if(frame.orientation) {
      const q=frame.orientation;
      this.quaternion.set(q.x,q.y,q.z,q.w);
      this.direction.set(0,0,-1).applyQuaternion(this.quaternion);
    } else {
      // Fallback for desktop/synthetic boundary frames; XR supplies orientation
      // in the same bounded-floor space as position, independent of tick order.
      g.camera.object3D.getWorldDirection(this.direction);
      this.direction.negate().transformDirection(this.inverse.copy(g.transform).invert());
    }
    const yaw = Math.atan2(-this.direction.x, -this.direction.z);
    const result = w.sample(target, yaw, performance.now(), g.state, this.paused || this.menuOpen(), g.ride.phase !== 'idle');
    // Keep headset, hands, menus and physical boundary in tracked coordinates.
    // Move the virtual world by the inverse locomotion mapping instead.
    this.rotation.makeRotationY(w.transform.yaw);
    this.rotation.setPosition(w.transform.x, 0, w.transform.z);
    g.world.object3D.matrix.multiply(this.rotation.invert());
    g.world.object3D.matrixWorldNeedsUpdate = true;
    return result.valid && !result.outside;
  }
  recover() {
    const g = this.game;
    if (!g.xr || !g.tracking || !this.walker || !g.boundary || g.measuring() || g.ride.phase !== 'idle') {
      g.status('Recovery unavailable', 'Finish calibration or the elevator ride, and wait for tracking.'); return;
    }
    const o = g.footprint.origin, raw = { x: g.boundary.position.x - o.x, y: g.boundary.position.y - o.y };
    if (!this.walker.reanchor(raw, g.state)) { g.status('Step inside your physical boundary', 'Return to a clear spot in your traced area before re-anchoring.'); return; }
    g.onBoundaryFrame(g.boundary); g.showRoomStatus();
  }
  describe() {
    const w = this.walker;
    if (!w) return `Next world: ${this.scale.toFixed(2)}x width/depth. Save a boundary, then Generate.`;
    const s = w.stats, guide = w.redirection.guidance;
    return [this.game.xr ? 'Tracked walking' : 'Desktop: geometry preview only',
      `World ${this.activeScale.toFixed(2)}x / next ${this.scale.toFixed(2)}x`,
      `Physical ${s.physicalMetres.toFixed(1)} m / virtual ${s.virtualMetres.toFixed(1)} m`,
      `Gain ${(this.experiments.translation?(this.experiments.adaptiveGain?w.adaptive:w.gain.gain):1).toFixed(2)}x / turn ${w.redirection.turnGain.toFixed(2)}x`,
      `Steering ${w.redirection.steeringRate.toFixed(1)} deg/s`,
      `Floor overlap ${guide?.overlap == null ? '—' : Math.round(guide.overlap * 100) + '%'}`,
      `Boundary exits ${s.boundaryExits} / wall blocks ${s.wallBlocks}`,
      `Rejected gain ${s.rejectedGain} / recoveries ${s.recoveries}`,
      `Next door ${(w.redirection.planner as any).routeInfo?.door||'—'} / runway ${(w.redirection.planner as any).routeInfo?.clearance?.toFixed(2)??'—'} m`,
      this.paused ? 'Movement effects paused' : 'Effects pause while a menu is open'].join('\n');
  }
  exportReport() {
    const g = this.game;
    const report = { version: 1, activity: 'expanding-rooms', physicalBoundary: this.physical,
      activeScale: this.activeScale, nextScale: this.scale, gain: this.gain, steering: this.steering, experiments:this.experiments,
      level: g.level, state: g.state, stats: this.walker?.stats, mapping: this.walker?.transform };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `expanding-rooms-${g.level?.params.seed ?? 'setup'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    g.status('Debug report downloaded', 'Boundary, seed, generated level, settings and counters.');
  }
}
