const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.VR_TEST_URL||'http://127.0.0.1:8088')+'/games/expanding-rooms/');
 await page.waitForFunction(()=>document.querySelector('a-scene')?.components['expanding-room-hud']?.widget);
 const startup=await page.evaluate(()=>{
  const scene=document.querySelector('a-scene'),hud=scene.systems['visor-hud'];
  // Exercise the same first-headset-entry handler without requiring a real XR device.
  hud.onEnterVr();hud.tick(100,16);
  return {noAutomaticBoxes:!hud.firstRunUntil&&!hud.previewLines.visible&&hud.previewWidgets.every(w=>!w.mesh.visible),noLobbyMap:!hud.get('expanding-room-map').visible,firstRunDisabled:!hud.data.firstRunHint};
 });
 for(const [key,value]of Object.entries(startup))assert.equal(value,true,key);
 await page.locator('#controls summary').click();await page.locator('#pieces').fill('12');await page.locator('#pieces').dispatchEvent('change');await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('[impossible-game]').components['impossible-game'].level,null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('a-scene').systems['visor-hud'].get('expanding-room-map').mesh.visible,null,{timeout:5000}).catch(async e=>{console.log(errors);console.log(await page.evaluate(()=>{const s=document.querySelector('a-scene'),w=s.systems['visor-hud'].get('expanding-room-map');return {visible:w.visible,rect:w.rect,opacity:w.opacity,state:Object.keys(w.state),prefs:s.systems['visor-hud'].prefs,side:s.systems['visor-hud'].menuSide};}));throw e;});
 const result=await page.evaluate(async()=>{
  const scene=document.querySelector('a-scene'),g=document.querySelector('[impossible-game]').components['impossible-game'],c=scene.components['expanding-room-hud'],hud=scene.systems['visor-hud'],w=c.widget;
  const initial={rightSlot:w.slot==='top-right',named:!!w.state.title&&w.state.piece.id===g.state.activeId,noFloatingLabels:!g.view.current.children.some(o=>o.isSprite)&&!document.querySelector('#head-status').object3D.visible,debugMapHidden:document.querySelector('#map').hidden};
  const name=w.state.title,first=g.state.activeId,second=g.level.pieces.find(p=>p.id!==first);
  g.state.activeId=second.id;g.state.pos={...second.parts[0][0]};c.tick(10000);
  const followsRoom=w.state.piece.id===second.id&&w.state.title!==name;
  const before=w.state.direction;g.camera.object3D.rotation.y+=.8;scene.object3D.updateMatrixWorld(true);c.tick(10200);
  const followsLook=Math.hypot(w.state.direction.x-before.x,w.state.direction.z-before.z)>.2;
  const visor=scene.systems['visor-menu'].component;
  const click=id=>{visor.menu.refresh();const i=visor.menu.level().items.findIndex(x=>x.id===id);if(i<0)throw Error('Missing row '+id);visor.menu.moveFocus(i-visor.menu.level().index);visor.focusedSlot().el.emit('click');};
  visor.menu.open();visor.menu.reset();click('visor-settings');click('visor-adjust');scene.systems['visor-menu'].updateExtras();hud.tick(10400,100);
  const manualAdjustment=hud.previewOn.frame&&hud.previewLines.visible;
  visor.menu.close();scene.systems['visor-menu'].updateExtras();hud.tick(10600,100);
  const previewCloses=!hud.previewOn.frame&&!hud.previewLines.visible;
  visor.menu.open();visor.menu.reset();click('visor-settings');click('visor-hud');click('visor-hud-on');
  const honorsHide=!hud.prefs.hud;click('visor-hud-on');visor.menu.close();scene.systems['visor-menu'].updateExtras();
  g.state.activeId=first;g.state.pos={...g.level.startPos};g.rig.object3D.position.set(g.state.pos.x,0,g.state.pos.y);g.camera.object3D.rotation.set(0,0,0);scene.object3D.updateMatrixWorld(true);c.tick(11000);w.draw(11000);
  const data=w.ctx.getImageData(0,0,w.canvas.width,w.canvas.height).data;
  const painted=data.some((value,index)=>index%4===3&&value>0);
  g.outside=true;c.tick(11200);const hidesOutside=!w.visible;g.outside=false;c.tick(11400);
  g.status('Tracking paused','Wait for headset tracking to return.');const keepsWarnings=document.querySelector('#head-status').object3D.visible;g.showRoomStatus();
  return {...initial,followsRoom,followsLook,manualAdjustment,previewCloses,honorsHide,painted,hidesOutside,keepsWarnings};
 });for(const [key,value]of Object.entries(result))assert.equal(value,true,key);
 await page.waitForTimeout(600);
 if(process.env.VR_SCREENSHOT_PATH)await page.screenshot({path:process.env.VR_SCREENSHOT_PATH});
 const cleared=await page.evaluate(()=>{const scene=document.querySelector('a-scene'),g=document.querySelector('[impossible-game]').components['impossible-game'];g.clearLevel();scene.components['expanding-room-hud'].tick(12000);return !scene.systems['visor-hud'].get('expanding-room-map').visible;});
 assert.equal(cleared,true,'map hides on exit');assert.deepEqual(errors,[]);console.log({...startup,...result,cleared});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
