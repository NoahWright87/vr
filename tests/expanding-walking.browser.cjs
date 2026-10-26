const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.VR_TEST_URL||'http://127.0.0.1:8088')+'/games/expanding-rooms/');
 await page.waitForFunction(()=>document.querySelector('#setup-panel')?.components['crossbar-menu']);
 const result=await page.evaluate(async()=>{
  const scene=document.querySelector('a-scene'),g=document.querySelector('[impossible-game]').components['impossible-game'],s=g.expansion;
  const c=document.querySelector('#setup-panel').components['crossbar-menu'];
  const click=(c,id)=>{c.menu.refresh();const i=c.menu.level().items.findIndex(x=>x.id===id);if(i<0)throw Error('Missing '+id);c.menu.moveFocus(i-c.menu.level().index);c.focusedSlot().el.emit('click');};
  click(c,'expand-boundary');scene.components['expanding-lobby'].tick();click(c,'generate-current');
  for(let i=0;i<6000&&!g.level;i++)await new Promise(r=>setTimeout(r,10));if(!g.level)throw Error(g.message+' '+g.detail);
  s.tick();const walkingOnly=g.level.params.walkingOnly===true,zeroLifts=g.level.portals.length===0&&g.level.pieces.every(p=>p.kind!=='elevator');
  const halls=g.level.pieces.filter(p=>p.kind==='hall');
  const connectsRooms=halls.length>4&&halls.every(p=>g.level.doors.filter(d=>d.a===p.id||d.b===p.id).length===2);
  const noLiftEntities=!s.controls&&!document.querySelector('[lift-pull]');
  const visor=scene.systems['visor-menu'].component;visor.menu.open();visor.menu.reset();click(visor,'experiments');
  const noLiftExperiments=!visor.menu.level().items.some(i=>['expand:experiments:growOnRide','expand:experiments:adaptiveRooms'].includes(i.id));
  visor.menu.back();click(visor,'debug');const noRideAction=!visor.menu.level().items.some(i=>i.id==='expand-ride');
  s.observeFrame(1000/72);const stats=s.describe(),diagnostics=stats.includes('fps')&&stats.includes('Walking CPU')&&stats.includes('Draw calls');
  const w=s.walker;w.experiments={routes:true,translation:false};w.reanchor(g.state.pos,g.state);w.sample(g.state.pos,0,0,g.state,true);let plans=0;
  const original=w.redirection.planner.sample.bind(w.redirection.planner);w.redirection.planner.sample=(...args)=>{plans++;return original(...args);};
  for(let i=1;i<=90;i++)w.sample(g.state.pos,i*.01,i*1000/90,g.state,true);
  const pausedDoesNotPlan=plans===0;
  visor.menu.reset();click(visor,'expand-exit');scene.components['expanding-lobby'].tick();
  const exited=!g.level&&!s.walker&&!!g.manualBoundary&&document.querySelector('#setup-lobby').object3D.visible;
  return {walkingOnly,zeroLifts,connectsRooms,noLiftEntities,noLiftExperiments,noRideAction,diagnostics,pausedDoesNotPlan,exited};
 });for(const [key,value]of Object.entries(result))assert.equal(value,true,key);assert.deepEqual(errors,[]);console.log(result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
