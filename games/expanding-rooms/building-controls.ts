import '../../common/interaction-hints.js';
import { centroid } from '../impossible-spaces/core/geometry.ts';
import { wallControl,pointVisible } from './control-geometry.ts';
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
    const g=game();if(!g?.level||g.state.activeId!==this.el.dataset.cabin||g.expansion.menuOpen()||g.outside||g.measuring()){grab.resetToSpawn();return;}
    this.el.object3D.getWorldPosition(this.point);
    if(this.origin.y-this.point.y>=.12&&!this.pulled){this.pulled=true;g.requestRide();grab.resetToSpawn();}
    else if(this.point.distanceTo(this.origin)>.45)grab.resetToSpawn();
  },
  remove(){this.el.removeEventListener('simple-grabbed',this.start);this.el.removeEventListener('simple-released',this.end);}
});
function label(parent,text,x,y,z,width=.8){const el=document.createElement('a-text');el.setAttribute('font','sourcecodepro');el.setAttribute('value',text);el.setAttribute('align','center');el.setAttribute('width',width);el.setAttribute('position',`${x} ${y} ${z}`);el.setAttribute('color','#e7f8ff');parent.appendChild(el);return el;}
export class BuildingControls {
  root:any;level:any=null;buttons:any[]=[];handles:any[]=[];fixtures:any[]=[];
  constructor(public game:any){this.root=document.createElement('a-entity');this.root.id='building-controls';game.world.appendChild(this.root);}
  clear(){
    for(const h of this.handles){const grab=h.components['simple-grabbable'];if(grab?.spawnParent)grab.resetToSpawn();}
    for(const fixture of this.fixtures){const mesh=fixture.wire?.getObject3D('mesh');mesh?.geometry.dispose();mesh?.material.dispose();}
    this.root.replaceChildren();this.buttons=[];this.handles=[];this.fixtures=[];
  }
  button(piece:any,door:any,lift:boolean){
    const mount=wallControl(piece,door,this.level.doors);if(!mount)return;
    const {point,normal,jamb}=mount;
    const el=document.createElement('a-entity');
    el.setAttribute('position',`${point.x+normal.x*.035} 1.1 ${point.y+normal.y*.035}`);
    el.setAttribute('rotation',`0 ${Math.atan2(normal.x,normal.y)*180/Math.PI} 0`);
    el.dataset.door=door.id;this.root.appendChild(el);
    const plate=document.createElement('a-box');plate.setAttribute('width','.22');plate.setAttribute('height','.32');plate.setAttribute('depth','.04');plate.setAttribute('color','#253449');el.appendChild(plate);
    const ball=document.createElement('a-box');ball.classList.add('menu-target');ball.setAttribute('width','.12');ball.setAttribute('height','.12');ball.setAttribute('depth','.035');ball.setAttribute('position','0 0 .03');ball.setAttribute('color','#41c7b7');el.appendChild(ball);
    const caption=label(el,lift?'CALL LIFT':'OPEN DOOR',0,.23,.025,.6);
    // A surface-mounted wire runs from this button to its own door jamb.
    const wire=document.createElement('a-entity');wire.classList.add('call-wire');
    const a=new T.Vector3(point.x+normal.x*.028,1.1,point.y+normal.y*.028);
    const b=new T.Vector3(jamb.x+normal.x*.028,1.1,jamb.y+normal.y*.028);
    const c=b.clone();c.y=1.65;
    wire.setObject3D('mesh',new T.Line(new T.BufferGeometry().setFromPoints([a,b,c]),new T.LineBasicMaterial({color:'#f4c45e'})));
    this.root.appendChild(wire);
    const fixture={owner:piece.id,point:{x:point.x+normal.x*.05,y:point.y+normal.y*.05},el,wire};this.fixtures.push(fixture);
    ball.addEventListener('click',()=>{
      const g=this.game;if(!el.object3D.visible||g.expansion.menuOpen()||g.measuring()||g.outside)return;
      const p=new T.Vector3(),head=new T.Vector3();el.object3D.getWorldPosition(p);g.camera.object3D.getWorldPosition(head);
      if(p.distanceTo(head)>1.25){g.status('Walk to the button','Press the wall button, or touch it with your hand.');return;}
      // Calling this lift never shuts another visible door.
      this.level.closedDoors=this.level.closedDoors.filter(id=>id!==door.id);
      g.status(lift?'Lift open':'Door open',lift?'Step inside and pull the yellow handle down.':'Walk through when you are ready.');
    });
    this.buttons.push({el,ball,caption,door:door.id,owner:piece.id,touched:new Set()});
  }
  rebuild(){
    this.clear();this.level=this.game.level;
    for(const p of this.level.pieces.filter(p=>p.kind==='elevator')){
      const c=centroid(p.parts[0]),holder=document.createElement('a-entity');holder.setAttribute('position',`${c.x} 0 ${c.y}`);this.root.appendChild(holder);
      this.fixtures.push({owner:p.id,point:c,el:holder});
      const door=this.level.doors.find(d=>d.a===p.id||d.b===p.id);if(door){const sign=door.a===p.id?1:-1;holder.setAttribute('rotation',`0 ${Math.atan2(door.normal.x*sign,door.normal.y*sign)*180/Math.PI} 0`);}
      const cable=document.createElement('a-cylinder');cable.setAttribute('radius','.012');cable.setAttribute('height','.9');cable.setAttribute('position','0 2.05 0');cable.setAttribute('color','#c6d4e5');holder.appendChild(cable);
      const handle=document.createElement('a-entity');handle.dataset.cabin=p.id;handle.setAttribute('position','0 1.55 0');holder.appendChild(handle);handle.setAttribute('simple-grabbable','preserveGrabTransform: true');
      handle.setAttribute('hint-zone','action: grab; radius: 0.15; maxReach: 0.4; desktopKey: g; desktopLabel: Grab and pull down; xrLabel: Grab and pull down');handle.setAttribute('lift-pull','');
      const ring=document.createElement('a-torus');ring.setAttribute('radius','.09');ring.setAttribute('radius-tubular','.018');ring.setAttribute('color','#ffd56b');handle.appendChild(ring);this.handles.push(handle);
      label(holder,'LIFT\nPULL DOWN',0,1.25,0,.65);
    }
    for(const d of this.level.doors){
      const a=this.level.pieces.find(p=>p.id===d.a),b=this.level.pieces.find(p=>p.id===d.b);
      const lift=a.kind==='elevator'||b.kind==='elevator';
      if(!lift&&!this.level.decoration?.switches)continue;
      for(const p of [a,b])if(p.kind!=='elevator')this.button(p,d,lift);
    }
  }
  update(){
    const g=this.game;if(!g.level)return;if(this.level!==g.level)this.rebuild();
    for(const fixture of this.fixtures){const visible=pointVisible(g.level,g.state.activeId,fixture.owner,fixture.point);fixture.el.object3D.visible=visible;if(fixture.wire)fixture.wire.object3D.visible=visible;}
    for(const h of this.handles)h.setAttribute('hint-zone','enabled',h.dataset.cabin===g.state.activeId&&!g.expansion.menuOpen()&&g.ride.phase==='idle');
    for(const b of this.buttons){
      const enabled=b.el.object3D.visible&&!g.expansion.menuOpen();b.ball.classList.toggle('menu-target',enabled);
      b.ball.setAttribute('color',g.level.closedDoors.includes(b.door)?'#41c7b7':'#f4c45e');
      if(g.xr&&enabled&&!g.outside)for(const hand of g.scene.querySelectorAll('[hand-with-watch]')){
        const tip=hand.components['hand-with-watch']?.fingertipEl;if(!tip)continue;
        const inside=tip.object3D.getWorldPosition(new T.Vector3()).distanceTo(b.ball.object3D.getWorldPosition(new T.Vector3()))<.11;
        if(inside&&!b.touched.has(hand))b.ball.emit('click');if(inside)b.touched.add(hand);else b.touched.delete(hand);
      }
    }
  }
  dispose(){this.clear();this.root.remove();}
}
