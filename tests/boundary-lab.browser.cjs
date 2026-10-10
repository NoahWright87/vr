// Optional rendered checks. Synthetic boundary stress tests stay in Boundary Lab.
const { chromium } = require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.VR_TEST_URL || 'http://127.0.0.1:8088';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(base + '/games/boundaries/');
    await page.waitForFunction(() => document.querySelector('#boundary-rig')?.components['headset-boundary'] && document.querySelector('a-scene').renderer);
    const rect = [{x:-2.35,y:-1.05},{x:2.35,y:-1.05},{x:2.35,y:1.05},{x:-2.35,y:1.05}];
    const shapes = {
      l: [{x:-2.5,y:-2},{x:2.5,y:-2},{x:2.5,y:-.8},{x:-1.3,y:-.8},{x:-1.3,y:2},{x:-2.5,y:2}],
      notch: [{x:-2.5,y:-2},{x:2.5,y:-2},{x:2.5,y:2},{x:.001,y:2},{x:.001,y:-1.5},{x:-.001,y:-1.5},{x:-.001,y:2},{x:-2.5,y:2}],
      rotated: rect.map(p=>({x:p.x*Math.cos(.392699)-p.y*Math.sin(.392699),y:p.x*Math.sin(.392699)+p.y*Math.cos(.392699)})),
    };
    for (const [shape, points] of Object.entries(shapes)) {
      const result = await page.evaluate(points => {
        const scene = document.querySelector('a-scene'), c = document.querySelector('#boundary-rig').components['headset-boundary'];
        scene.renderer.xr.getReferenceSpace = () => ({});
        c.boundedSpace = { boundsGeometry: points.map(p => ({x:p.x,y:0,z:p.y})) };
        c.updateFromFrame({getPose:()=>({transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}),getViewerPose:()=>({transform:{position:{x:0,z:0}}})});
        return {raw:c.geometry.attributes.position.count, fitted:c.fitGeometry.attributes.position.count,area:c.fit.area,
          polygonArea:c.fit.polygonArea, visible:c.outline.visible&&c.fitOutline.visible,
          dashed:!!c.fitOutline.material.isLineDashedMaterial, distances:c.fitGeometry.attributes.lineDistance?.count,
          detail:c.detail,revision:c.revision};
      }, points);
      assert.equal(result.raw, points.length); assert.equal(result.fitted, 4);
      assert.ok(result.visible && result.dashed && result.distances > 0);
      assert.ok(result.area <= result.polygonArea + 1e-6);
      if (shape === 'rotated') assert.ok(Math.abs(result.area - 9.87) < 1e-6);
      console.log(JSON.stringify({shape,...result}));
      if (shape === 'l' && process.env.VR_SCREENSHOT_PATH) {
        await page.evaluate(() => {
          const camera=document.querySelector('#boundary-camera');
          camera.setAttribute('look-controls','enabled',false);
          camera.object3D.position.set(0,6,0);camera.object3D.rotation.set(-Math.PI/2,0,0);
          camera.querySelectorAll('a-text').forEach(el=>el.object3D.visible=false);
          const caption=document.createElement('div');caption.textContent='SIMULATED L-SHAPED BOUNDARY — renderer check';
          caption.style.cssText='position:fixed;bottom:28px;left:24px;color:white;background:#101827;padding:12px;z-index:5';document.body.append(caption);
        });
        await page.waitForTimeout(200); await page.screenshot({path:process.env.VR_SCREENSHOT_PATH});
      }
    }
    assert.deepEqual(errors, []);
    const calibrationCheck=await page.evaluate(()=>{
      const scene=document.querySelector('a-scene'),lab=scene.components['boundary-floor-lab'];
      const detector=document.querySelector('#boundary-rig').components['headset-boundary'];
      const hand=document.querySelector('#left-hand').components['hand-with-watch'],watch=hand.projectedMenu,component=hand.crossbarComponent,menu=component.menu;
      const choose=id=>{
        menu.open();menu.refresh();
        if(!menu.level().items.some(item=>item.id===id)) {
          menu.reset();const rootIndex=menu.level().items.findIndex(item=>item.id===id);
          if(rootIndex<0){menu.moveFocus(menu.level().items.findIndex(item=>item.id==='boundary-calibration'));menu.activate();}
        }
        const index=menu.level().items.findIndex(item=>item.id===id);if(index<0)throw new Error('Missing action '+id);
        menu.moveFocus(index-menu.level().index);component.focusedSlot().el.emit('click');
      };
      const originalSession=scene.renderer.xr.getSession,originalFrame=scene.renderer.xr.getFrame,originalIs=scene.is;
      let ar=false,tracked=true,position={x:.15,y:1.65,z:.15};
      const session=new EventTarget();session.inputSources=[];session.environmentBlendMode='alpha-blend';
      scene.renderer.xr.getSession=()=>session;scene.is=function(name){return name==='ar-mode'?ar:originalIs.call(this,name);};lab.attachSession();
      detector.boundedSpace={};const matrix=new AFRAME.THREE.Matrix4().makeRotationY(.7);matrix.setPosition(3,0,-2);
      const bounds=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
      const refresh=()=>scene.emit('headset-boundary-frame',{points:bounds,matrix:matrix.toArray(),revision:10});refresh();
      const frame={getViewerPose:space=>{if(space!==detector.boundedSpace)throw new Error('Wrong walking space');return tracked?{transform:{position}}:null;}};
      scene.renderer.xr.getFrame=()=>frame;
      choose('calibration-start');const blockedWithoutAR=!lab.active&&!lab.walk&&lab.status.includes('passthrough');
      ar=true;session.environmentBlendMode='opaque';choose('calibration-start');const blockedOpaque=!lab.active&&!lab.walk;
      session.environmentBlendMode='alpha-blend';const background=scene.object3D.background,alpha=scene.renderer.getClearAlpha(),props=Array.from(scene.querySelectorAll('[data-calibration-opaque]'));
      choose('calibration-start');watch.active=false;watch.visible=false;
      const passthrough=scene.object3D.background===null&&scene.renderer.getClearAlpha()===0&&props.every(el=>!el.object3D.visible);
      const physicalOnly=!document.querySelector('#boundary-rig').components['locomotion-demo'];
      menu.close();menu.open();const automaticPage=menu.level().source?.id==='boundary-calibration';
      const outline=[{x:.15,y:.15},{x:4.4,y:.15},{x:4.4,y:.7},{x:1,y:.7},{x:1,y:1.9},{x:.15,y:1.9}];
      const walkLaps=count=>{for(let lap=0;lap<count;lap++)for(let i=0;i<outline.length;i++) {
        const a=outline[i],b=outline[(i+1)%outline.length],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.07);
        for(let n=0;n<steps;n++){const jitter=.008*Math.sin(n+lap*.7);position={x:a.x+(b.x-a.x)*n/steps+jitter,y:1.65,z:a.y+(b.y-a.y)*n/steps+jitter};lab.tick();}
      }position={x:.15,y:1.65,z:.15};lab.tick();};
      walkLaps(3);const laps=lab.walk.laps;
      watch.active=true;const before=JSON.stringify(lab.walk.lap);position={x:2,y:1.65,z:1.5};lab.tick();const paused=JSON.stringify(lab.walk.lap)===before;
      choose('calibration-save');const extraConfirmation=lab.phase==='review'&&lab.pending&&lab.savedPoints.length===0&&lab.preview.visible&&menu.focusedRow().item.id==='calibration-question';
      const finalCorners=lab.pending.points.length,reviewPoints=JSON.stringify(lab.pending.points);
      menu.activate();const questionDoesNotSave=lab.savedPoints.length===0;
      choose('calibration-resume');watch.active=false;watch.visible=false;walkLaps(1);choose('calibration-save');
      const canReturnAndSave=lab.phase==='review'&&!!lab.pending;
      choose('calibration-confirm');watch.active=false;
      const saved=lab.phase==='saved'&&!lab.walk&&!lab.pending;
      const green=lab.savedOutline.visible&&lab.savedOutline.geometry.attributes.position.count===lab.savedPoints.length*6&&lab.savedOutline.material.color.getHexString()==='4ade80'&&!lab.trace.visible&&!lab.preview.visible;
      const ground=Array.from(lab.savedOutline.geometry.attributes.position.array).filter((_,i)=>i%3===1).every(y=>Math.abs(y-.052)<1e-6);
      const restored=scene.object3D.background===background&&scene.renderer.getClearAlpha()===alpha&&props.every(el=>el.object3D.visible)&&!!document.querySelector('#boundary-rig').components['locomotion-demo'];
      const persisted=JSON.parse(localStorage.getItem('boundary-lab-calibration')).points.length===lab.savedPoints.length;
      const locked=JSON.stringify(lab.savedPoints);
      choose('calibration-start');watch.visible=false;watch.active=false;walkLaps(1);choose('calibration-save');choose('calibration-cancel');
      const cancelled=JSON.stringify(lab.savedPoints)===locked&&lab.savedOutline.visible&&!lab.passthrough;
      choose('calibration-start');watch.visible=false;watch.active=false;walkLaps(1);choose('calibration-save');
      const setItem=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};
      try{choose('calibration-confirm');}finally{Storage.prototype.setItem=setItem;}
      const savesWithoutStorage=lab.savedPoints.length>0&&lab.savedOutline.visible&&lab.status.includes('storage unavailable');
      scene.emit('headset-boundary-tracking-lost');const hiddenOnLoss=!lab.root.visible&&lab.savedPoints.length>0;refresh();const recovered=lab.root.visible&&lab.savedOutline.visible;
      choose('calibration-start');watch.visible=false;watch.active=false;walkLaps(1);choose('calibration-save');scene.emit('headset-boundary-reset');
      const resetStops=!lab.active&&!lab.pending&&lab.savedPoints.length===0&&!!lab.passthrough;
      lab.endSession();const exitRestores=!lab.passthrough&&scene.renderer.getClearAlpha()===alpha;
      scene.renderer.xr.getSession=originalSession;scene.renderer.xr.getFrame=originalFrame;scene.is=originalIs;
      return {blockedWithoutAR,blockedOpaque,passthrough,physicalOnly,automaticPage,laps,paused,extraConfirmation:!!extraConfirmation,questionDoesNotSave,finalCorners,canReturnAndSave,saved,green,ground,restored,persisted,cancelled,savesWithoutStorage,hiddenOnLoss,recovered,resetStops,exitRestores,
        removedControllerDrawing:!menu.page.items.some(item=>item.id==='page-floor')&&typeof lab.floorHit==='undefined'};
    });
    for(const [key,value] of Object.entries(calibrationCheck))if(!['laps','finalCorners'].includes(key))assert.equal(value,true,key);
    assert.ok(calibrationCheck.laps>=2);assert.ok(calibrationCheck.finalCorners<=12);console.log(JSON.stringify({calibrationCheck}));
    const entryCheck=await page.evaluate(async()=>{
      const scene=document.querySelector('a-scene'),calls=[];
      const request=navigator.xr.requestSession,support=AFRAME.utils.device.checkARSupport,connected=scene.checkHeadsetConnected,enabled=scene.renderer.xr.enabled;
      navigator.xr.requestSession=async(mode,options)=>{calls.push({mode,optional:options.optionalFeatures});throw new Error('Synthetic request');};
      scene.checkHeadsetConnected=()=>true;
      try{AFRAME.utils.device.checkARSupport=()=>true;await scene.enterVR(false).catch(()=>{});AFRAME.utils.device.checkARSupport=()=>false;await scene.enterVR(false).catch(()=>{});}
      finally{navigator.xr.requestSession=request;AFRAME.utils.device.checkARSupport=support;scene.checkHeadsetConnected=connected;scene.renderer.xr.enabled=enabled;}
      return calls;
    });
    assert.deepEqual(entryCheck.map(c=>c.mode),['immersive-ar','immersive-vr']);
    assert.ok(entryCheck.every(c=>c.optional.includes('bounded-floor')&&!c.optional.includes('plane-detection')));
    const download=page.waitForEvent('download');
    await page.evaluate(()=>{
      const component=document.querySelector('#left-hand').components['hand-with-watch'].crossbarComponent,menu=component.menu;
      menu.open();menu.reset();menu.moveFocus(menu.level().items.findIndex(item=>item.id==='save-diagnostics'));component.focusedSlot().el.emit('click');
    });
    assert.equal((await download).suggestedFilename(),'boundary-lab-report.json');
    const report=await page.evaluate(()=>JSON.parse(localStorage.getItem('boundary-lab-report')));
    assert.equal(report.schema,3);assert.ok(report.manualFloor);assert.equal(report.room,undefined);
    assert.deepEqual(errors, []);
    // A simple pair of rectangular rooms checks actual shared-wall surfaces.
    await page.goto(base + '/games/impossible-spaces/');
    await page.waitForFunction(() => document.querySelector('[impossible-game]')?.components['impossible-game']?.level);
    const wallCheck=await page.evaluate(()=>{
      const g=document.querySelector('[impossible-game]').components['impossible-game'];
      const watch=document.querySelector('#left-hand').components['hand-with-watch'].crossbarComponent,menu=watch.menu;
      const before=g.outline;menu.open();menu.reset();menu.moveFocus(menu.level().items.findIndex(item=>item.id==='outline'));
      watch.focusedSlot().el.emit('click');const watchWorks=g.outline!==before;
      watch.focusedSlot().el.emit('click');menu.close();
      const a=[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}],b=[{x:2,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2}];
      const level={...g.level,pieces:[{id:'a',kind:'room',template:'room-rect',parts:[a]},{id:'b',kind:'room',template:'room-rect',parts:[b]}],
        doors:[],portals:[],visible:{a:['a','b'],b:['a','b']},visibleRegions:{a:{a:[a],b:[b]},b:{a:[a],b:[b]}}};
      const view=new g.view.constructor(level), group=view.makeView({...g.state,activeId:'a',doorsClosed:false});view.cache.set('check',group);
      const faces={};
      for(const mesh of group.children.filter(o=>o.isMesh)) {
        const positions=mesh.geometry.attributes.position.array,values=[];
        for(let i=0;i<positions.length;i+=9) {
          const xs=[positions[i],positions[i+3],positions[i+6]],ys=[positions[i+1],positions[i+4],positions[i+7]];
          if(Math.max(...xs)-Math.min(...xs)<1e-6 && Math.max(...ys)>Math.min(...ys) && Math.abs(xs[0]-2)<.01) values.push(xs[0]);
        }
        faces[mesh.name]=values;
      }
      view.dispose();return {faces,watchWorks,margin:document.querySelector('#margin').value,width:document.querySelector('#door-width').value};
    });
    assert.ok(wallCheck.faces.a.length && wallCheck.faces.b.length);
    assert.ok(wallCheck.faces.a.every(x=>x<2) && wallCheck.faces.b.every(x=>x>2));
    assert.ok(Math.abs(wallCheck.faces.b[0]-wallCheck.faces.a[0]-.002)<1e-6);
    assert.equal(wallCheck.margin,'0.1');assert.equal(wallCheck.width,'0.8');
    assert.equal(wallCheck.watchWorks,true);
    console.log(JSON.stringify({wallCheck}));assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
