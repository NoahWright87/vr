// The lobby is a world surface of the same menu model used by watch and visor.
AFRAME.registerComponent('expanding-lobby',{
  init(){
    this.root=document.createElement('a-entity');this.root.id='setup-lobby';this.el.appendChild(this.root);
    this.panels=['expanding-setup','expanding-experiments'].map((page,i)=>{
      const el=document.createElement('a-entity');el.id=i?'experiments-panel':'setup-panel';
      el.setAttribute('position',i?'1.55 0 0.2':'0 0 0');el.setAttribute('rotation',i?'0 -28 0':'0 0 0');
      el.setAttribute('crossbar-menu',`page: ${page}; font: b612; wrap: false; open: true; closable: false; memory: none; width: 0.8; windowSize: 5; sidecar: ${i?'right':'left'}; sidecarWidth: 0.9; maxChars: 26; sidecarChars: 29`);
      el.setAttribute('crossbar-menu-registration','');this.root.appendChild(el);return el;
    });this.mode='';this.positioned=false;this.handlers=[];
    for(const name of ['enter-vr','exit-vr','headset-boundary-reset','walking-calibration-confirmed','walking-calibration-cancelled']){
      const fn=()=>{this.positioned=false;this.mode='';};this.el.addEventListener(name,fn);this.handlers.push([name,fn]);
    }
  },
  recenter(){this.positioned=false;this.mode='';},
  tick(){
    const g=this.el.querySelector('[impossible-game]')?.components['impossible-game'];if(!g)return;
    const mode=g.measuring()?'drawing':g.level?'playing':g.generating?'building':g.manualBoundary?'ready':'empty';
    if(mode!==this.mode){
      this.mode=mode;const visible=mode!=='drawing'&&mode!=='playing';this.root.object3D.visible=visible;
      for(const p of this.panels){const c=p.components['crossbar-menu'];if(!c)continue;c.menu.reset();if(visible)c.menu.open();else c.menu.close();c.menu.refresh();}
      this.el.querySelectorAll('[crossbar-menu]').forEach(p=>{if(!this.panels.includes(p)){const c=p.components['crossbar-menu'];if(c){c.menu.reset();c.menu.refresh();}}});
      if(visible)this.positioned=false;
    }
    if(!this.positioned&&this.root.object3D.visible&&(!g.xr||g.tracking)){
      const T=AFRAME.THREE,p=new T.Vector3(),d=new T.Vector3();g.camera.object3D.getWorldPosition(p);g.camera.object3D.getWorldDirection(d);d.negate();d.y=0;d.normalize();
      this.root.object3D.position.set(p.x+d.x*1.65,Math.max(.9,p.y-.15),p.z+d.z*1.65);
      this.root.object3D.rotation.set(0,Math.atan2(-d.x,-d.z),0);this.positioned=true;
    }
  },
  remove(){this.handlers.forEach(([n,f])=>this.el.removeEventListener(n,f));this.root.remove();}
});
