const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto((process.env.VR_TEST_URL||'http://127.0.0.1:8088')+'/games/expanding-rooms/');
await page.waitForFunction(()=>document.querySelector('[impossible-game]')?.components['impossible-game']?.expansion);
await page.locator('#controls summary').click();await page.locator('#pieces').fill('12');await page.locator('#pieces').dispatchEvent('change');await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('[impossible-game]').components['impossible-game'].level);
const result=await page.evaluate(async()=>{
 const scene=document.querySelector('a-scene'),g=document.querySelector('[impossible-game]').components['impossible-game'],s=g.expansion,T=AFRAME.THREE;
 scene.pause();for(const el of scene.querySelectorAll('[crossbar-menu]'))el.components['crossbar-menu']?.menu.close();
 const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 const a={id:'a',kind:'room',template:'room-rect',parts:[rect(0,0,2,3)]},b={id:'b',kind:'room',template:'room-rect',parts:[rect(2,0,2,3)]},c={id:'c',kind:'elevator',template:'alcove',parts:[rect(4,1,1,1)]};
 const ab={id:'ab',a:'a',b:'b',p1:{x:2,y:1},p2:{x:2,y:2},normal:{x:1,y:0}},bc={id:'bc',a:'b',b:'c',p1:{x:4,y:1},p2:{x:4,y:2},normal:{x:1,y:0}};
 const level={...g.level,pieces:[a,b,c],doors:[ab,bc],portals:[],closedDoors:['bc'],startPieceId:'a',startPos:{x:1,y:1.5},decoration:{attention:false,switches:false,floorCues:'normal'},seeThrough:{a:[],b:[['ab','bc']],c:[]},visible:{a:['a','b','c'],b:['a','b','c'],c:['a','b','c']},visibleRegions:{}};
 // Three disjoint rectangles with aligned doorways: all three can see one another.
 for(const p of [a,b,c])level.visibleRegions[p.id]={a:a.parts,b:b.parts,c:c.parts};
 g.state.activeId='a';g.state.pos={x:1,y:1.5};s.replaceLevel(level);s.controls.update();g.view.show(g.state);
 await new Promise(r=>setTimeout(r,100));
 const controls=s.controls,button=controls.buttons.find(b=>b.door==='bc'),handle=controls.handles[0];
 if(!button)throw Error('Missing wall call button');
 const mounted=button.ball.tagName==='A-BOX'&&controls.root.querySelectorAll('.call-wire').length===1;
 const before=button.el.object3D.position.clone(),rotation=button.el.object3D.quaternion.clone();
 const gate=()=>g.view.current.children.find(o=>o.userData.door?.id==='bc');
 const beforeVisible=gate()?.visible&&button.el.object3D.visible;
 const rayHitsDoor=()=>{g.world.object3D.updateMatrixWorld(true);const ray=new T.Raycaster(new T.Vector3(g.state.pos.x,1.55,1.5),new T.Vector3(1,0,0));return ray.intersectObject(gate()).length>0;};
 const blockedBefore=rayHitsDoor();
 const w=s.walker;w.transform.reset();w.resetSamples();let time=0;
 const walk=x=>{while(Math.abs(g.state.pos.x-x)>.001){const next=g.state.pos.x+Math.sign(x-g.state.pos.x)*Math.min(.025,Math.abs(x-g.state.pos.x));const r=w.sample({x:next,y:1.5},-Math.PI/2,time+=20,g.state,true);if(!r.valid)throw Error('Unexpected blocked doorway');}controls.update();g.view.show(g.state);};
 walk(3);const closedAfter=g.state.activeId==='b'&&gate().visible&&rayHitsDoor()&&level.closedDoors.includes('bc');
 const stableControl=button===controls.buttons.find(b=>b.door==='bc')&&before.equals(button.el.object3D.position)&&rotation.equals(button.el.object3D.quaternion)&&handle===controls.handles[0];
 // Place the tracked preview camera within reach and press the actual mounted button.
 const p=button.el.object3D.position;g.rig.object3D.position.set(p.x-.3,0,p.z);scene.object3D.updateMatrixWorld(true);button.ball.emit('click');controls.update();g.view.show(g.state);
 const opened=!gate().visible&&!level.closedDoors.includes('bc');walk(1);walk(3);
 const staysOpen=!gate().visible&&!level.closedDoors.includes('bc')&&button===controls.buttons.find(b=>b.door==='bc');
 g.rig.object3D.position.set(2.7,0,1.5);g.camera.object3D.rotation.set(0,-Math.PI/2,0);scene.object3D.updateMatrixWorld(true);scene.renderer.render(scene.object3D,g.camera.getObject3D('camera'));
 return {mounted,beforeVisible,blockedBefore,closedAfter,stableControl,opened,staysOpen};
});if(process.env.VR_SCREENSHOT_PATH)await page.screenshot({path:process.env.VR_SCREENSHOT_PATH});for(const [k,v]of Object.entries(result))assert.equal(v,true,k);assert.deepEqual(errors,[]);console.log(result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
