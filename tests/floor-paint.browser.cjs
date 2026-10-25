// Real mounted watch controls and WebXR select events in both consumers.
const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),base=process.env.VR_TEST_URL||'http://127.0.0.1:8088';
(async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    for(const game of ['boundaries','impossible-spaces']){
      await page.goto(base+`/games/${game}/`);
      await page.waitForFunction(()=>document.querySelector('a-scene')?.components['boundary-floor-lab']&&document.querySelector('#left-hand')?.components['hand-with-watch']?.crossbarComponent);
      const result=await page.evaluate(game=>{
        const scene=document.querySelector('a-scene'),lab=scene.components['boundary-floor-lab'],T=AFRAME.THREE;
        const hand=document.querySelector('#left-hand').components['hand-with-watch'],watch=hand.projectedMenu,component=hand.crossbarComponent,menu=component.menu;
        const choose=id=>{menu.open();menu.refresh();if(!menu.level().items.some(i=>i.id===id)){menu.reset();menu.moveFocus(menu.level().items.findIndex(i=>i.id==='boundary-calibration'));menu.activate();}const index=menu.level().items.findIndex(i=>i.id===id);if(index<0)throw new Error('Missing '+id);menu.moveFocus(index-menu.level().index);component.focusedSlot().el.emit('click');};
        const set=(id,value)=>{choose(id);menu.moveFocus(menu.level().items.findIndex(i=>i.value===value)-menu.level().index);component.focusedSlot().el.emit('click');};
        const close=()=>{menu.close();watch.active=false;watch.visible=false;};
        const detector=lab.data.reader.components['headset-boundary'];
        const original={session:scene.renderer.xr.getSession,frame:scene.renderer.xr.getFrame,is:scene.is};
        const session=new EventTarget();session.environmentBlendMode='alpha-blend';session.inputSources=[];
        scene.renderer.xr.getSession=()=>session;scene.is=function(name){return name==='ar-mode'?true:original.is.call(this,name);};lab.attachSession();
        detector.boundedSpace={};const matrix=new T.Matrix4().makeRotationY(.6);matrix.setPosition(2,0,-3);
        const reported=[{x:.5,y:.3},{x:2,y:.3},{x:2,y:.8},{x:.5,y:.8}];
        scene.emit('headset-boundary-frame',{points:reported,matrix:matrix.toArray(),revision:12,position:{x:1,y:.5}},false);
        let position={x:0,y:1.65,z:.4},aim={x:0,y:.4},time=0,valid=true,down=true;
        const left={handedness:'left',targetRayMode:'tracked-pointer',targetRaySpace:{}},right={handedness:'right',targetRayMode:'tracked-pointer',targetRaySpace:{}};
        const orientation=new T.Quaternion().setFromEuler(new T.Euler(-Math.PI/2,0,0));
        const pose=space=>{if(space!==left.targetRaySpace&&space!==right.targetRaySpace)throw new Error('Unexpected pointer space');return valid?{transform:{position:{x:aim.x,y:1.2,z:aim.y},orientation:down?orientation:new T.Quaternion()}}:null;};
        scene.renderer.xr.getFrame=()=>({getViewerPose:space=>{if(space!==detector.boundedSpace)throw new Error('Wrong head space');return {transform:{position}};},getPose:(source,space)=>{if(space!==detector.boundedSpace)throw new Error('Pointer used different floor space');return pose(source);}});
        const tick=()=>lab.tick(time+=110),event=(type,source)=>{const e=new Event(type);Object.defineProperty(e,'inputSource',{value:source});session.dispatchEvent(e);};
        choose('calibration-start');close();
        scene.emit('headset-boundary-frame',{points:reported,matrix:matrix.toArray(),revision:12,position:{x:0,y:.4}},false);
        const referencesHidden=!detector.outline.visible&&!detector.fitOutline.visible&&!detector.corners.visible;
        const initial=[{x:0,y:.4},{x:.4,y:0},{x:4.7,y:0},{x:4.7,y:.8},{x:1.2,y:.8},{x:1.2,y:2.1},{x:0,y:2.1}];
        for(let i=0;i<initial.length;i++){const a=initial[i],b=initial[(i+1)%initial.length],n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.07);for(let j=0;j<n;j++){position={x:a.x+(b.x-a.x)*j/n,y:1.65,z:a.y+(b.y-a.y)*j/n};tick();}}
        position={x:0,y:1.65,z:.4};tick();
        const initialFilled=lab.walk.has({x:2,y:.4})&&!lab.walk.has({x:.04,y:.04})&&!lab.walk.has({x:3,y:1.5});
        const before=new Set(lab.walk.cells);set('calibration-input','paint');set('calibration-brush',.2);close();
        position={x:3,y:1.65,z:1.5};session.inputSources=[left,right];aim={x:.04,y:.04};tick();
        const hoverDoesNotPaint=!lab.walk.has(aim)&&lab.paintCursors.get(left).group.visible&&Math.abs(lab.paintCursors.get(left).brush.scale.x-.1)<1e-9;
        event('selectstart',left);
        const repair=[{x:0,y:.6},{x:0,y:0},{x:.6,y:0},{x:.6,y:.5}];
        for(let i=0;i<repair.length-1;i++){const a=repair[i],b=repair[i+1],n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.04);for(let j=0;j<=n;j++){aim={x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n};tick();}}
        event('selectend',left);tick();
        const repaired=lab.walk.has({x:.04,y:.04})&&[...before].every(k=>lab.walk.cells.has(k));
        const noHeadStamp=!lab.walk.has({x:3,y:1.5});
        const count=lab.walk.cells.size;aim={x:3,y:-.5};tick();const releasedNoPaint=lab.walk.cells.size===count&&!lab.walk.has(aim);
        // Neither an upward aim nor a missing pose can draw or retain a
        // held stroke that later connects across an unobserved gap.
        down=false;event('selectstart',right);tick();down=true;tick();const badRayNoPaint=lab.walk.cells.size===count;
        valid=false;event('selectstart',right);tick();valid=true;tick();const lostPoseNoPaint=lab.walk.cells.size===count;
        watch.active=true;event('selectstart',right);tick();const paused=lab.pressed.size===0;close();tick();const needsFreshPress=lab.walk.cells.size===count;
        // The right controller uses the same mask too.
        aim={x:4.65,y:.6};event('selectstart',right);tick();aim={x:4.85,y:.6};tick();event('selectend',right);tick();
        const rightWorks=lab.walk.has({x:4.85,y:.6});
        const acceptedCells=new Set(lab.walk.cells),rings=lab.walk.contours;
        const noCrossStroke=lab.trace.isLineSegments&&lab.trace.geometry.attributes.position.count===rings.reduce((sum,r)=>sum+r.length*2,0);
        choose('calibration-save');const review=lab.phase==='review'&&!!lab.pending&&lab.savedPoints.length===0;
        choose('calibration-resume');close();tick();choose('calibration-save');const frozen=JSON.stringify(lab.pending.points);position={x:2,y:1.65,z:.4};tick();const frozenReview=frozen===JSON.stringify(lab.pending.points);
        choose('calibration-confirm');close();const confirmed=lab.phase==='saved'&&lab.savedOutline.visible&&!lab.passthrough&&lab.savedPoints.length<=24;
        const g=document.querySelector('[impossible-game]')?.components['impossible-game'];
        const delivered=game==='boundaries'||(!!g.manualBoundary&&JSON.stringify(g.manualBoundary.points)===JSON.stringify(lab.savedPoints));
        window.paintTest={scene,lab,matrix};
        // Leave a static floor view for optional visual inspection.
        lab.root.visible=true;lab.fill.visible=true;
        scene.renderer.xr.getSession=original.session;scene.renderer.xr.getFrame=original.frame;scene.is=original.is;
        return {referencesHidden,initialFilled,hoverDoesNotPaint,repaired,noHeadStamp,releasedNoPaint,badRayNoPaint,lostPoseNoPaint,paused,needsFreshPress,rightWorks,noCrossStroke,review,frozenReview,confirmed,delivered,corners:lab.savedPoints.length,cells:acceptedCells.size};
      },game);
      for(const [key,value] of Object.entries(result))if(!['corners','cells'].includes(key))assert.equal(value,true,`${game}: ${key}`);
      console.log(JSON.stringify({game,...result}));assert.deepEqual(errors,[]);
      if(game==='boundaries'&&process.env.VR_SCREENSHOT_PATH){
        await page.evaluate(()=>{const {scene,lab,matrix}=window.paintTest;scene.pause();const camera=document.querySelector('#boundary-camera');camera.setAttribute('look-controls','enabled',false);const center=new AFRAME.THREE.Vector3(2.3,7,1).applyMatrix4(matrix);document.querySelector('#boundary-rig').object3D.position.set(0,0,0);camera.object3D.position.copy(center);camera.object3D.rotation.set(-Math.PI/2,.6,0);camera.querySelectorAll('a-text').forEach(el=>el.object3D.visible=false);lab.root.visible=lab.fill.visible=true;scene.renderer.render(scene.object3D,scene.camera);});
        await page.screenshot({path:process.env.VR_SCREENSHOT_PATH});
      }
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
