import { drawPanel,drawText,HUD_COLORS } from '../../common/hud-draw.js';
import { wallSegments } from '../impossible-spaces/core/geometry.ts';

function roomName(level:any,piece:any){
  const number=level.pieces.filter(p=>p.kind===piece.kind).findIndex(p=>p.id===piece.id)+1;
  return `${piece.kind==='hall'?'Hallway':piece.kind==='elevator'?'Elevator':'Room'} ${number}`;
}

function drawRoom(ctx:any,box:any){
  const {level,piece,pos,direction,title}=box.state;if(!piece)return;
  const w=box.w,h=box.h;
  drawPanel(ctx,1,1,w-2,h-2,{fill:'rgba(6,11,20,.78)',stroke:HUD_COLORS.muted,radius:7});
  drawText(ctx,title,w/2,12,{size:10,align:'center',maxWidth:w-14});
  const vertices=piece.parts.flat(),xs=vertices.map(p=>p.x),ys=vertices.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min((w-20)/Math.max(.1,maxX-minX),(h-35)/Math.max(.1,maxY-minY));
  const x=p=>w/2+(p.x-(minX+maxX)/2)*scale,y=p=>27+(h-35)/2+(p.y-(minY+maxY)/2)*scale;
  const path=poly=>{ctx.moveTo(x(poly[0]),y(poly[0]));for(const p of poly.slice(1))ctx.lineTo(x(p),y(p));ctx.closePath();};
  ctx.beginPath();for(const poly of piece.parts)path(poly);ctx.fillStyle='rgba(127,227,255,.12)';ctx.fill();
  ctx.strokeStyle=HUD_COLORS.text;ctx.lineWidth=1.4;ctx.lineCap='round';
  ctx.beginPath();for(const [a,b] of wallSegments(piece,level.doors)){ctx.moveTo(x(a),y(a));ctx.lineTo(x(b),y(b));}ctx.stroke();
  for(const d of level.doors.filter(d=>d.a===piece.id||d.b===piece.id)){
    ctx.strokeStyle=level.closedDoors?.includes(d.id)||box.state.doorsClosed?HUD_COLORS.warn:HUD_COLORS.accent;
    ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(x(d.p1),y(d.p1));ctx.lineTo(x(d.p2),y(d.p2));ctx.stroke();
  }
  for(const poly of piece.blockers||[]){ctx.beginPath();path(poly);ctx.fillStyle=HUD_COLORS.muted;ctx.fill();}
  ctx.save();ctx.translate(x(pos),y(pos));ctx.rotate(Math.atan2(direction.z,direction.x));
  ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(-2.8,-2.8);ctx.lineTo(-1.5,0);ctx.lineTo(-2.8,2.8);ctx.closePath();
  ctx.strokeStyle=HUD_COLORS.outline;ctx.lineWidth=1.7;ctx.stroke();ctx.fillStyle=HUD_COLORS.accent;ctx.fill();ctx.restore();
}

AFRAME.registerComponent('expanding-room-hud',{
  init(){
    this.last=-Infinity;this.forward=new AFRAME.THREE.Vector3();this.inverse=new AFRAME.THREE.Matrix4();
    this.widget=this.el.systems['visor-hud'].add('top-right',{id:'expanding-room-map',visible:false,fps:10,draw:drawRoom});
  },
  tick(time){
    const g=this.el.querySelector('[impossible-game]')?.components['impossible-game'];
    const visible=!!g?.level&&!g.measuring()&&!g.outside&&(!g.xr||g.tracking);
    this.widget.show(visible);if(!visible)return;
    const piece=g.level.pieces.find(p=>p.id===g.state.activeId);
    const changed=this.widget.state.piece!==piece||this.widget.state.level!==g.level;
    if(!changed&&time-this.last<100)return;this.last=time;
    if(changed)this.widget.set({level:g.level,piece,title:roomName(g.level,piece)});
    g.camera.getObject3D('camera').getWorldDirection(this.forward);
    this.forward.transformDirection(this.inverse.copy(g.world.object3D.matrixWorld).invert());
    Object.assign(this.widget.state,{pos:{...g.state.pos},direction:{x:this.forward.x,z:this.forward.z},doorsClosed:g.state.doorsClosed});
    this.widget.redraw();
  },
  remove(){this.widget.remove();}
});
