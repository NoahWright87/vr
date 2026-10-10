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
    const floorCheck=await page.evaluate(()=>{
      const scene=document.querySelector('a-scene'),lab=scene.components['boundary-floor-lab'];
      const detector=document.querySelector('#boundary-rig').components['headset-boundary'];
      const watch=document.querySelector('#left-hand').components['hand-with-watch'].projectedMenu;
      const panel=watch.panelEl;panel.components['menu-pages'].showPage('floor');
      const select=value=>Array.from(panel.querySelectorAll('[menu-item]')).find(el=>el.getAttribute('menu-item').value===value).emit('click');
      const originalSession=scene.renderer.xr.getSession,originalFrame=scene.renderer.xr.getFrame;
      const source={handedness:'right',targetRaySpace:{},gamepad:{buttons:[{pressed:false}]}};
      const session=new EventTarget();session.inputSources=[source];scene.renderer.xr.getSession=()=>session;lab.attachSession();
      detector.boundedSpace={};const boundary=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
      const matrix=new AFRAME.THREE.Matrix4().makeRotationY(.4);matrix.setPosition(2,0,-1);
      scene.emit('headset-boundary-frame',{points:boundary,matrix:matrix.toArray(),revision:1});
      let target={x:.1,y:.1};
      const pose=new AFRAME.THREE.Matrix4().makeRotationX(-Math.PI/2);
      let tracked=true;
      const frame={getViewerPose:()=>tracked?{}:null,getPose:(space,base)=>{
        if(space!==source.targetRaySpace || base!==detector.boundedSpace)throw new Error('Wrong target-ray reference space');
        pose.setPosition(target.x,1,target.y);return {transform:{matrix:pose.toArray()}};
      }};
      scene.renderer.xr.getFrame=()=>frame;
      // Mimic the selecting trigger still held while Start closes the watch.
      source.gamepad.buttons[0].pressed=true;select('floor-start');
      watch.active=false;watch.visible=false;lab.tick();
      const noMenuStroke=lab.drawing.points.length===0;
      const noLocomotion=!document.querySelector('#boundary-rig').components['locomotion-demo'];
      const stroke=points=>{source.gamepad.buttons[0].pressed=false;lab.tick();source.gamepad.buttons[0].pressed=true;for(const p of points){target=p;lab.tick();}source.gamepad.buttons[0].pressed=false;lab.tick();};
      stroke([{x:.1,y:.1},{x:4.5,y:.1},{x:4.5,y:.8},{x:1,y:.8},{x:1,y:2},{x:.1,y:2}]);
      const corners=lab.drawing.points.length;select('floor-finish');select('floor-save');
      const saved=lab.drawing.saved,area=lab.status,restored=!!document.querySelector('#boundary-rig').components['locomotion-demo'];
      const world=lab.root.localToWorld(new AFRAME.THREE.Vector3(.1,.048,.1)).toArray();
      select('floor-edit');watch.visible=false;watch.active=false;source.gamepad.buttons[0].pressed=false;lab.tick();
      stroke([{x:4.5,y:.8},{x:5,y:.8}]);select('floor-save');
      const refused=!lab.drawing.saved&&lab.status.includes('Outside');
      const red=Array.from(lab.outline.geometry.attributes.color.array).some((n,i)=>i%3===0&&n>.99);
      select('floor-undo');select('floor-save');const repaired=lab.drawing.saved;
      // Watch use interrupts drawing and requires a fresh trigger release.
      select('floor-clear');select('floor-start');watch.visible=false;watch.active=false;lab.tick();
      watch.active=true;source.gamepad.buttons[0].pressed=true;target={x:2,y:1};lab.tick();
      watch.active=false;lab.tick();const noWatchPoints=lab.drawing.points.length===0;
      stroke([{x:.1,y:.1},{x:2,y:.1},{x:2,y:1},{x:.1,y:1}]);select('floor-finish');
      tracked=false;select('floor-edit');watch.visible=false;watch.active=false;lab.tick();
      const clearedOnLoss=lab.drawing.points.length===0&&!lab.root.visible&&!lab.active;
      tracked=true;scene.emit('headset-boundary-frame',{points:boundary,matrix:matrix.toArray(),revision:1});
      const noResurrection=lab.drawing.points.length===0;
      select('floor-start');watch.visible=false;watch.active=false;lab.tick();stroke([{x:.1,y:.1},{x:2,y:.1},{x:2,y:1}]);
      scene.emit('headset-boundary-reset');const clearedOnReset=lab.drawing.points.length===0&&!lab.active;
      scene.renderer.xr.getSession=originalSession;scene.renderer.xr.getFrame=originalFrame;
      return {noMenuStroke,noLocomotion,corners,saved,area,restored,world,refused,red,repaired,noWatchPoints,clearedOnLoss,noResurrection,clearedOnReset,
        features:scene.systems.webxr.sessionConfiguration.optionalFeatures,oldRoomButtons:panel.querySelector('[data-menu-page="room"]')!==null};
    });
    for(const key of ['noMenuStroke','noLocomotion','saved','restored','refused','red','repaired','noWatchPoints','clearedOnLoss','noResurrection','clearedOnReset'])assert.equal(floorCheck[key],true,key);
    assert.equal(floorCheck.corners,6);assert.equal(floorCheck.oldRoomButtons,false);
    assert.ok(floorCheck.features.includes('bounded-floor'));assert.ok(!floorCheck.features.includes('plane-detection'));
    assert.ok(Math.abs(floorCheck.world[0]-(2+.1*Math.cos(.4)+.1*Math.sin(.4)))<1e-6);
    console.log(JSON.stringify({floorCheck}));
    const calibrationCheck=await page.evaluate(()=>{
      const scene=document.querySelector('a-scene'),lab=scene.components['boundary-floor-lab'];
      const detector=document.querySelector('#boundary-rig').components['headset-boundary'];
      const watch=document.querySelector('#left-hand').components['hand-with-watch'].projectedMenu;
      const panel=watch.panelEl;panel.components['menu-pages'].showPage('calibration');
      const select=value=>Array.from(panel.querySelectorAll('[menu-item]')).find(el=>el.getAttribute('menu-item').value===value).emit('click');
      const originalSession=scene.renderer.xr.getSession,originalFrame=scene.renderer.xr.getFrame,originalIs=scene.is;
      let ar=false,tracked=true,position={x:.15,y:1.65,z:.15};
      const session=new EventTarget();session.inputSources=[];session.environmentBlendMode='alpha-blend';
      scene.renderer.xr.getSession=()=>session;scene.is=function(name){return name==='ar-mode'?ar:originalIs.call(this,name);};lab.attachSession();
      detector.boundedSpace={};
      const matrix=new AFRAME.THREE.Matrix4().makeRotationY(.7);matrix.setPosition(3,0,-2);
      const bounds=[{x:0,y:0},{x:4.7,y:0},{x:4.7,y:2.1},{x:0,y:2.1}];
      const refresh=()=>scene.emit('headset-boundary-frame',{points:bounds,matrix:matrix.toArray(),revision:10});refresh();
      const frame={getViewerPose:space=>{if(space!==detector.boundedSpace)throw new Error('Walking used the wrong reference space');return tracked?{transform:{position}}:null;}};
      scene.renderer.xr.getFrame=()=>frame;
      select('calibration-start');const blockedWithoutAR=!lab.active&&!lab.calibrating&&lab.status.includes('passthrough');
      ar=true;session.environmentBlendMode='opaque';select('calibration-start');const blockedOpaque=!lab.active&&!lab.calibrating;
      session.environmentBlendMode='alpha-blend';
      const background=scene.object3D.background,alpha=scene.renderer.getClearAlpha();
      const props=Array.from(scene.querySelectorAll('[data-calibration-opaque]'));
      select('calibration-start');watch.active=false;watch.visible=false;
      const passthrough=scene.object3D.background===null&&scene.renderer.getClearAlpha()===0&&props.every(el=>!el.object3D.visible);
      const physicalOnly=!document.querySelector('#boundary-rig').components['locomotion-demo'];
      panel.components['menu-pages'].showPage('main');watch.el.emit('projected-menu-opened');
      const confirmPage=panel.querySelector('[data-menu-page=calibration]').object3D.visible;
      const walk=points=>{for(const p of points){position={x:p.x,y:1.65,z:p.y};lab.tick();}};
      walk([{x:.15,y:.15},{x:4.4,y:.15},{x:4.4,y:.7},{x:1,y:.7},{x:1,y:1.9},{x:.15,y:1.9}]);
      const count=lab.drawing.points.length,ground=Array.from(lab.corners.geometry.attributes.position.array).filter((_,i)=>i%3===1).every(y=>Math.abs(y-.048)<1e-6);
      watch.active=true;const before=JSON.stringify(lab.drawing.points);position={x:2,y:1.65,z:1.5};lab.tick();
      const pausedForWatch=JSON.stringify(lab.drawing.points)===before;
      select('calibration-confirm');watch.active=false;
      const confirmed=lab.drawing.saved&&!lab.calibrating&&lab.drawing.closed&&lab.status.includes('confirmed');
      const restored=scene.object3D.background===background&&scene.renderer.getClearAlpha()===alpha&&props.every(el=>el.object3D.visible)&&!!document.querySelector('#boundary-rig').components['locomotion-demo'];
      const locked=JSON.stringify(lab.drawing.points);
      select('calibration-start');watch.visible=false;watch.active=false;walk([{x:.2,y:.2},{x:2,y:.2}]);select('calibration-cancel');
      const cancelled=JSON.stringify(lab.drawing.points)===locked&&lab.drawing.saved&&!lab.passthrough;
      select('calibration-start');watch.visible=false;watch.active=false;walk([{x:.2,y:.2},{x:5,y:.2},{x:2,y:1.8}]);select('calibration-confirm');
      const outsideRejected=!lab.drawing.saved&&lab.status.includes('Outside')&&!!lab.passthrough&&!lab.active;
      select('calibration-cancel');select('calibration-start');watch.visible=false;watch.active=false;walk([{x:.2,y:.2},{x:2,y:.2}]);
      tracked=false;lab.tick();const trackingStops=!lab.active&&!!lab.passthrough&&!lab.calibrating&&lab.drawing.points.length===0&&scene.renderer.getClearAlpha()===0;
      select('calibration-cancel');
      tracked=true;refresh();select('calibration-start');watch.visible=false;watch.active=false;walk([{x:.2,y:.2},{x:2,y:.2}]);
      scene.emit('headset-boundary-reset');const resetStops=!lab.active&&!!lab.passthrough&&lab.drawing.points.length===0;
      lab.endSession();const exitRestores=!lab.passthrough&&scene.renderer.getClearAlpha()===alpha;
      scene.renderer.xr.getSession=originalSession;scene.renderer.xr.getFrame=originalFrame;scene.is=originalIs;
      return {blockedWithoutAR,blockedOpaque,passthrough,physicalOnly,confirmPage,count,ground,pausedForWatch,confirmed,restored,cancelled,outsideRejected,trackingStops,resetStops,exitRestores};
    });
    for(const [key,value] of Object.entries(calibrationCheck))if(key!=='count')assert.equal(value,true,key);
    assert.equal(calibrationCheck.count,6);console.log(JSON.stringify({calibrationCheck}));
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
      const panel=document.querySelector('#left-hand').components['hand-with-watch'].projectedMenu.panelEl;
      panel.components['menu-pages'].showPage('main');
      Array.from(panel.querySelectorAll('[menu-item]')).find(el=>el.getAttribute('menu-item').value==='save-diagnostics').emit('click');
    });
    assert.equal((await download).suggestedFilename(),'boundary-lab-report.json');
    const report=await page.evaluate(()=>JSON.parse(localStorage.getItem('boundary-lab-report')));
    assert.equal(report.schema,2);assert.ok(report.manualFloor);assert.equal(report.room,undefined);
    assert.deepEqual(errors, []);
    // A simple pair of rectangular rooms checks actual shared-wall surfaces.
    await page.goto(base + '/games/impossible-spaces/');
    await page.waitForFunction(() => document.querySelector('[impossible-game]')?.components['impossible-game']?.level);
    const wallCheck=await page.evaluate(()=>{
      const g=document.querySelector('[impossible-game]').components['impossible-game'];
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
      view.dispose();return {faces,margin:document.querySelector('#margin').value,width:document.querySelector('#door-width').value};
    });
    assert.ok(wallCheck.faces.a.length && wallCheck.faces.b.length);
    assert.ok(wallCheck.faces.a.every(x=>x<2) && wallCheck.faces.b.every(x=>x>2));
    assert.ok(Math.abs(wallCheck.faces.b[0]-wallCheck.faces.a[0]-.002)<1e-6);
    assert.equal(wallCheck.margin,'0.1');assert.equal(wallCheck.width,'0.8');
    console.log(JSON.stringify({wallCheck}));assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
