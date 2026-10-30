import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{
    server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
    server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));
  });
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    const id=await page.locator('#markers > g[data-placement]').first().getAttribute('data-placement');
    const mob=()=>page.locator(`#markers > g[data-placement="${id}"]`);
    const open=()=>mob().press('Shift+F10');
    const add=()=>page.getByRole('menuitem',{name:'Add only this mob',exact:true}).click();
    const remove=()=>page.getByRole('menuitem',{name:'Remove only this mob',exact:true}).click();
    const selected=()=>page.locator('#markers .assigned-ring').count();
    await open();
    assert.equal(await page.locator('[data-enemy-action="remove-single"]').count(),0);
    assert.equal(await page.locator('[data-enemy-action="add-single"]').evaluate(e=>getComputedStyle(e).paddingLeft),await page.locator('[data-enemy-action="info"]').evaluate(e=>getComputedStyle(e).paddingLeft));
    await add();assert.equal(await selected(),1);
    await page.locator('#undo').click();assert.equal(await selected(),0);
    await page.locator('#redo').click();assert.equal(await selected(),1);
    await open();await remove();assert.equal(await selected(),0);
    await mob().dispatchEvent('click');const packCount=await selected();assert.ok(packCount>1);
    await open();await remove();assert.equal(await selected(),packCount-1);
    assert.equal(await mob().locator('.assigned-ring').count(),0);
    await page.locator('#undo').click();assert.equal(await selected(),packCount);
    await page.locator('#add-pull').click();
    await open();
    assert.equal(await page.locator('[data-enemy-action="add-single"]').count(),0,'a mob assigned to another pull offers only removal');
    await remove();assert.equal(await selected(),packCount-1);
    await open();await add();assert.equal(await selected(),packCount,'remove then add moves only one mob');
    const counts=()=>page.locator('.pull-card .pull-mob-count').allTextContents();
    assert.match((await counts())[0],new RegExp(`^${packCount-1} mobs?`));
    assert.match((await counts())[1],/^1 mob\b/);
    // Removing a mob also works when its owner is not the active pull.
    await page.locator('.pull-card').first().click();await open();await remove();
    assert.equal(await selected(),packCount-1);assert.match((await counts())[1],/^0 mobs\b/);
    await page.locator('#undo').click();assert.equal(await selected(),packCount);
    await page.locator('#save-route').click();await page.waitForFunction(()=>document.querySelector('#save-route').disabled);
    await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.equal(await selected(),packCount);assert.match((await counts())[1],/^1 mob\b/);
    await page.locator('#clear-route').click();assert.equal(await page.locator('.pull-card').count(),0);
    await open();await add();assert.equal(await selected(),1);assert.equal(await page.locator('.pull-card').count(),1);
    await page.locator('#undo').click();assert.equal(await selected(),0);assert.equal(await page.locator('.pull-card').count(),0);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Single-mob menu passed in server and local modes: partial packs, moves, undo/redo, save/reload and empty routes.');
}finally{await browser?.close();server.kill();}
