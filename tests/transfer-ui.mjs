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
    page.on('pageerror',error=>errors.push(error.message));
    await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedText=text;}}}));
    const ready=async()=>page.locator('#map-loading').waitFor({state:'hidden'});
    const exported=async()=>{await page.locator('#export').click();return JSON.parse(await page.evaluate(()=>window.copiedText));};
    const paste=async text=>{await page.locator('#import').click();await page.locator('#import-route-text').fill(text);await page.locator('#import-route-button').click();};
    await page.goto(url);await ready();
    await page.locator('#route-name').fill('Маршрут #1 — 🐉 & 50%');
    await page.locator('#add-pull').click();
    const source=await exported();assert.equal(source.pulls.length,2);
    source.pulls[0].note='Строка 1\nСтрока 2 <keep> #?&%';
    await paste(JSON.stringify(source));assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
    const imported=await exported();assert.notEqual(imported.id,source.id);
    assert.deepEqual({...imported,id:source.id},source);
    await page.locator('#share').click();
    const link=await page.evaluate(()=>window.copiedText),shared=new URL(link);
    assert.ok(shared.hash.startsWith('#route='));
    assert.deepEqual(JSON.parse(decodeURIComponent(shared.hash.slice(7))),imported);
    // A new tab must reconstruct the route solely from the link, without stored drafts.
    const other=await context.newPage();await other.goto(link);await other.locator('#map-loading').waitFor({state:'hidden'});
    assert.equal(await other.locator('#route-name').inputValue(),source.name);
    await other.locator('#export').click();
    const restored=JSON.parse(await other.evaluate(()=>window.copiedText));
    assert.deepEqual({...restored,id:imported.id},imported);await other.close();
    await paste(link);assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
    const before=await exported();
    for(const invalid of ['', '{broken', '#route=%ZZ', JSON.stringify({...source,dungeonId:'missing'})]){
      await paste(invalid);assert.equal(await page.locator('#import-error').isVisible(),true);
      await page.locator('#close-dialog').click();assert.deepEqual(await exported(),before);
    }
    const changed={...source,name:'Changed through hash'};
    await page.evaluate(value=>{location.hash='route='+encodeURIComponent(JSON.stringify(value));},changed);
    await page.waitForFunction(()=>document.querySelector('#route-name').value==='Changed through hash');
    await page.evaluate(()=>{location.hash='route=%ZZ';});
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Import:'));
    assert.equal(await page.locator('#route-name').inputValue(),changed.name);
    // Clipboard denial leaves selectable text instead of losing the export.
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Denied');};document.execCommand=()=>false;});
    await page.locator('#export').click();
    assert.equal(JSON.parse(await page.locator('#copy-route-text').inputValue()).name,changed.name);
    assert.equal(await page.locator('#copy-route-text').evaluate(el=>el.selectionEnd-el.selectionStart===el.value.length),true);
    await page.locator('#close-dialog').click();
    await page.locator('#share').click();assert.ok((await page.locator('#copy-route-text').inputValue()).includes('#route='));
    assert.deepEqual(errors,[]);await context.close();
    console.log(`Export, Import, Share, hash loading and clipboard fallback passed: ${url}`);
  }
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
  await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});await page.locator('#export').click();
  assert.equal(JSON.parse(await page.evaluate(()=>navigator.clipboard.readText())).version,2);
  await page.locator('#share').click();assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('#route='));
  await context.close();console.log('Native clipboard Export and Share passed.');
}finally{await browser?.close();server.kill();}
