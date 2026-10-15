import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    const save=page.locator('#save-route'),remove=page.locator('#delete-route'),name=page.locator('#route-name');
    assert.equal(await name.inputValue(),'Route 1');assert.ok(await save.isDisabled());assert.ok(await remove.isHidden());
    assert.equal(await page.locator('.route-heading').count(),0);
    for(const width of [1440,1000,390]){
      await page.setViewportSize({width,height:1000});
      const centers=await page.locator('.pull-list-heading > .eyebrow, #add-pull, #undo, #redo').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return r.y+r.height/2;}));
      assert.ok(Math.max(...centers)-Math.min(...centers)<1,'Pull heading controls align vertically');
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#add-pull').click();assert.ok(await save.isEnabled());
    await page.locator('#undo').click();assert.ok(await save.isDisabled());
    await page.locator('#redo').click();await page.locator('#add-pull').click();
    await save.click();await page.waitForFunction(()=>document.querySelector('#save-route').disabled);assert.ok(await save.isDisabled());assert.ok(await remove.isVisible());
    await name.fill('Renamed');assert.ok(await save.isEnabled());
    await name.press('Tab');await page.locator('#undo').click();assert.ok(await save.isDisabled());
    await page.locator('#shadow').click();
    await page.locator('[data-placement]').first().dispatchEvent('click');
    assert.equal(await page.locator('#shadow').getAttribute('aria-pressed'),'true');
    assert.ok(await save.isEnabled());await save.click();await page.waitForFunction(()=>document.querySelector('#save-route').disabled);
    await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.ok(await save.isDisabled(),'Saved state remains clean after reload');
    await page.locator('[data-tool="line"]').click();
    const map=await page.locator('#map').boundingBox();
    await page.mouse.click(map.x+map.width*.4,map.y+map.height*.4);
    await page.mouse.click(map.x+map.width*.6,map.y+map.height*.6);
    assert.equal(await page.locator('#drawings > g').count(),1);assert.ok(await save.isEnabled());
    await save.click();await page.waitForFunction(()=>document.querySelector('#save-route').disabled);assert.ok(await save.isDisabled(),'Saved drawings compare by content');
    await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.ok(await save.isDisabled());
    await page.locator('.sidebar').screenshot({path:'tmp/route-sidebar.png'});
    await page.locator('#clear-route').click();
    assert.equal(await page.locator('#pull-count').textContent(),'0');assert.equal(await page.locator('#drawings > g').count(),0);
    assert.equal(await page.locator('#shadow').getAttribute('aria-pressed'),'false');assert.ok(await save.isEnabled());
    await page.locator('#undo').click();assert.equal(await page.locator('#pull-count').textContent(),'3');assert.equal(await page.locator('#drawings > g').count(),1);assert.ok(await save.isDisabled());
    await page.locator('#redo').click();await save.click();await page.waitForFunction(()=>document.querySelector('#save-route').disabled);assert.ok(await save.isDisabled());
    await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#pull-count').textContent(),'0');assert.ok(await save.isDisabled());
    await page.locator('[data-placement]').first().dispatchEvent('click');assert.equal(await page.locator('#pull-count').textContent(),'1');assert.ok(await save.isEnabled());
    await save.click();await page.waitForFunction(()=>document.querySelector('#save-route').disabled);await remove.click();await page.locator('#restore-saved').waitFor();assert.ok(await remove.isHidden());assert.ok(await save.isEnabled());
    assert.equal(await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('fellowship-route-together');request.onsuccess=()=>{const db=request.result,tx=db.transaction('bookmarks');tx.objectStore('bookmarks').count().onsuccess=e=>resolve(e.target.result);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);})),0);
    await page.locator('#restore-saved').click();await page.locator('#close-dialog').click();assert.ok(await remove.isVisible());assert.ok(await save.isDisabled());
    await page.locator('#new-route').click();await page.waitForFunction(n=>document.querySelector('#route-name').value==='Route '+n,2);assert.equal(await name.inputValue(),'Route 2');assert.ok(await save.isDisabled());assert.ok(await remove.isHidden());
    await page.locator('#new-route').click();await page.waitForFunction(n=>document.querySelector('#route-name').value==='Route '+n,3);assert.equal(await name.inputValue(),'Route 3');
    await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.locator('#new-route').click();await page.waitForFunction(n=>document.querySelector('#route-name').value==='Route '+n,4);assert.equal(await name.inputValue(),'Route 4');
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Route UI checks passed in server and local modes: layout, naming, save state, clear/undo/reload, deletion/restore.');
}finally{await browser?.close();server.kill();}
