import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {encodeRoute,decodeRoute} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';

const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json')).map(correctDungeon);
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedText=text;}}}));
    const exported=async()=>{
      await page.evaluate(()=>{window.copiedText=null;});await page.locator('#export').click();
      await page.waitForFunction(()=>typeof window.copiedText==='string');
      const route=await decodeRoute(await page.evaluate(()=>window.copiedText),dungeons,enemies);
      // Route strings deliberately mint new IDs on decode; use the editor's pull IDs.
      route.id='exported-route';
      const ids=await page.locator('.pull-card').evaluateAll(es=>es.map(e=>e.dataset.pull));
      route.pulls.forEach((pull,index)=>{pull.id=ids[index];});return route;
    };
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    const initial=await exported();
    const visible=await page.locator('#markers > g').evaluateAll(elements=>elements.map(el=>{
      const ring=el.querySelector('.mob-ring'),p=new DOMPoint(Number(ring.getAttribute('cx')),Number(ring.getAttribute('cy'))).matrixTransform(ring.getScreenCTM());
      return {id:el.dataset.placement,x:p.x,y:p.y};
    }));
    const bounds=await page.locator('#map').boundingBox();
    const members=visible.filter(p=>p.x>bounds.x+100&&p.x<bounds.x+bounds.width-100&&p.y>bounds.y+100&&p.y<bounds.y+bounds.height-100);
    assert.ok(members.length>3);
    initial.pulls[0].enemies=members.map(p=>p.id);initial.pulls[0].name='Split me';initial.pulls[0].customName=true;initial.pulls[0].note='Keep this note';
    initial.pulls.push({id:'tail-pull',name:'Next encounter',customName:true,color:'#387bff',enemies:[],note:''});
    await page.locator('#import').click();await page.locator('#import-route-text').fill(await encodeRoute(initial,dungeons.find(d=>d.id===initial.dungeonId)));await page.locator('#import-route-button').click();
    await page.waitForFunction(()=>!document.querySelector('#dialog').open);await page.locator('#map-loading').waitFor({state:'hidden'});
    const before=await exported(),score=await page.locator('#progress-fill').getAttribute('style');
    const x=(Math.min(...members.map(p=>p.x))+Math.max(...members.map(p=>p.x)))/2;
    const y1=Math.min(...members.map(p=>p.y))-25,y2=Math.max(...members.map(p=>p.y))+25;
    const splitButton=page.getByRole('button',{name:'Split pull',exact:true});
    // Two clicks, preview, Escape, then a drag cancelled while the pointer is down.
    await splitButton.click();await page.mouse.click(x,y1);await page.mouse.move(x,y2);
    assert.equal(await page.locator('#draft .split-line').count(),1);
    assert.match(await page.locator('#draft text').textContent(),/\d+ \/ \d+ mobs/);
    await page.screenshot({path:'tmp/pull-split-preview.png'});
    await page.keyboard.press('Escape');assert.equal(await page.locator('#draft > *').count(),0);
    assert.deepEqual(await exported(),before);
    await splitButton.click();await page.mouse.move(x,y1);await page.mouse.down();await page.mouse.move(x,y2,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
    assert.deepEqual(await exported(),before);
    // Drag commits, inserts immediately after the source, and preserves metadata and score.
    await splitButton.click();await page.mouse.move(x,y1);await page.mouse.down();await page.mouse.move(x,y2,{steps:5});await page.mouse.up();
    assert.equal(await page.locator('.pull-card').count(),3);
    const after=await exported();
    assert.equal(after.pulls[0].id,before.pulls[0].id);assert.equal(after.pulls[2].id,before.pulls[1].id);
    assert.equal(after.pulls[0].name,'Split me');assert.equal(after.pulls[0].note,'Keep this note');
    assert.deepEqual(after.pulls.slice(0,2).map(p=>p.color),before.pulls.map(p=>p.color));
    assert.ok(!before.pulls.some(p=>p.color===after.pulls[2].color));
    assert.ok(after.pulls[0].enemies.length&&after.pulls[1].enemies.length);
    assert.deepEqual([...after.pulls[0].enemies,...after.pulls[1].enemies].sort(),[...before.pulls[0].enemies].sort());
    assert.equal(await page.locator('#progress-fill').getAttribute('style'),score);assert.equal(after.drawings.length,0);
    await page.locator('#undo').click();assert.deepEqual(await exported(),before);
    await page.locator('#redo').click();assert.deepEqual(await exported(),after);
    await page.locator('#undo').click();
    // Reversing a two-click line produces the same two groups.
    await splitButton.click();await page.mouse.click(x,y2);await page.mouse.move(x,y1);await page.mouse.click(x,y1);
    const reversed=await exported();assert.deepEqual(reversed.pulls.map(p=>p.enemies),after.pulls.map(p=>p.enemies));
    await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.deepEqual(await exported(),reversed);assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('Pull split UI passed in server and local modes: preview, drag/two-click, cancel, insertion, membership, score, Undo/Redo and reload.');
}finally{await browser?.close();server.kill();}
