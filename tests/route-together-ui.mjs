// New editor surfaces: marker lifecycle, path vertices, R2 and gesture recovery.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const url=String(data).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});server.on('error',reject);});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});});
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    const map=await page.locator('#map').boundingBox(),click=(x,y,options)=>page.mouse.click(map.x+x,map.y+y,options);
    await page.locator('[data-tool=marker]').click();await click(400,380);
    await page.locator('#marker-label').fill('Meet here 🐉');await page.locator('#marker-icon').selectOption('star');await page.locator('#place-marker').click();
    const marker=page.locator('#drawings [aria-label=marker]');assert.equal(await marker.locator('title').textContent(),'Meet here 🐉');
    const originalId=await marker.getAttribute('data-drawing');
    await page.mouse.move(map.x+400,map.y+380);await page.mouse.down();await page.mouse.move(map.x+470,map.y+420);await page.mouse.up();
    const moved=await marker.locator('circle').getAttribute('cx');await page.locator('#undo').click();assert.notEqual(await marker.locator('circle').getAttribute('cx'),moved);await page.locator('#redo').click();
    await click(470,420,{button:'right'});await page.getByRole('menuitem',{name:'Edit marker',exact:true}).click();await page.locator('#marker-label').fill('Updated label');await page.locator('#place-marker').click();assert.equal(await marker.locator('title').textContent(),'Updated label');
    await click(470,420,{button:'right'});await page.getByRole('menuitem',{name:'Delete marker',exact:true}).click();assert.equal(await marker.count(),0);await page.locator('#undo').click();assert.equal(await marker.getAttribute('data-drawing'),originalId);
    await page.locator('[data-tool=line]').click();await click(280,220);await click(600,220);
    const arrow=page.locator('#drawings [aria-label=Arrow]'),points=()=>arrow.locator('.annotation-line').getAttribute('points');
    await click(440,220,{button:'right'});await page.getByRole('menuitem',{name:'Add vertex after this point',exact:true}).click();assert.equal((await points()).split(' ').length,3);
    await click(440,220,{button:'right'});await page.getByRole('menuitem',{name:'Remove vertex',exact:true}).click();assert.equal((await points()).split(' ').length,2);await page.locator('#undo').click();
    // Losing focus commits the last drag sample; Escape intentionally cancels it.
    const before=await points();await page.mouse.move(map.x+440,map.y+220);await page.mouse.down();await page.mouse.move(map.x+450,map.y+280);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.notEqual(await points(),before);await page.locator('#undo').click();assert.equal(await points(),before);
    await page.mouse.move(map.x+440,map.y+220);await page.mouse.down();await page.mouse.move(map.x+450,map.y+280);await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await points(),before);
    await page.locator('[data-action=rename]').click();await page.locator('#edit-pull-note').fill('Pull note 🐉');await page.locator('#apply-pull').click();
    await page.locator('#export').click();await page.waitForFunction(()=>window.copied?.startsWith('R2.'));const encoded=await page.evaluate(()=>copied);
    await page.locator('#storage-status[data-state=saved]').waitFor();await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.equal(await marker.getAttribute('data-drawing'),originalId);assert.equal(await marker.locator('title').textContent(),'Updated label');assert.equal((await points()).split(' ').length,3);
    await page.locator('#import').click();await page.locator('#import-route-text').fill(encoded);await page.locator('#import-route-button').click();await page.locator('#dialog').waitFor({state:'hidden'});
    assert.notEqual(await marker.getAttribute('data-drawing'),originalId);assert.equal((await points()).split(' ').length,3);assert.equal(await marker.locator('title').textContent(),'Updated label');
    await page.locator('[data-action=rename]').click();assert.equal(await page.locator('#edit-pull-note').inputValue(),'Pull note 🐉');await page.locator('#close-dialog').click();
    await page.screenshot({path:`tmp/route-together-${url===origin?'server':'local'}.png`});assert.deepEqual(errors,[]);
    console.log(`Markers, vertices, gesture recovery and R2 passed: ${url===origin?'server':'local file'}`);await context.close();
  }
}finally{await browser?.close();server.kill();}
