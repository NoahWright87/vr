// Production browser integration: actual watch rows, worker and shared calibration.
const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),base=process.env.VR_TEST_URL||'http://127.0.0.1:8088';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base+'/games/impossible-spaces/');
    await page.waitForFunction(()=>document.querySelector('[impossible-game]')?.components['impossible-game']?.level&&document.querySelector('#left-hand').components['hand-with-watch']?.crossbarComponent);
    const result=await page.evaluate(async()=>{
      const scene=document.querySelector('a-scene'),g=document.querySelector('[impossible-game]').components['impossible-game'],lab=scene.components['boundary-floor-lab'];
      const hand=document.querySelector('#left-hand').components['hand-with-watch'],component=hand.crossbarComponent,menu=component.menu;
      const click=id=>{menu.refresh();const index=menu.level().items.findIndex(item=>item.id===id);if(index<0)throw new Error('Missing watch row '+id);menu.moveFocus(index-menu.level().index);component.focusedSlot().el.emit('click');};
      const root=()=>{menu.open();menu.reset();menu.refresh();};
      const set=(id,value)=>{click(id);const row=menu.focusedRow();if(menu.level().kind==='number')menu.moveFocus((value-row.value)/menu.level().source.step);else menu.moveFocus(menu.level().items.findIndex(item=>item.value===value)-menu.level().index);component.focusedSlot().el.emit('click');};
      const wait=async()=>{for(let i=0;i<500&&!g.level;i++)await new Promise(r=>setTimeout(r,10));if(!g.level)throw new Error(g.message+' '+g.detail);};
      root();click('rooms-first-style');const existing=g.level;set('rooms-first:roomCount',9);set('rooms-first:roomsPerLayer',2);set('rooms-first:connectionMode','halls');
      const explicitGenerate=g.level===existing&&!g.generating;click('generate-rooms-first');await wait();
      const desktop={rooms:g.level.roomsFirst.requestedRooms,count:g.level.pieces.filter(p=>p.kind==='room').length,layers:g.level.roomsFirst.layers.length,setting:g.level.params.roomsPerLayer};
      root();click('growth-style');set('growth:pieceCount',5);click('generate-growth');await wait();const oldPreserved=g.level.params.generationStyle==='growth'&&!g.level.roomsFirst&&g.level.params.pieceCount===5;
      menu.close();scene.emit('enter-vr',{},false);
      const detector=document.querySelector('#boundary-reader').components['headset-boundary'];
      const session=new EventTarget();session.inputSources=[];session.environmentBlendMode='alpha-blend';
      const original={session:scene.renderer.xr.getSession,frame:scene.renderer.xr.getFrame,space:scene.renderer.xr.getReferenceSpace,is:scene.is};
      let position={x:.1,y:1.65,z:.1};
      scene.renderer.xr.getSession=()=>session;scene.is=function(name){return name==='ar-mode'?true:original.is.call(this,name);};lab.attachSession();
      const matrix=new AFRAME.THREE.Matrix4().makeRotationY(.7);matrix.setPosition(3,0,-2);
      const bounds=[{x:1,y:.5},{x:3,y:.5},{x:3,y:1.3},{x:1,y:1.3}];
      detector.boundedSpace={boundsGeometry:bounds.map(p=>({x:p.x,y:0,z:p.y}))};
      scene.renderer.xr.getReferenceSpace=()=>({});
      scene.renderer.xr.getFrame=()=>({getPose:()=>({transform:{matrix:matrix.toArray()}}),getViewerPose:()=>({transform:{position}})});
      const frame=()=>({points:bounds,matrix:matrix.toArray(),position:{x:position.x,y:position.z},revision:10});
      scene.emit('headset-boundary-frame',frame(),false);const traceRequired=!g.level&&!g.generating&&g.source==='traced';
      root();click('boundary-calibration');click('calibration-start');
      const passthrough=g.measuring()&&scene.renderer.getClearAlpha()===0&&!g.world.object3D.visible&&!g.panel.object3D.visible;
      hand.projectedMenu.active=false;hand.projectedMenu.visible=false;menu.close();
      const outline=[{x:.1,y:.1},{x:4.8,y:.1},{x:4.8,y:1.6},{x:1.7,y:1.6},{x:1.7,y:2.2},{x:.1,y:2.2}];
      for(let lap=0;lap<2;lap++)for(let i=0;i<outline.length;i++){
        const a=outline[i],b=outline[(i+1)%outline.length],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.07);
        for(let n=0;n<steps;n++){position={x:a.x+(b.x-a.x)*n/steps,y:1.65,z:a.y+(b.y-a.y)*n/steps};lab.tick();}
      }
      position={x:.1,y:1.65,z:.1};lab.tick();root();click('boundary-calibration');click('calibration-save');
      const reviewed=lab.phase==='review'&&lab.pending&&!g.manualBoundary;click('calibration-confirm');
      const accepted=!!g.manualBoundary&&!g.measuring()&&g.manualBoundary.points.some(p=>p.x<1||p.y>1.3);
      position={x:.8,y:1.65,z:.8};scene.emit('headset-boundary-frame',frame(),false);
      root();click('rooms-first-style');click('generate-rooms-first');await wait();menu.close();
      const level=g.level,origin=g.footprint.origin,traced={count:level.pieces.filter(p=>p.kind==='room').length,corners:level.params.footprint.length,width:level.bounds.w,height:level.bounds.h,setting:level.params.roomsPerLayer};
      const expected=new AFRAME.THREE.Matrix4().fromArray(matrix.toArray()).multiply(new AFRAME.THREE.Matrix4().makeTranslation(origin.x,0,origin.y)).toArray();
      const transformMatches=expected.every((v,i)=>Math.abs(v-g.world.object3D.matrix.elements[i])<1e-9);
      const rigFixed=document.querySelector('#player').object3D.position.toArray().every(v=>v===0);
      const savedOutline=lab.root.visible&&lab.savedOutline.visible&&!lab.fill.visible;
      const layers=level.roomsFirst.layers;
      const cabin=id=>{g.state.activeId=id;const poly=level.pieces.find(p=>p.id===id).parts[0];g.state.pos={x:poly.reduce((n,p)=>n+p.x,0)/4,y:poly.reduce((n,p)=>n+p.y,0)/4};position={x:g.state.pos.x+origin.x,y:1.65,z:g.state.pos.y+origin.y};scene.emit('headset-boundary-frame',frame(),false);g.updatePanel();};
      const ride=(button,to)=>{const before={...g.state.pos};document.querySelector(button).emit('click',{},false);if(g.ride.phase!=='closing')throw new Error('Button did not start ride');for(let i=0;i<150;i++)g.tick(i*20,20);if(g.state.activeId!==to||JSON.stringify(g.state.pos)!==JSON.stringify(before))throw new Error('Wrong ride destination or moved player');};
      cabin(layers[0].cabinId);ride('#ride-button',layers[1].cabinId);
      const middleButtons=document.querySelector('#ride-back-button').object3D.visible&&document.querySelector('#ride-button a-text').getAttribute('value')==='NEXT';
      ride('#ride-back-button',layers[0].cabinId);cabin(layers.at(-1).cabinId);
      const lastReturn=!document.querySelector('#ride-back-button').object3D.visible&&document.querySelector('#ride-button a-text').getAttribute('value')==='RETURN';ride('#ride-button',layers.at(-2).cabinId);
      // Both styles consume the same accepted polygon without changing XR sessions.
      cabin(layers[0].cabinId);position={x:.8,y:1.65,z:.8};scene.emit('headset-boundary-frame',frame(),false);
      root();click('growth-style');click('generate-growth');await wait();const bothStylesUseTrace=g.level.params.generationStyle==='growth'&&g.level.params.footprint.length===traced.corners&&g.level.bounds.w===traced.width;
      scene.emit('headset-boundary-tracking-lost',{},false);const trackingHidden=!g.world.object3D.visible&&!!g.manualBoundary;
      scene.emit('headset-boundary-frame',frame(),false);const recovered=g.world.object3D.visible&&lab.root.visible;
      scene.emit('headset-boundary-reset',{},false);const resetClears=!g.manualBoundary&&!g.level;
      scene.renderer.xr.getSession=original.session;scene.renderer.xr.getFrame=original.frame;scene.renderer.xr.getReferenceSpace=original.space;scene.is=original.is;g.xr=false;
      return {explicitGenerate,desktop,oldPreserved,traceRequired,passthrough,reviewed:!!reviewed,accepted,traced,transformMatches,rigFixed,savedOutline,middleButtons,lastReturn,bothStylesUseTrace,trackingHidden,recovered,resetClears};
    });
    for(const [key,value] of Object.entries(result))if(!['desktop','traced'].includes(key))assert.equal(value,true,key);
    assert.equal(result.desktop.count,9);assert.equal(result.desktop.setting,2);assert.equal(result.traced.count,9);assert.equal(result.traced.setting,2);assert.ok(result.traced.corners>=6&&result.traced.width>4.6);
    console.log(JSON.stringify(result));assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
