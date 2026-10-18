// Start in the actual Boundary Lab and generate through its mounted watch.
const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),base=process.env.VR_TEST_URL||'http://127.0.0.1:8088';
(async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base+'/games/boundaries/');
    await page.waitForFunction(()=>document.querySelector('[impossible-game]')?.components['impossible-game']&&document.querySelector('#left-hand')?.components['hand-with-watch']?.crossbarComponent);
    const result=await page.evaluate(async()=>{
      const scene=document.querySelector('a-scene'),lab=scene.components['boundary-floor-lab'],g=document.querySelector('[impossible-game]').components['impossible-game'],rig=document.querySelector('#boundary-rig'),url=location.href;
      const component=document.querySelector('#left-hand').components['hand-with-watch'].crossbarComponent,menu=component.menu;
      const click=id=>{menu.refresh();const index=menu.level().items.findIndex(item=>item.id===id);if(index<0)throw new Error('Missing watch row '+id);menu.moveFocus(index-menu.level().index);component.focusedSlot().el.emit('click');};
      const root=()=>{menu.open();menu.reset();menu.refresh();};
      const close=()=>{menu.close();document.querySelectorAll('[hand-with-watch]').forEach(el=>{const p=el.components['hand-with-watch'].projectedMenu;p.active=false;p.visible=false;});};
      const set=(id,value)=>{click(id);const row=menu.focusedRow();menu.moveFocus((value-row.value)/menu.level().source.step);component.focusedSlot().el.emit('click');};
      const wait=async()=>{for(let i=0;i<600&&g.generating;i++)await new Promise(r=>setTimeout(r,10));if(!g.level)throw new Error(g.message+' '+g.detail);};
      root();const rootVisible=menu.level().items[0].id==='generate-level';click('generate-level');click('generate-current');const blockedDesktop=!g.level&&!g.labMode;
      let enters=0,exits=0;scene.addEventListener('enter-vr',()=>enters++);scene.addEventListener('exit-vr',()=>exits++);scene.emit('enter-vr',{},false);
      const original={session:scene.renderer.xr.getSession,frame:scene.renderer.xr.getFrame,is:scene.is};
      const session=new EventTarget();session.inputSources=[];session.environmentBlendMode='alpha-blend';
      scene.renderer.xr.getSession=()=>session;scene.is=function(name){return name==='ar-mode'?true:original.is.call(this,name);};lab.attachSession();
      let position={x:.1,y:1.65,z:.1},time=0;const matrix=new AFRAME.THREE.Matrix4().makeRotationY(.7);matrix.setPosition(3,0,-2);
      const bounds=[{x:1,y:.5},{x:3,y:.5},{x:3,y:1.3},{x:1,y:1.3}],detector=rig.components['headset-boundary'];detector.boundedSpace={};
      scene.renderer.xr.getFrame=()=>({getViewerPose:()=>({transform:{position}})});
      const frame=()=>scene.emit('headset-boundary-frame',{points:bounds,matrix:matrix.toArray(),revision:10,position:{x:position.x,y:position.z}},false);frame();
      click('generate-current');const blockedUncalibrated=!g.level&&!g.labMode&&!!rig.components['locomotion-demo'];
      root();click('boundary-calibration');click('calibration-start');close();
      const outline=[{x:.1,y:.1},{x:4.8,y:.1},{x:4.8,y:1.6},{x:1.7,y:1.6},{x:1.7,y:2.2},{x:.1,y:2.2}];
      for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length],n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.07);for(let j=0;j<=n;j++){position={x:a.x+(b.x-a.x)*j/n,y:1.65,z:a.y+(b.y-a.y)*j/n};lab.tick(time+=110);frame();}}
      root();click('boundary-calibration');click('calibration-save');click('calibration-confirm');
      const focusedAfterSave=menu.level().source?.id==='generate-level'&&menu.focusedRow().item.id==='generate-current';
      const stylesVisible=['rooms-first-style','growth-style'].every(id=>menu.level().items.some(item=>item.id===id));
      const accepted=JSON.stringify(g.manualBoundary.points),revision=g.manualBoundary.revision;
      position={x:.8,y:1.65,z:.8};frame();click('generate-current');await wait();
      const roomCount=g.level.pieces.filter(p=>p.kind==='room').length,firstSeed=g.level.params.seed,firstLevel=g.level;
      const sharedFootprint=g.source==='traced'&&g.footprint.polygon.every((p,i)=>Math.abs(p.x+g.footprint.origin.x-g.manualBoundary.points[i].x)<1e-8&&Math.abs(p.y+g.footprint.origin.y-g.manualBoundary.points[i].y)<1e-8);
      const walkingOnly=!rig.components['locomotion-demo']&&rig.object3D.position.toArray().every(v=>v===0)&&rig.object3D.quaternion.equals(new AFRAME.THREE.Quaternion());
      const propsHidden=[...scene.querySelectorAll('[data-level-lab-prop]')].every(el=>!el.object3D.visible);
      const expected=new AFRAME.THREE.Matrix4().copy(matrix).multiply(new AFRAME.THREE.Matrix4().makeTranslation(g.footprint.origin.x,0,g.footprint.origin.y));
      const aligned=expected.elements.every((v,i)=>Math.abs(v-g.world.object3D.matrix.elements[i])<1e-9);
      rig.emit('semantic-move',{x:1,z:1,deltaMs:100},true);window.dispatchEvent(new KeyboardEvent('keydown',{key:'w'}));g.tick(time+=100,100);
      const noArtificialMotion=rig.object3D.position.toArray().every(v=>v===0);
      click('generate-current');await wait();const regenerated=g.level!==firstLevel&&g.level.params.seed!==firstSeed&&JSON.stringify(g.manualBoundary.points)===accepted;
      click('rooms-first-style');const before=g.level;set('rooms-first:roomCount',6);const explicitSettings=g.level===before&&!g.generating;click('generate-rooms-first');await wait();const customCount=g.level.pieces.filter(p=>p.kind==='room').length===6;
      menu.back();click('growth-style');set('growth:pieceCount',5);click('generate-growth');await wait();const oldStyle=g.level.params.generationStyle==='growth'&&JSON.stringify(g.manualBoundary.points)===accepted;
      menu.back();click('rooms-first-style');set('rooms-first:roomCount',8);click('generate-rooms-first');await wait();
      const layers=g.level.roomsFirst.layers,cabin=g.level.pieces.find(p=>p.id===layers[0].cabinId),poly=cabin.parts[0];g.state.activeId=cabin.id;g.state.pos={x:poly.reduce((n,p)=>n+p.x,0)/4,y:poly.reduce((n,p)=>n+p.y,0)/4};position={x:g.state.pos.x+g.footprint.origin.x,y:1.65,z:g.state.pos.y+g.footprint.origin.y};frame();g.updatePanel();
      const beforeRide={...g.state.pos};document.querySelector('#ride-button').emit('click',{},false);const closing=g.ride.phase==='closing';for(let i=0;i<150;i++)g.tick(time+=20,20);
      const stationaryRide=closing&&g.state.activeId===layers[1].cabinId&&JSON.stringify(g.state.pos)===JSON.stringify(beforeRide)&&rig.object3D.position.toArray().every(v=>v===0);
      root();click('return-to-lab');const returned=!g.level&&!g.labMode&&!!rig.components['locomotion-demo']&&document.querySelector('#boundary-floor').object3D.visible&&JSON.stringify(g.manualBoundary.points)===accepted;
      position={x:.8,y:1.65,z:.8};frame();click('generate-level');click('generate-current');await wait();const afterReturn=!!g.level&&g.labMode&&g.manualBoundary.revision===revision;
      const activeLevel=g.level;root();click('boundary-calibration');click('calibration-start');const calibrationHides=g.measuring()&&!g.world.object3D.visible;root();click('boundary-calibration');click('calibration-cancel');frame();const cancelRestores=g.level===activeLevel&&g.world.object3D.visible&&!rig.components['locomotion-demo'];
      const sameSession=scene===document.querySelector('a-scene')&&scene.renderer.xr.getSession()===session&&location.href===url&&enters===1&&exits===0;
      scene.emit('exit-vr',{},false);const exitRestores=!g.level&&!g.manualBoundary&&!g.labMode&&!!rig.components['locomotion-demo']&&document.querySelector('#boundary-floor').object3D.visible;
      scene.renderer.xr.getSession=original.session;scene.renderer.xr.getFrame=original.frame;scene.is=original.is;
      return {rootVisible,blockedDesktop,blockedUncalibrated,focusedAfterSave:!!focusedAfterSave,stylesVisible,roomCount,sharedFootprint,walkingOnly,propsHidden,aligned,noArtificialMotion,regenerated,explicitSettings,customCount,oldStyle,stationaryRide,returned,afterReturn,calibrationHides,cancelRestores,sameSession,exitRestores};
    });
    for(const [key,value] of Object.entries(result))if(key!=='roomCount')assert.equal(value,true,key);assert.equal(result.roomCount,8);assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
