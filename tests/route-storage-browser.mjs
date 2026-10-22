import {difficultyOptions} from '../difficulty.js';
async function selectAffix(page,kind){const dungeon=await page.locator('#dungeon').inputValue(),current=Number(await page.locator('#difficulty').inputValue()),choice=difficultyOptions(dungeon).find(c=>c.value!==current&&c.modifiers.includes(kind));assert.ok(choice,'Available '+kind+' difficulty');await page.locator('#difficulty').selectOption(String(choice.value));}
// Real IndexedDB transactions, recovery and same-origin tab synchronization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({stdin:{contents:"export * from './collaboration/route-storage.js';export * from './collaboration/route-document.js';export * from './route-model.js';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'RT',write:false,alias:{'loro-crdt':'loro-crdt/base64'}});
const read=name=>JSON.parse(fs.readFileSync(`data/${name}.json`));
const dungeons=read('dungeons'),enemies=read('enemies'),dungeon=dungeons.find(d=>d.mapImages.length===1),presets=read('modifier-placements');
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{const url=String(d).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});server.on('error',reject);server.on('exit',code=>reject(Error(`Server exited ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/storage-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Storage tests</title>'}));
  await page.goto(origin+'/storage-test');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(({dungeon,dungeons,enemies,presets})=>{
    window.options={dungeon,enemies:new Map(enemies.map(e=>[e.id,e])),role:'player'};
    window.migration={dungeons,enemies:options.enemies,presets};
    window.check=(value,message)=>{if(!value)throw Error(message);};
  },{dungeon,dungeons,enemies,presets});
  const result=await page.evaluate(async()=>{
    const storage=await RT.openRouteStorage({name:'storage-test',channel:null}),route=RT.newRoute(options.dungeon,options.dungeon.routeBuildId??'test','Route 12');
    route.drawings=[{id:'note',mapId:options.dungeon.mapImages[0].id,kind:'note',color:'#abcdef',points:[[10,20]],text:'Old note'}];
    const legacy={drafts:{[route.dungeonId]:route},saved:[{...route,name:'Older bookmark'}],lastDungeon:route.dungeonId};
    const doc=RT.createRouteDocument(route,options),identity=doc.identity;
    await storage.write(doc.exportSnapshot());await storage.setDraft(route.dungeonId,route.id);await storage.saveBookmark({...route,name:'Saved bookmark'});
    const initial=await storage.load(route.id);
    check((await storage.library()).saved[0].name==='Saved bookmark','Keep bookmark baseline');
    doc.execute({type:'set-meta',patch:{name:'After migration'}});await storage.write(doc.exportUpdate());
    const reload=RT.restoreRouteDocument(await storage.load(route.id),options);check(reload.snapshot().name==='After migration','Stored update missing');check(reload.identity.documentId===identity.documentId,'Reload changed lineage');reload.dispose();
    check(await storage.nextName(13)==='Route 13','Name counter');
    const stale=RT.restoreRouteDocument(initial,options);
    const caughtUp=new Promise(resolve=>{const stop=stale.subscribe(()=>{if(stale.snapshot().name==='After migration'){stop();resolve();}});});
    const staleBinding=storage.bind(stale);await caughtUp;await staleBinding.dispose();stale.dispose();
    const peer=RT.restoreRouteDocument(doc.exportSnapshot(),options);
    doc.execute({type:'set-meta',patch:{shadow:true}});peer.execute({type:'set-text',group:'drawings',id:'note',text:'Remote note'});
    await Promise.all([storage.write(doc.exportUpdate()),storage.compact(route.id),storage.write(peer.exportUpdate()),storage.compact(route.id)]);
    const combined=RT.restoreRouteDocument(await storage.load(route.id),options);
    check(combined.snapshot().shadow&&combined.snapshot().drawings[0].text==='Remote note','Compaction lost concurrent writes');
    const spectator=RT.restoreRouteDocument(combined.exportSnapshot(),{...options,role:'spectator'}),states=[];
    const binding=storage.bind(spectator,status=>states.push(status.state));await binding.flush();
    doc.import(peer.exportUpdate());doc.execute({type:'set-meta',patch:{name:'Remote persisted'}});spectator.import(doc.exportUpdate());await binding.flush();
    check(states.at(-1)==='saved','Spectator persistence status');
    const saved=RT.restoreRouteDocument(await storage.load(route.id),options);check(saved.snapshot().name==='Remote persisted','Spectator must save accepted updates');saved.dispose();
    const write=storage.write;storage.write=async()=>{throw new DOMException('Quota exceeded','QuotaExceededError');};
    doc.execute({type:'set-meta',patch:{name:'Retry me'}});spectator.import(doc.exportUpdate());
    let rejected=false;try{await binding.flush();}catch{rejected=true;}
    check(rejected&&binding.pending>0&&states.at(-1)==='error','Failed save falsely reported success');
    storage.write=write;await binding.flush();check(binding.pending===0&&states.at(-1)==='saved','Retry failed');
    const recovered=RT.restoreRouteDocument(await storage.load(route.id),options);check(recovered.snapshot().name==='Retry me','Retry lost update');
    check(recovered.peerId!==doc.peerId&&recovered.identity.documentId===doc.identity.documentId,'Restore must keep lineage and use a fresh peer');
    await binding.dispose();for(const d of [doc,peer,combined,spectator,recovered])d.dispose();storage.close();
    // Old localStorage remains untouched and must not be loaded by this build.
    localStorage.setItem('fellowship-atlas-v1',JSON.stringify(legacy));return {routeId:route.id,legacy:JSON.stringify(legacy)};
  });
  console.log('IndexedDB: snapshots, compaction, spectator writes, quota failure/retry and fresh peer IDs passed.');
  await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await page.locator('#route-name').inputValue(),'Route 1');
  assert.equal(await page.evaluate(()=>localStorage.getItem('fellowship-atlas-v1')),result.legacy);
  const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(origin);await other.locator('#map-loading').waitFor({state:'hidden'});
  await Promise.all([page.locator('#add-pull').click(),selectAffix(other,'shadow')]);
  for(const tab of [page,other])await tab.waitForFunction(()=>document.querySelector('#pull-count').textContent==='2'&&document.querySelector('#shadow').getAttribute('aria-pressed')==='true');
  await page.locator('#undo').click();
  for(const tab of [page,other])await tab.waitForFunction(()=>document.querySelector('#pull-count').textContent==='1'&&document.querySelector('#shadow').getAttribute('aria-pressed')==='true');
  // A modal submits only changed fields and never silently overwrites text received since it opened.
  await page.locator('[data-action=rename]').click();await page.locator('#edit-pull-note').fill('Local draft');
  await other.locator('[data-action=rename]').click();await other.locator('#edit-pull-note').fill('Remote note');await other.locator('#apply-pull').click();
  await page.waitForFunction(()=>document.querySelector('#storage-status').dataset.state==='saved');
  // A round-trip metadata update is a synchronization barrier after the text update.
  await other.locator('#route-name').fill('Synced name');await other.locator('#route-name').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#route-name').value==='Synced name');
  await page.locator('#apply-pull').click();assert.equal(await page.locator('#dialog').isVisible(),true);assert.equal(await page.locator('#edit-pull-note').inputValue(),'Local draft');
  await page.locator('#close-dialog').click();await page.locator('[data-action=rename]').click();assert.equal(await page.locator('#edit-pull-note').inputValue(),'Remote note');await page.locator('#close-dialog').click();
  await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#shadow').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#undo').isDisabled(),true);
  await page.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  assert.deepEqual(errors,[]);console.log('Editor: old library ignored, two-tab convergence, local-only Undo and refresh passed.');
  await context.close();
}finally{await browser?.close();server.kill();}
