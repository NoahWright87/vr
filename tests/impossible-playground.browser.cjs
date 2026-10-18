const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),base=process.env.VR_TEST_URL||'http://127.0.0.1:8088';
const inside=(p,polygon)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
(async()=>{
  const browser=await chromium.launch({headless:true});try{
    for(const mobile of [false,true]){
      const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:1050}});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
      await page.goto(base+'/games/impossible-spaces/playground/');await page.waitForFunction(()=>document.querySelector('#map')?.dataset.phase==='edit');await page.waitForTimeout(150);
      const exported=async()=>{const next=page.waitForEvent('download');await page.locator('#export').click();const stream=await(await next).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString());};
      const starter=await exported();assert.equal(starter.boundary,null);assert.ok(starter.paint.cells.length>10000);assert.equal(await page.locator('#generate').isDisabled(),true);
      const transform=await page.locator('#map').evaluate(el=>{const r=el.getBoundingClientRect();return {scale:Math.min(130,(r.width-55)/6,(r.height-70)/6),width:r.width,height:r.height};});
      assert.equal(await page.locator('[data-tool="corners"]').count(),0);assert.equal(await page.locator('#add-area').count(),0);
      assert.equal(await page.locator('[data-tool="paint"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#target').getAttribute('max'),null);
      const cdp=mobile?await context.newCDPSession(page):null;
      const shape=[[-3,-2],[3,-2],[3,0],[2,0],[2,3],[-3,3]],draw=async()=>{
        await page.locator('#map').scrollIntoViewIfNeeded();const box=await page.locator('#map').boundingBox();
        const screen=([x,y])=>({x:box.x+transform.width/2+x*transform.scale,y:box.y+transform.height/2+y*transform.scale});
        const points=[];for(let i=0;i<shape.length;i++){
          const a=shape[i],b=shape[(i+1)%shape.length],n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/.15);
          for(let j=0;j<n;j++)points.push(screen([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]));
        }points.push(screen(shape[0]));
        if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
          for(const p of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p]});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        }else{await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(p.x,p.y);await page.mouse.up();}
      };
      await draw();const extended=await exported();assert.ok(extended.paint.cells.length>starter.paint.cells.length*1.8);
      await page.locator('#undo').click();assert.deepEqual((await exported()).paint.cells,starter.paint.cells);
      await draw();await page.locator('#reset').click();assert.deepEqual((await exported()).paint.cells,starter.paint.cells);await page.locator('#undo').click();assert.deepEqual(new Set((await exported()).paint.cells),new Set(extended.paint.cells));
      await page.locator('#review').click();assert.equal(await page.locator('#map').getAttribute('data-phase'),'review');assert.equal(await page.locator('#generate').isDisabled(),true);
      await page.locator('#confirm').click();assert.equal(await page.locator('#map').getAttribute('data-phase'),'ready');const confirmed=await exported();assert.ok(confirmed.boundary.length>4);assert.equal(inside({x:2.8,y:2.7},confirmed.boundary),false);
      await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('8 rooms'));
      const first=await exported();assert.equal(first.level.params.generationStyle,'rooms-first');assert.equal(first.level.pieces.filter(p=>p.kind==='room').length,8);
      const minX=Math.min(...first.boundary.map(p=>p.x)),minY=Math.min(...first.boundary.map(p=>p.y));assert.deepEqual(first.level.params.footprint,first.boundary.map(p=>({x:p.x-minX,y:p.y-minY})));
      await page.locator('#target').fill('100');await page.locator('#generate').click();
      await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('100 rooms'));
      const large=await exported();assert.equal(large.level.pieces.filter(p=>p.kind==='room').length,100);
      await page.locator('#target').fill('8');await page.locator('#generate').click();
      await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('8 rooms'));
      // Real keyboard and held pointer controls move through shared collision.
      await page.locator('#map').focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(140);await page.keyboard.up('ArrowRight');const moved=await exported();assert.ok(Math.hypot(moved.player.position.x-first.player.position.x,moved.player.position.y-first.player.position.y)>.03);
      const cabin=first.level.pieces.find(p=>p.kind==='elevator');assert.ok(cabin);await page.locator('#piece').selectOption(cabin.id);await page.waitForFunction(()=>!document.querySelector('#ride-next').disabled);
      const beforeRide=await exported();await page.locator('#ride-next').click();await page.waitForFunction(id=>document.querySelector('#map').dataset.activePiece!==id,cabin.id,{timeout:6000});await page.waitForFunction(()=>!document.querySelector('#ride-next').textContent.startsWith('Doors'));
      const afterRide=await exported();assert.deepEqual(afterRide.player.position,beforeRide.player.position);assert.notEqual(afterRide.player.piece,beforeRide.player.piece);
      await page.locator('#view').selectOption('inspect');assert.equal(await page.locator('#layer-label').isVisible(),true);await page.locator('#layer').selectOption({index:1});
      await page.locator('#new-seed').click();await page.waitForFunction(()=>!document.querySelector('#generate').disabled);const reseeded=await exported();assert.equal(reseeded.level.params.seed,43);assert.deepEqual(reseeded.boundary,first.boundary);
      await page.locator('#style').selectOption('growth');const notRegenerated=await exported();assert.equal(notRegenerated.level.params.generationStyle,'rooms-first');assert.equal(await page.locator('#target').inputValue(),'12');
      await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('target pieces'));const growth=await exported();assert.equal(growth.level.params.generationStyle,'growth');assert.deepEqual(growth.level.params.footprint,first.level.params.footprint);
      // Save/load is a public reproduction path; loading does not trust a saved level.
      await page.locator('#import').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(first))});assert.equal(await page.locator('#map').getAttribute('data-phase'),'ready');assert.equal((await exported()).level,null);
      await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":999}')});assert.match(await page.locator('#status').innerText(),/Could not load/);assert.deepEqual((await exported()).boundary,first.boundary);
      await page.reload();await page.waitForFunction(()=>document.querySelector('#map')?.dataset.phase==='ready');assert.equal(await page.locator('#seed').inputValue(),'42');
      assert.match(await page.locator('#status').innerText(),/Saved boundary restored/);
      await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('8 rooms'));const restored=await exported();assert.deepEqual(restored.level,first.level);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.VR_SCREENSHOT_DIR){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:process.env.VR_SCREENSHOT_DIR+(mobile?'/playground-phone.png':'/playground-desktop.png'),fullPage:true});}
      // Reopen the accepted area and add another painted patch.
      await page.locator('#edit-boundary').click();await page.locator('[data-tool="paint"]').click();await page.locator('#map').scrollIntoViewIfNeeded();
      const paintBefore=(await exported()).paint.cells.length;await page.locator('#map').scrollIntoViewIfNeeded();const paintBox=await page.locator('#map').boundingBox();
      await page.mouse.move(paintBox.x+paintBox.width/2,paintBox.y+paintBox.height/2);await page.mouse.down();await page.mouse.move(paintBox.x+paintBox.width*.94,paintBox.y+paintBox.height*.4,{steps:12});await page.mouse.up();assert.ok((await exported()).paint.cells.length>paintBefore);
      // An invalid/unfinished setting is not allowed to destroy the saved floor.
      await page.locator('#target').fill('');await page.locator('#target').dispatchEvent('change');await page.reload();await page.waitForFunction(()=>document.querySelector('#map')?.dataset.phase==='edit');
      assert.ok((await exported()).paint.cells.length>paintBefore);
      assert.deepEqual(errors,[]);console.log(JSON.stringify({mobile,starterCells:starter.paint.cells.length,expandedCells:extended.paint.cells.length,corners:first.boundary.length,rooms:8,largeTarget:100,stationaryRide:true,roundTrip:true}));await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
