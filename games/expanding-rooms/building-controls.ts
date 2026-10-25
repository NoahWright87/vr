import '../../common/interaction-hints.js';
import { centroid,wallSegments,distPointSeg,insideConvex } from '../impossible-spaces/core/geometry.ts';
import { clearance } from '../impossible-spaces/core/footprint.ts';
const T=AFRAME.THREE;
const game=()=>document.querySelector('[impossible-game]')?.components['impossible-game'];

AFRAME.registerComponent('lift-pull',{
  init(){
    this.point=new T.Vector3();this.origin=new T.Vector3();this.pulled=false;
    this.start=()=>{this.el.object3D.getWorldPosition(this.origin);this.pulled=false;};
    this.end=()=>this.el.components['simple-grabbable']?.resetToSpawn();
    this.el.addEventListener('simple-grabbed',this.start);this.el.addEventListener('simple-released',this.end);
  },
  tick(){const grab=this.el.components['simple-grabbable'];if(grab?.state!=='held')return;
    const g=game();if(!g?.level||g.expansion.menuOpen()||g.outside||g.measuring()){grab.resetToSpawn();return;}
    this.el.object3D.getWorldPosition(this.point);
    if(this.origin.y-this.point.y>=.12&&!this.pulled){this.pulled=true;g.requestRide();grab.resetToSpawn();}
    else if(this.point.distanceTo(this.origin)>.45)grab.resetToSpawn();
  },
  remove(){this.el.removeEventListener('simple-grabbed',this.start);this.el.removeEventListener('simple-released',this.end);}
});
function label(parent,text,x,y,z,width=.8){const el=document.createElement('a-text');el.setAttribute('value',text);el.setAttribute('align','center');el.setAttribute('width',width);el.setAttribute('position',`${x} ${y} ${z}`);el.setAttribute('color','#e7f8ff');parent.appendChild(el);return el;}
export class BuildingControls {
  root:any;active='';buttons:any[]=[];handles:any[]=[];
  constructor(public game:any){this.root=document.createElement('a-entity');this.root.id='building-controls';game.world.appendChild(this.root);}
  clear(){for(const h of this.handles){const grab=h.components['simple-grabbable'];if(grab?.spawnParent)grab.resetToSpawn();}this.root.replaceChildren();this.buttons=[];this.handles=[];}
  button(text:string,position:any,onPress:()=>void){
    const el=document.createElement('a-entity');el.setAttribute('position',`${position.x} 1.05 ${position.y}`);
    const ball=document.createElement('a-sphere');ball.classList.add('menu-target');ball.setAttribute('radius','.09');ball.setAttribute('color','#41c7b7');el.appendChild(ball);
    const caption=label(el,text,0,.2,0,.75);
    ball.addEventListener('click',()=>{const g=this.game;if(g.expansion.menuOpen()||g.measuring()||g.outside)return;
      const p=new T.Vector3(),head=new T.Vector3();el.object3D.getWorldPosition(p);g.camera.object3D.getWorldPosition(head);
      if(p.distanceTo(head)>1.25){g.status('Walk to the switch','Point and press, or touch the glowing button.');return;}onPress();});
    this.root.appendChild(el);this.buttons.push({el,ball,caption,touched:new Set()});return el;
  }
  spot(piece:any,door:any){
    const g=this.game,mid={x:(door.p1.x+door.p2.x)/2,y:(door.p1.y+door.p2.y)/2};
    const candidates=[{...g.state.pos},...piece.parts.flatMap(poly=>{const c=centroid(poly);return [c,...poly.map(v=>({x:c.x*.7+v.x*.3,y:c.y*.7+v.y*.3}))];})];
    const walls=wallSegments(piece,g.level.doors);
    const boundary=g.expansion.walker.boundary.map(p=>({x:p.x,y:p.z}));
    return candidates.filter(p=>{const raw=g.expansion.walker.transform.physicalPoint({x:p.x,z:p.y});return clearance({x:raw.x,y:raw.z},boundary)>.2;}).filter(p=>walls.every(([a,b])=>distPointSeg(p,a,b)>.23)&&!(piece.blockers||[]).some(poly=>insideConvex(p,poly)||poly.some((a,i)=>distPointSeg(p,a,poly[(i+1)%poly.length])<.3))).sort((a,b)=>Math.hypot(b.x-mid.x,b.y-mid.y)-Math.hypot(a.x-mid.x,a.y-mid.y))[0];
  }
  rebuild(){
    this.clear();const g=this.game,lv=g.level,id=g.state.activeId;this.active=id;
    const visible=new Set(lv.visible[id]||[id]);
    for(const p of lv.pieces.filter(p=>p.kind==='elevator'&&visible.has(p.id))){
      const c=centroid(p.parts[0]),holder=document.createElement('a-entity');holder.setAttribute('position',`${c.x} 0 ${c.y}`);this.root.appendChild(holder);
      const cable=document.createElement('a-cylinder');cable.setAttribute('radius','.012');cable.setAttribute('height','.9');cable.setAttribute('position','0 2.05 0');cable.setAttribute('color','#c6d4e5');holder.appendChild(cable);
      const handle=document.createElement('a-entity');handle.setAttribute('position','0 1.55 0');holder.appendChild(handle);handle.setAttribute('simple-grabbable','preserveGrabTransform: true');
      handle.setAttribute('hint-zone','action: grab; radius: 0.15; maxReach: 0.4; desktopKey: g; desktopLabel: Grab and pull down; xrLabel: Grab and pull down');handle.setAttribute('lift-pull','');
      const ring=document.createElement('a-torus');ring.setAttribute('radius','.09');ring.setAttribute('radius-tubular','.018');ring.setAttribute('color','#ffd56b');handle.appendChild(ring);this.handles.push(handle);
      label(holder,'LIFT\nPULL DOWN',0,1.25,0,.65);
    }
    const piece=lv.pieces.find(p=>p.id===id),doors=lv.doors.filter(d=>d.a===id||d.b===id);
    const bays=doors.filter(d=>lv.pieces.find(p=>p.id===(d.a===id?d.b:d.a))?.kind==='elevator');
    for(const d of bays){const sign=label(this.root,'LIFT',(d.p1.x+d.p2.x)/2,2,(d.p1.y+d.p2.y)/2,.6);const head=new T.Vector3();g.camera.object3D.getWorldPosition(head);sign.object3D.lookAt(head.x,2,head.z);}
    if(bays.length){const spot=this.spot(piece,bays[0]);if(spot)this.button('CALL LIFT',spot,()=>{
      const score=d=>{const mid={x:(d.p1.x+d.p2.x)/2,z:(d.p1.y+d.p2.y)/2},raw=g.expansion.walker.transform.physicalPoint(mid);return clearance({x:raw.x,y:raw.z},g.expansion.walker.boundary.map(p=>({x:p.x,y:p.z})));};
      const chosen=[...bays].sort((a,b)=>score(b)-score(a))[0];
      // Do not close a bay someone is already standing beside.
      for(const d of bays)if(d!==chosen&&distPointSeg(g.state.pos,d.p1,d.p2)>.35&&!lv.closedDoors.includes(d.id))lv.closedDoors.push(d.id);
      lv.closedDoors=lv.closedDoors.filter(x=>x!==chosen.id);g.status('Your lift is here','The lift doorway is open. Step inside and pull the yellow handle down.');
    });else lv.closedDoors=lv.closedDoors.filter(x=>x!==bays[0].id);}
    const switched=doors.filter(d=>lv.closedDoors.includes(d.id)&&!bays.includes(d)&&piece.kind!=='elevator');
    if(switched.length){
      const open=()=>{lv.closedDoors=lv.closedDoors.filter(x=>!switched.some(d=>d.id===x));g.status('Doors open','Walk through when you are ready.');};
      const spot=this.spot(piece,switched[0]);if(spot)this.button('OPEN DOORS',spot,open);else open();
    }

    if(piece.kind==='elevator')for(const d of doors)lv.closedDoors=lv.closedDoors.filter(x=>x!==d.id);
  }
  update(){
    const g=this.game;if(!g.level)return;if(this.active!==g.state.activeId)this.rebuild();
    // Handles belong to their cabin only; they remain visible from an open doorway.
    for(const h of this.handles)h.setAttribute('hint-zone','enabled',g.level.pieces.find(p=>p.id===g.state.activeId)?.kind==='elevator'&&!g.expansion.menuOpen()&&g.ride.phase==='idle');
    for(const b of this.buttons){const camera=new T.Vector3();g.camera.object3D.getWorldPosition(camera);b.el.object3D.lookAt(camera.x,b.el.object3D.getWorldPosition(new T.Vector3()).y,camera.z);
      b.ball.classList.toggle('menu-target',!g.expansion.menuOpen());
      if(g.xr&&!g.expansion.menuOpen()&&!g.outside)for(const hand of g.scene.querySelectorAll('[hand-with-watch]')){const tip=hand.components['hand-with-watch']?.fingertipEl;if(!tip)continue;
        const inside=tip.object3D.getWorldPosition(new T.Vector3()).distanceTo(b.ball.object3D.getWorldPosition(new T.Vector3()))<.11;
        if(inside&&!b.touched.has(hand))b.ball.emit('click');if(inside)b.touched.add(hand);else b.touched.delete(hand);
      }
    }
  }
  dispose(){this.clear();this.root.remove();}
}
