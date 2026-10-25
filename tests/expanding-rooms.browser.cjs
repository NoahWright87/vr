// Integration against the production bundle, using mounted watch AND visor rows.
const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const base=process.env.VR_TEST_URL||'http://127.0.0.1:8088';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base+'/games/expanding-rooms/');
    await page.waitForFunction(()=>document.querySelector('[impossible-game]')?.components['impossible-game']?.expansion&&document.querySelector('a-scene').systems['visor-menu']?.component).catch(error=>{throw new Error(error.message+'\nPage errors: '+JSON.stringify(errors));});
    const result=await page.evaluate(async()=>{
      const scene=document.querySelector('a-scene'),g=document.querySelector('[impossible-game]').components['impossible-game'];
      const s=g.expansion,lab=g.calibration(),watch=document.querySelector('#left-hand').components['hand-with-watch'];
      const visor=scene.systems['visor-menu'].component;
      let component=watch.crossbarComponent,menu=component.menu;
      const root=()=>{menu.open();menu.reset();menu.refresh();};
      const click=id=>{menu.refresh();const index=menu.level().items.findIndex(item=>item.id===id);if(index<0)throw new Error('Missing menu row '+id);menu.moveFocus(index-menu.level().index);component.focusedSlot().el.emit('click');};
      const set=(id,value)=>{click(id);const row=menu.focusedRow();menu.moveFocus((value-row.value)/menu.level().source.step);component.focusedSlot().el.emit('click');};
      const wait=async()=>{for(let i=0;i<500&&!g.level;i++)await new Promise(r=>setTimeout(r,10));if(!g.level)throw new Error(g.message+' '+g.detail);};
      const close=()=>{menu.close();watch.projectedMenu.active=false;watch.projectedMenu.visible=false;};
      root();const initial=menu.level().items.map(i=>i.id);
      const oneStep=initial.length===1&&initial[0]==='expand-boundary'&&!g.level;
      click('expand-boundary');root();click('customize');
      const manyRooms=menu.level().items.find(i=>i.id==='growth:pieceCount').value===36;
      menu.back();click('experiments');click('advanced-effects');set('expand:session:scale',1.5);
      const explicitGenerate=!g.level&&!g.generating&&s.scale===1.5;
      root();click('generate-current');await wait();
      const expanded=g.level.bounds.w===9&&g.level.params.generationStyle==='growth'&&!g.level.roomsFirst;
      close();component=visor;menu=component.menu;root();
      const visorIds=menu.level().items.filter(i=>i.id!=='visor-settings').map(i=>i.id).join(','); const sameMenus=visorIds==='expand-exit,experiments,debug';
      click('experiments');click('advanced-effects');set('expand:gain:maxGain',1.5);
      const liveSettings=s.gain.maxGain===1.5&&s.walker.gain.settings.maxGain===1.5;
      // Begin calibration from the visor, preserving the same XR session.
      close();scene.emit('enter-vr',{},false);
      const detector=document.querySelector('#boundary-reader').components['headset-boundary'];
      const xrSession=new EventTarget();xrSession.inputSources=[];xrSession.environmentBlendMode='alpha-blend';
      const original={session:scene.renderer.xr.getSession,frame:scene.renderer.xr.getFrame,space:scene.renderer.xr.getReferenceSpace,is:scene.is};
      let position={x:.1,y:1.65,z:.1};
      scene.renderer.xr.getSession=()=>xrSession;scene.is=function(name){return name==='ar-mode'?true:original.is.call(this,name);};lab.attachSession();
      const matrix=new AFRAME.THREE.Matrix4().makeRotationY(.7);matrix.setPosition(3,0,-2);
      const bounds=[{x:0,y:0},{x:2,y:0},{x:2,y:1},{x:0,y:1}];
      detector.boundedSpace={boundsGeometry:bounds.map(p=>({x:p.x,y:0,z:p.y}))};
      scene.renderer.xr.getReferenceSpace=()=>({});
      scene.renderer.xr.getFrame=()=>({getPose:()=>({transform:{matrix:matrix.toArray()}}),getViewerPose:()=>({transform:{position,orientation:{x:0,y:0,z:0,w:1}}})});
      const frame=()=>({points:bounds,matrix:matrix.toArray(),position:{x:position.x,y:position.z},orientation:{x:0,y:0,z:0,w:1},revision:10});
      scene.emit('headset-boundary-frame',frame(),false);
      const traceRequired=!g.level&&!g.generating;
      root();click('expand-boundary');
      const calibrationFromVisor=g.measuring()&&!menu.isOpen;
      const outline=[{x:.1,y:.1},{x:4.8,y:.1},{x:4.8,y:2.2},{x:.1,y:2.2}];
      for(let lap=0;lap<2;lap++)for(let i=0;i<outline.length;i++) {
        const a=outline[i],b=outline[(i+1)%outline.length],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.07);
        for(let n=0;n<steps;n++){position={x:a.x+(b.x-a.x)*n/steps,y:1.65,z:a.y+(b.y-a.y)*n/steps};lab.tick();}
      }
      position={x:.1,y:1.65,z:.1};lab.tick();root();
      const drawingPaused=lab.menuVisible();const calibrationIds=menu.level().items.filter(i=>i.id!=='visor-settings').map(i=>i.id).join(','); const twoActions=calibrationIds==='calibration-accept,calibration-cancel';click('calibration-accept');
      const accepted=!!g.manualBoundary&&!g.measuring()&&!!g.manualBoundary;
      const savedBoundary=g.manualBoundary;root();click('expand-boundary');root();click('calibration-cancel');const cancelKeepsBoundary=g.manualBoundary===savedBoundary&&!g.measuring();
      position={x:1,y:1.65,z:1};scene.emit('headset-boundary-frame',frame(),false);
      root();click('generate-current');await wait();close();
      const o=g.footprint.origin,physicalWidth=Math.max(...g.manualBoundary.points.map(p=>p.x))-Math.min(...g.manualBoundary.points.map(p=>p.x));
      const traceScaled=Math.abs(g.level.bounds.w-physicalWidth*1.5)<1e-8;
      const rigFixed=()=>g.rig.object3D.position.toArray().every(v=>v===0)&&g.rig.object3D.quaternion.equals(new AFRAME.THREE.Quaternion());
      // Verify inverse mapping and recovery in a rotated / translated tracking frame.
      const w=s.walker;w.transform.yaw=.2;const raw={x:position.x-o.x,y:position.z-o.y};w.reanchor(raw,g.state);
      scene.emit('headset-boundary-frame',frame(),false);
      const expected=new AFRAME.THREE.Matrix4().copy(matrix).multiply(new AFRAME.THREE.Matrix4().makeTranslation(o.x,0,o.y));
      const mapping=new AFRAME.THREE.Matrix4().makeRotationY(w.transform.yaw);mapping.setPosition(w.transform.x,0,w.transform.z);expected.multiply(mapping.invert());
      const worldAligned=expected.elements.every((v,i)=>Math.abs(v-g.world.object3D.matrix.elements[i])<1e-8)&&rigFixed();
      const saved={...g.state.pos};position={x:3,y:1.65,z:1.5};scene.emit('headset-boundary-frame',frame(),false);
      const wallRecoveryHidden=!g.world.object3D.visible&&g.outside;
      root();click('debug');click('expand-reanchor');
      const recovered=g.world.object3D.visible&&!g.outside&&g.state.pos.x===saved.x&&g.state.pos.y===saved.y&&rigFixed();
      const before={...w.transform};position.x+=.01;scene.emit('headset-boundary-frame',frame(),false);
      const pausedEffects=['x','z','yaw'].every(key=>Math.abs(w.transform[key]-before[key])<1e-10);
      scene.emit('headset-boundary-tracking-lost',{},false);const trackingHidden=!g.world.object3D.visible&&!!g.manualBoundary;
      scene.emit('headset-boundary-frame',frame(),false);const trackingRecovered=g.world.object3D.visible;
      scene.emit('headset-boundary-reset',{},false);const resetClears=!g.manualBoundary&&!g.level&&!s.walker;
      scene.renderer.xr.getSession=original.session;scene.renderer.xr.getFrame=original.frame;scene.renderer.xr.getReferenceSpace=original.space;scene.is=original.is;g.xr=false;
      return {cancelKeepsBoundary,visorIds,calibrationIds,oneStep,manyRooms,twoActions,explicitGenerate,expanded,sameMenus,liveSettings,traceRequired,calibrationFromVisor,drawingPaused,accepted,traceScaled,worldAligned,wallRecoveryHidden,recovered,pausedEffects,trackingHidden,trackingRecovered,resetClears};
    });
    for(const [name,value] of Object.entries(result).filter(([,v])=>typeof v==='boolean'))assert.equal(value,true,name);
    assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
