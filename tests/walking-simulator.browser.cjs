const {chromium}=require(process.env.VR_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const base=process.env.VR_TEST_URL||'http://127.0.0.1:8088';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base+'/');
    const home=await page.evaluate(()=>{
      const heading=[...document.querySelectorAll('h2')].find(el=>el.textContent==='Dev Tools');
      const links=[...document.querySelectorAll('a')].filter(el=>el.getAttribute('href')?.includes('/playground/')||el.getAttribute('href')?.includes('/simulator/'));
      return {heading:!!heading,links:links.length,after:!!heading&&links.every(el=>!!(heading.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))};
    });
    assert.deepEqual(home,{heading:true,links:2,after:true});
    await page.goto(base+'/games/expanding-rooms/simulator/');
    await page.fill('#scales','1, 1.5');await page.fill('#seconds','30');await page.selectOption('#rate','0');
    await page.click('#run');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Finished 2 episodes'),{},{timeout:30000});
    assert.equal(await page.locator('#results tr').count(),2);
    assert.match(await page.locator('#results').innerText(),/completed/);
    assert.match(await page.locator('#results').innerText(),/boundary-stop/);
    const downloadPromise=page.waitForEvent('download');await page.click('#export');const download=await downloadPromise;
    const report=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(report.version,1);assert.equal(report.results.length,2);assert.equal(report.config.scales.length,2);
    // Replay uses the worker again, not a second implementation of navigation.
    await page.locator('#results button').first().click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Replay ready'));
    assert.equal(await page.locator('#replay').isVisible(),true);
    await page.locator('#scrub').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.match(await page.locator('#telemetry').innerText(),/boundary-stop/);
    if(process.env.VR_SCREENSHOT_PATH)await page.screenshot({path:process.env.VR_SCREENSHOT_PATH,fullPage:true});
    // Imported headless JSONL uses the same result/replay path.
    const jsonl=JSON.stringify({type:'config',version:1,config:report.config})+'\n'+report.results.map(result=>JSON.stringify({type:'result',result})).join('\n')+'\n';
    await page.setInputFiles('#load',{name:'partial-overnight.jsonl',mimeType:'application/json',buffer:Buffer.from(jsonl)});
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Loaded 2'));
    // Pause and stop a live fixed-step run, preserving only completed episodes.
    await page.fill('#scales','1.25');await page.selectOption('#rate','1');await page.click('#run');
    await page.waitForFunction(()=>document.querySelector('#telemetry').textContent.includes('walking / scanning'));
    await page.click('#pause');await page.waitForTimeout(250);const paused=await page.locator('#telemetry').innerText();
    await page.waitForTimeout(350);assert.equal(await page.locator('#telemetry').innerText(),paused);
    await page.click('#pause');await page.click('#stop');assert.match(await page.locator('#status').innerText(),/unfinished episode is not counted/);
    await page.fill('#scales','NaN');await page.click('#run');assert.match(await page.locator('#status').innerText(),/scales must contain/);
    // Mobile controls remain reachable with no page-level horizontal overflow.
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({home,episodes:report.results.map(r=>r.outcome),replay:true,import:true,pause:true,mobile:true}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
