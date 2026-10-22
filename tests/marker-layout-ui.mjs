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
    const empowered=page.locator('#empowered');
    if(await empowered.isEnabled()&&await empowered.getAttribute('aria-pressed')==='false')await empowered.click();
    await page.mouse.move(0,0);
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
    // Zoom updates layout/size while retaining the SVG nodes and images.
    const diameter=await ring.evaluate(node=>node.getBoundingClientRect().width);
    const zoomHandle=await marker.elementHandle(),portrait=await marker.locator('image').elementHandle();
    await page.locator('#map').dispatchEvent('wheel',{deltaY:-100,clientX:700,clientY:550});
    assert.ok((await ring.boundingBox()).width>diameter);
    assert.ok(await zoomHandle.evaluate(node=>node.isConnected),'zoom keeps marker nodes');
    if(portrait)assert.ok(await portrait.evaluate(node=>node.isConnected),'zoom keeps portrait images');
    // The focus halo deliberately pulses; compare the actual map geometry.
    const geometry=()=>page.evaluate(()=>[...document.querySelectorAll('#markers circle:not(.mob-focus-ring),#markers image,#status-badges circle,#status-badges image,#map-start circle')].map(node=>{
      const box=node.getBoundingClientRect();return [box.x,box.y,box.width,box.height];
    }));
    const compare=(actual,expected,label)=>{
      assert.equal(actual.length,expected.length,label+' shape count');
      actual.forEach((shape,i)=>shape.forEach((value,j)=>assert.ok(Math.abs(value-expected[i][j])<.01,`${label}: shape ${i}, coordinate ${j}`)));
    };
    const immediate=await geometry();
    await page.waitForTimeout(300);
    compare(await geometry(),immediate,'no marker movement after wheel stops');
    // A full render at the same camera must produce the exact same geometry,
    // including rings, portrait sizes and status badges at different icon sizes.
    for(const icons of [true,false]){
      await page.locator('#show-mob-icons').evaluate((node,checked)=>{node.checked=checked;node.dispatchEvent(new Event('input'));},icons);
      await page.locator('#marker-size').evaluate(node=>{node.value='10';node.dispatchEvent(new Event('input'));});
      for(const deltaY of [-100,-100,100]){
        const saved=await marker.elementHandle();
        await page.locator('#map').dispatchEvent('wheel',{deltaY,clientX:700,clientY:550});
        assert.ok(await saved.evaluate(node=>node.isConnected),'repeated zoom retains marker nodes');
        const fast=await geometry();
        await page.locator('#marker-size').dispatchEvent('input');
        compare(await geometry(),fast,'cached geometry equals a full render');
      }
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Marker UI passed in server and local modes: zoom reuses nodes, geometry matches full rendering, no settling jumps, and pan/hit testing stays correct.');
}finally{await browser?.close();server.kill();}
