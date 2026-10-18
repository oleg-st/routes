import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {campfires} from '../data/map-campfires.js';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
 const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const m=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('error',reject);server.on('exit',code=>reject(Error('Server exited '+code)));});
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});
 for(const id of ['shadow','empowered','ghorn','witch']){
  const icon=await page.locator('#'+id+' img').boundingBox();
  assert.equal(icon.width,20,id+' toolbar icon width');assert.equal(icon.height,20,id+' toolbar icon height');
 }
 const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json')),presets=JSON.parse(fs.readFileSync('data/modifier-placements.json'));
 for(const d of dungeons){
  await page.locator('#dungeon').selectOption(d.id);await page.locator('#map-loading').waitFor({state:'hidden'});
  await page.waitForFunction(count=>document.querySelectorAll('[data-campfire]').length===count,campfires[d.id].length);
  assert.equal(await page.locator('[data-campfire]').count(),campfires[d.id].length,d.name);
  assert.equal(await page.locator('#map-start [aria-label="Dungeon start"]').count(),1,d.name+' start');
  const start=await page.locator('#map-start [aria-label="Dungeon start"]').boundingBox();
  const map=await page.locator('#map').boundingBox();
  assert.ok(start&&start.x+start.width>map.x&&start.x<map.x+map.width&&start.y+start.height>map.y&&start.y<map.y+map.height,d.name+' visible start');
  if(['Level.ID.PirateRaid','Level.ID.MythicForest'].includes(d.id)){
   fs.mkdirSync('tmp/game-entrances-markers/screenshots',{recursive:true});
   await page.screenshot({path:'tmp/game-entrances-markers/screenshots/'+d.id+'.png'});
  }
  for(const kind of ['ghorn','witch'])if(presets.dungeons[d.id][kind]){
   await page.locator('#'+kind).click();
   assert.equal(await page.locator(`[data-placement="modifier:${kind}"]`).count(),1,d.name+' '+kind);
   const portrait=page.locator(`[data-placement="modifier:${kind}"] image`);
   assert.equal(await portrait.count(),1,d.name+' '+kind+' game portrait');
   assert.ok(await portrait.evaluate(async e=>{const i=new Image();i.src=e.getAttribute('href');await i.decode();return i.naturalWidth>0;}));
   if(d.id==='Level.ID.DesertDunes'&&kind==='witch'){fs.mkdirSync('tmp/game-services/screenshots',{recursive:true});await page.screenshot({path:'tmp/game-services/screenshots/sands-witch.png'});}
   await page.locator('#undo').click();
  }
 }
 const icons=Object.keys(JSON.parse(fs.readFileSync('data/game-image-sources.json'))).filter(p=>/^images\/(?:modifiers|pois|hero-items|relics)\//.test(p));
 for(const src of icons)assert.ok(await page.evaluate(async src=>{const i=new Image();i.src=src;await i.decode();return i.naturalWidth>0;},src));
 assert.deepEqual(errors,[]);console.log('15 dungeons and entrances, 53 campfires, 28 modifier portraits, '+icons.length+' native icons: browser checks passed.');
}finally{await browser?.close();server.kill();server.stdout.destroy();server.stderr.destroy();server.unref();}
