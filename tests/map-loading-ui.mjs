import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage(),errors=[],pending=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/\/(?:images\/dungeons|private\/images-referenced)\//,route=>{pending.push(route);});
  const request=async()=>{
    await page.waitForFunction(()=>document.querySelector('#map')?.getAttribute('aria-busy')==='true');
    const deadline=Date.now()+10000;
    while(!pending.length){if(Date.now()>deadline)throw new Error('No map request');await new Promise(resolve=>setTimeout(resolve,20));}
    return pending.shift();
  };
  const hidden=async()=>{
    assert.ok(await page.locator('#map-loading').isVisible());
    assert.ok(await page.locator('#map').isHidden());
    assert.ok(await page.locator('#markers > g').count()>0,'Markers are prepared during loading');
    assert.ok(await page.locator('#markers > g').first().isHidden(),'Prepared enemies must not appear before the map');
  };
  const ready=async()=>{
    await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.ok(await page.locator('#map').isVisible());
    assert.ok(await page.locator('#markers > g').first().isVisible());
    assert.equal(await page.locator('#map').getAttribute('aria-busy'),'false');
  };
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const initial=await request();await hidden();await initial.continue();await ready();

  // Hold two successive selections and finish the older request first.
  const options=await page.locator('#dungeon option').evaluateAll(options=>options.map(option=>option.value));
  const current=await page.locator('#dungeon').inputValue(),targets=options.filter(id=>id!==current);
  await page.locator('#dungeon').selectOption(targets[0]);
  const older=await request();await hidden();
  await page.evaluate(()=>{window.previousMapImage=document.querySelector('#map-image');});
  await page.locator('#dungeon').selectOption(targets[1]);
  const latest=await request(),path=await page.locator('#map-image').getAttribute('href');await hidden();
  await older.continue();
  await page.evaluate(()=>{window.previousMapImage.dispatchEvent(new Event('load'));window.previousMapImage.dispatchEvent(new Event('error'));});
  await hidden();assert.equal(await page.locator('#map-image').getAttribute('href'),path);
  await latest.continue();await ready();

  // Failed backgrounds keep the overlays hidden; the next selection recovers.
  await page.locator('#dungeon').selectOption(targets[2]);
  const failed=await request();await failed.abort();
  await page.waitForFunction(()=>document.querySelector('#map-loading').textContent.startsWith('Unable to load map'));
  await hidden();
  await page.locator('#dungeon').selectOption(targets[3]);
  const recovery=await request();await recovery.continue();await ready();

  // Floor switches use the same loading boundary as dungeon switches.
  await page.locator('#layers').click();await page.locator('#show-floor-panel').check();await page.locator('#layers').click();
  await page.locator('[data-floor="1"]').click();
  const floor=await request();await hidden();await floor.continue();await ready();
  assert.deepEqual(errors,[]);
  console.log('Map loading UI checks passed: initial load, dungeon/floor switches, stale events, failure and recovery.');
}finally{await browser?.close();server.kill();}
