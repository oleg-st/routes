import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import fs from 'node:fs';
import {encodeRoute,decodeRoute} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';

const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json')).map(correctDungeon);
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const encode=route=>encodeRoute(route,dungeons.find(d=>d.id===route.dungeonId));
const decode=text=>decodeRoute(text,dungeons,enemies);
const content=route=>JSON.parse(JSON.stringify(route,(key,value)=>key==='id'?undefined:value));
const copied=async(page,selector)=>{
  await page.evaluate(()=>{window.copiedText=null;});await page.locator(selector).click();
  await page.waitForFunction(()=>typeof window.copiedText==='string');
  return page.evaluate(()=>window.copiedText);
};

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
    const exported=async()=>decode(await copied(page,'#export'));
    const paste=async text=>{
      await page.locator('#import').click();await page.locator('#import-route-text').fill(text);await page.locator('#import-route-button').click();
      await page.waitForFunction(()=>!document.querySelector('#dialog').open||!document.querySelector('#import-error').hidden);
    };
    await page.goto(url);await ready();
    await page.locator('#route-name').fill('Маршрут #1 — 🐉 & 50%');
    await page.locator('#add-pull').click();
    const source=await exported();assert.equal(source.pulls.length,2);
    source.pulls[0].note='Строка 1\nСтрока 2 <keep> #?&%';
    await paste(await encode(source));assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
    const imported=await exported();
    assert.deepEqual(content(imported),content(source));
    const link=await copied(page,'#share'),shared=new URL(link);
    assert.ok(shared.hash.startsWith('#route=R3.'));
    assert.deepEqual(content(await decode(link)),content(imported));
    // A new tab must reconstruct the route solely from the link, without stored drafts.
    const other=await context.newPage();await other.goto(link);await other.locator('#map-loading').waitFor({state:'hidden'});
    await other.waitForFunction(name=>document.querySelector('#route-name').value===name,source.name);
    const restored=await decode(await copied(other,'#export'));
    assert.deepEqual(content(restored),content(imported));await other.close();
    await paste(link);assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
    const before=await exported();
    for(const invalid of ['', 'R1.broken', '#route=%ZZ', JSON.stringify(source)]){
      await paste(invalid);assert.equal(await page.locator('#import-error').isVisible(),true);
      await page.locator('#close-dialog').click();assert.deepEqual(content(await exported()),content(before));
    }
    const changed={...source,name:'Changed through hash'};
    await page.evaluate(value=>{location.hash='route='+value;},await encode(changed));
    await page.waitForFunction(()=>document.querySelector('#route-name').value==='Changed through hash');
    await page.evaluate(()=>{location.hash='route=%ZZ';});
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Import:'));
    assert.equal(await page.locator('#route-name').inputValue(),changed.name);
    // Clipboard denial leaves selectable text instead of losing the export.
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Denied');};document.execCommand=()=>false;});
    await page.locator('#export').click();
    await page.locator('#copy-route-text').waitFor();
    assert.equal((await decode(await page.locator('#copy-route-text').inputValue())).name,changed.name);
    assert.equal(await page.locator('#copy-route-text').evaluate(el=>el.selectionEnd-el.selectionStart===el.value.length),true);
    await page.locator('#close-dialog').click();
    await page.locator('#share').click();await page.locator('#copy-route-text').waitFor();assert.ok((await page.locator('#copy-route-text').inputValue()).includes('#route=R3.'));
    assert.deepEqual(errors,[]);await context.close();
    console.log(`Export, Import, Share, hash loading and clipboard fallback passed: ${url}`);
  }
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
  await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});await page.locator('#export').click();
  await page.waitForFunction(async()=>(await navigator.clipboard.readText()).startsWith('R3.'));
  assert.equal((await decode(await page.evaluate(()=>navigator.clipboard.readText()))).version,2);
  await page.locator('#share').click();
  await page.waitForFunction(async()=>(await navigator.clipboard.readText()).includes('#route=R3.'));
  await context.close();console.log('Native clipboard Export and Share passed.');
}finally{await browser?.close();server.kill();}
