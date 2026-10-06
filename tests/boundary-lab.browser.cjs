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
