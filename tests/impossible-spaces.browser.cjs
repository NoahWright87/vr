// Optional integration runner: use your installed Playwright (or set VR_PLAYWRIGHT_PATH).
const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const base=process.env.VR_TEST_URL || 'http://127.0.0.1:8088';
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(base+'/games/impossible-spaces/');
  await page.waitForFunction(()=>document.querySelector('[impossible-game]')?.components['impossible-game']?.level,null,{timeout:20000});
  await page.waitForTimeout(1200);
  if(process.env.VR_SCREENSHOT_PATH)await page.screenshot({path:process.env.VR_SCREENSHOT_PATH});
  console.log(JSON.stringify({status:await page.locator('#status').innerText(),errors,info:await page.evaluate(()=>{const g=document.querySelector('[impossible-game]').components['impossible-game'];return {pieces:g.level.pieces.length,elevators:g.level.portals.length,room:g.state.activeId,render:g.view.root.children.length,rig:document.querySelector('#player').object3D.position.toArray()};})}));
  assert.deepEqual(errors,[]);
  // Exercise actual desktop key input, not just component shortcuts.
  const before=await page.evaluate(()=>({...document.querySelector('[impossible-game]').components['impossible-game'].state.pos}));
  await page.locator('canvas.a-canvas').click({position:{x:1000,y:750}});
  await page.keyboard.down('w');await page.waitForTimeout(250);await page.keyboard.up('w');
  const after=await page.evaluate(()=>({...document.querySelector('[impossible-game]').components['impossible-game'].state.pos}));
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y)>.04);
  // Exercise the real panel click and door animation in the rendered application.
  const rideResult=await page.evaluate(async()=>{
    const g=document.querySelector('[impossible-game]').components['impossible-game'];
    const portal=g.level.portals[0];if(!portal)return {skipped:true};
    const p=g.level.pieces.find(p=>p.id===portal.a),poly=p.parts[0];
    const c={x:poly.reduce((s,v)=>s+v.x,0)/poly.length,y:poly.reduce((s,v)=>s+v.y,0)/poly.length};
    g.state.activeId=portal.a;g.state.pos=c;g.updatePanel();g.view.show(g.state);
    document.querySelector('#ride-button').emit('click',{},false);
    const initial=g.ride.phase;const rigBefore=document.querySelector('#player').object3D.position.toArray();
    await new Promise(r=>setTimeout(r,2400));
    return {initial,phase:g.ride.phase,active:g.state.activeId,destination:portal.b,before:c,after:g.state.pos,rigBefore,rigAfter:document.querySelector('#player').object3D.position.toArray()};
  });
  assert.equal(rideResult.initial,'closing');assert.equal(rideResult.active,rideResult.destination);assert.equal(rideResult.phase,'idle');assert.deepEqual(rideResult.before,rideResult.after);
  console.log(JSON.stringify({rideResult}));
  for(const shape of ['l','notch','chamfer']){
    await page.locator('details').evaluate(el=>el.open=true);
    await page.locator('#shape').selectOption(shape);
    await page.waitForFunction(()=>document.querySelector('[impossible-game]').components['impossible-game'].level);
    const snapshot=await page.evaluate(()=>{const g=document.querySelector('[impossible-game]').components['impossible-game'];return {corners:g.footprint.polygon.length,count:g.level.pieces.length};});
    assert.ok(snapshot.corners>=6);console.log(JSON.stringify({shape,...snapshot}));
  }
  // Raycast the actual 3D triangles: neighboring hidden walls must never be drawn.
  const geometryResult=await page.evaluate(()=>{
    const g=document.querySelector('[impossible-game]').components['impossible-game'],T=AFRAME.THREE;
    let rays=0;const problems=[];
    const raySeg=(o,v,a,b)=>{const sx=b.x-a.x,sy=b.y-a.y,den=v.x*sy-v.y*sx;if(Math.abs(den)<1e-12)return null;const t=((a.x-o.x)*sy-(a.y-o.y)*sx)/den,u=((a.x-o.x)*v.y-(a.y-o.y)*v.x)/den;return t>=0&&u>=-1e-9&&u<=1+1e-9?t:null;};
    // Independent analytic traversal through door openings.
    function truth(id,origin,dir){let start=0,current=id;for(let hop=0;hop<30;hop++){const piece=g.level.pieces.find(p=>p.id===current);let best=Infinity,point=null;
      // Ignore internal part seams; detect departure from the union by sampling just past each edge.
      const inPoly=(p,poly)=>{let sign=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);if(Math.abs(cross)<1e-7)continue;const s=Math.sign(cross);if(sign&&sign!==s)return false;sign=s;}return true;};
      for(const poly of piece.parts)for(let i=0;i<poly.length;i++){const t=raySeg(origin,dir,poly[i],poly[(i+1)%poly.length]);if(t===null||t<=start+1e-6||t>=best)continue;const after={x:origin.x+dir.x*(t+.00001),y:origin.y+dir.y*(t+.00001)};if(piece.parts.some(p=>inPoly(after,p)))continue;best=t;point={x:origin.x+dir.x*t,y:origin.y+dir.y*t};}
      if(!point)return best;
      const door=g.level.doors.find(d=>(d.a===current||d.b===current)&&(()=>{const x=d.p2.x-d.p1.x,y=d.p2.y-d.p1.y,t=((point.x-d.p1.x)*x+(point.y-d.p1.y)*y)/(x*x+y*y);return t>=0&&t<=1&&Math.hypot(point.x-d.p1.x-t*x,point.y-d.p1.y-t*y)<1e-5;})());
      if(!door)return best;current=door.a===current?door.b:door.a;start=best;
    }return Infinity;}
    for(const piece of g.level.pieces){g.state.activeId=piece.id;g.state.doorsClosed=false;g.view.show(g.state);g.view.root.updateWorldMatrix(true,true);
      for(const poly of piece.parts){const origin={x:poly.reduce((s,v)=>s+v.x,0)/poly.length,y:poly.reduce((s,v)=>s+v.y,0)/poly.length};for(let i=0;i<120;i++){const angle=(i+.123)*Math.PI*2/120,dir={x:Math.cos(angle),y:Math.sin(angle)},expected=truth(piece.id,origin,dir);
        const caster=new T.Raycaster(new T.Vector3(origin.x,1.5,origin.y),new T.Vector3(dir.x,0,dir.y));const actual=caster.intersectObjects(g.view.current.children.filter(o=>o.isMesh),false)[0]?.distance??Infinity;rays++;
        if(Math.abs(actual-expected)>.015)problems.push({piece:piece.id,actual,expected});
      }}
    }
    return {rays,problems:problems.slice(0,5),count:problems.length};
  });
  assert.equal(geometryResult.count,0,JSON.stringify(geometryResult));console.log(JSON.stringify({geometryResult}));
  // Simulate the public boundary events and ensure keyboard input cannot move an XR rig.
  const xrResult=await page.evaluate(async()=>{
    const g=document.querySelector('[impossible-game]').components['impossible-game'],scene=document.querySelector('a-scene');
    scene.emit('enter-vr',{},false);
    const frame={points:[{x:-3,y:-2.5},{x:3,y:-2.5},{x:3,y:2.5},{x:-3,y:2.5}],matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],position:{x:0,y:0},revision:999};
    scene.emit('headset-boundary-frame',frame,false);
    for(let i=0;i<200&&!g.level;i++)await new Promise(r=>setTimeout(r,20));
    if(!g.level)return {error:g.message};
    const before={...g.state.pos},rig=document.querySelector('#player').object3D.position.toArray();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'w'}));await new Promise(r=>setTimeout(r,200));
    const after={...g.state.pos},rigAfter=document.querySelector('#player').object3D.position.toArray();
    scene.emit('headset-boundary-frame',{...frame,position:{x:.01,y:.01}},false);
    const walked={...g.state.pos},matrix=document.querySelector('#world').object3D.matrix.toArray();
    scene.emit('headset-boundary-reset',{},false);const resetCleared=g.level===null;
    scene.emit('headset-boundary-frame',{...frame,revision:1000},false);
    for(let i=0;i<200&&!g.level;i++)await new Promise(r=>setTimeout(r,20));
    const regenerated=!!g.level;
    scene.emit('headset-boundary-tracking-lost',{},false);const trackingHidden=!g.world.object3D.visible;
    return {before,after,walked,rig,rigAfter,matrix,resetCleared,regenerated,trackingHidden};
  });
  assert.ok(!xrResult.error,JSON.stringify(xrResult));assert.deepEqual(xrResult.before,xrResult.after);assert.deepEqual(xrResult.rig,[0,0,0]);assert.deepEqual(xrResult.rigAfter,[0,0,0]);assert.ok(xrResult.walked.x>xrResult.after.x);assert.ok(xrResult.resetCleared&&xrResult.regenerated&&xrResult.trackingHidden);
  console.log(JSON.stringify({xrResult}));assert.deepEqual(errors,[]);
  await page.goto(base+'/games/boundaries/');await page.waitForFunction(()=>document.querySelector('#boundary-rig')?.components['headset-boundary']);
  assert.equal(await page.evaluate(()=>!!document.querySelector('#boundary-floor').getObject3D('mesh').material.map),true);assert.deepEqual(errors,[]);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
