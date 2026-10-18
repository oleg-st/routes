import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(Error(`Server exited ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.locator('#dungeon').selectOption('Level.ID.UrrakMarkets');await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#markers > g:has(.boss-ring) text').count(),0,'bosses do not have a redundant badge');
    const marker=page.locator('#markers > g').first(),ring=marker.locator('.mob-ring'),handle=await marker.elementHandle();
    const original=await ring.boundingBox(),view=await page.locator('#map').getAttribute('viewBox');
    await page.mouse.move(700,550);await page.mouse.down({button:'right'});
    await page.mouse.move(850,610,{steps:20});await page.mouse.up({button:'right'});
    assert.ok(await handle.evaluate(node=>node.isConnected),'panning reuses existing marker nodes');
    const shifted=await ring.boundingBox();
    assert.ok(Math.abs(shifted.x-original.x-150)<1);
    assert.ok(Math.abs(shifted.y-original.y-60)<1);
    assert.ok(Math.abs(shifted.width-original.width)<.01);
    assert.notEqual(await page.locator('#map').getAttribute('viewBox'),view);
    // Selection still follows the moved on-screen icon.
    await page.mouse.click(shifted.x+shifted.width/2,shifted.y+shifted.height/2);
    assert.ok(await page.locator('#markers .assigned-ring').count()>0);
    // Zoom must still rebuild the layout and grow portraits after panning.
    const diameter=await ring.evaluate(node=>node.getBoundingClientRect().width);
    await page.locator('#map').dispatchEvent('wheel',{deltaY:-100,clientX:700,clientY:550});
    assert.ok((await ring.boundingBox()).width>diameter);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Marker UI passed in server and local modes: pan preserves nodes and size, hit testing follows screen positions, zoom updates layout.');
}finally{await browser?.close();server.kill();}
