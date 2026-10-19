import {difficultyOptions} from '../difficulty.js';
async function selectAffix(page,kind){const dungeon=await page.locator('#dungeon').inputValue(),current=Number(await page.locator('#difficulty').inputValue()),choice=difficultyOptions(dungeon).find(c=>c.value!==current&&c.modifiers.includes(kind));assert.ok(choice,'Available '+kind+' difficulty');await page.locator('#difficulty').selectOption(String(choice.value));}
// Exercise the published bundle beneath a GitHub Pages-style prefix, without external requests.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {newRoute,encodeRoute} from '../route-model.js';
const root=path.resolve('dist'),prefix='/RoutePlanner/';
const requests=[];
const server=http.createServer((req,res)=>{
  requests.push(req.url);
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,url.pathname.slice(prefix.length)||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.avif':'image/avif','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream'});res.end(bytes);});
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[],external=[];
  const origin=`http://127.0.0.1:${server.address().port}`;
  page.on('pageerror',e=>errors.push(e.message));page.on('websocket',socket=>external.push(socket.url()));
  await page.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort();}return r.continue();});
  await page.goto(origin+prefix);await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#floor-panel').count(),0);
  const dungeonRequests=()=>requests.filter(url=>/\/dungeon-[^.]+\.[a-f0-9]+\.json$/.test(url));
  assert.equal(dungeonRequests().length,1,'startup loads only the selected dungeon');
  assert.match(dungeonRequests()[0],/dungeon-FrozenKingdom\./);
  assert.ok(!requests.some(url=>/\/dungeons\.[a-f0-9]+\.json$|\/data\/dungeons\.json$/.test(url)),'no full dungeon dataset is requested');
  for(const kind of ['ghorn','witch']){
    assert.ok(await page.locator('#'+kind+' img').evaluate(async i=>{await i.decode();return i.naturalWidth>0;}));
    await selectAffix(page,kind);
    const portrait=page.locator(`[data-placement="modifier:${kind}"] image`);
    assert.equal(await portrait.count(),1);
    assert.ok(await portrait.evaluate(async e=>{const i=new Image();i.src=e.getAttribute('href');await i.decode();return i.naturalWidth>0;}));
    await page.locator('#undo').click();
  }
  await page.locator('#add-pull').click();await selectAffix(page,'empowered');await page.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#pull-count').textContent(),'2');assert.equal(await page.locator('#empowered').getAttribute('aria-pressed'),'true');
  await page.locator('#import-log-button').click();await page.locator('#log-url').waitFor();
  assert.equal(await page.getByText('Saved examples',{exact:true}).count(),0);assert.equal(await page.locator('[data-log-fixture]').count(),0);
  await page.locator('#log-url').press('Escape');assert.equal(await page.locator('#pull-count').textContent(),'2');
  await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#pull-count').textContent(),'2');
  requests.length=0;
  await page.route('**/dungeon-SandTomb.*.json',r=>r.fulfill({status:503,body:'Unavailable'}));
  await page.locator('#dungeon').selectOption('Level.ID.SandTomb');
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Unable to load'));
  assert.equal(await page.locator('#dungeon').inputValue(),'Level.ID.FrozenKingdom');
  assert.equal(await page.locator('#pull-count').textContent(),'2','failed switch preserves the previous route');
  await page.unroute('**/dungeon-SandTomb.*.json');
  await page.locator('#dungeon').selectOption('Level.ID.SandTomb');
  await page.waitForFunction(()=>document.querySelector('#map-image').getAttribute('href')?.includes('sandtomb'));
  await page.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  assert.equal(dungeonRequests().length,1,'retry fetches the selected dungeon');
  await page.locator('#dungeon').selectOption('Level.ID.FrozenKingdom');
  await page.waitForFunction(()=>document.querySelector('#pull-count').textContent==='2');
  assert.equal(dungeonRequests().length,1,'returning to a loaded dungeon does not fetch it again');
  const raw=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id==='Level.ID.DesertDunes');
  const sharedRoute=newRoute(raw,'test');sharedRoute.pulls[0].enemies=raw.enemies.slice(0,2).map(p=>p.placementId);
  const code=await encodeRoute(sharedRoute,raw);
  const shared=await browser.newPage();shared.on('pageerror',e=>errors.push(e.message));requests.length=0;
  const sharedBase=origin+prefix+'?source=share';
  await shared.goto(sharedBase+'#route='+code);await shared.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(shared.url(),sharedBase,'successful import consumes only the route fragment');
  assert.equal(await shared.locator('#dungeon').inputValue(),raw.id);
  assert.equal(dungeonRequests().length,1,'a share link loads its dungeon without fetching the default first');
  assert.match(dungeonRequests()[0],/dungeon-DesertDunes\./);
  await shared.locator('#add-pull').click();
  await shared.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  await shared.reload();await shared.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await shared.locator('#pull-count').textContent(),'2','reload preserves edits to the imported route');
  await shared.locator('#dungeon').selectOption('Level.ID.SandTomb');
  await shared.waitForFunction(()=>document.querySelector('#map-image').getAttribute('href')?.includes('sandtomb'));
  await shared.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  await shared.reload();await shared.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await shared.locator('#dungeon').inputValue(),'Level.ID.SandTomb','reload preserves a later dungeon selection');
  await shared.evaluate(code=>{location.hash='route='+code;history.replaceState({test:'keep'},'');},code);
  await shared.waitForFunction(()=>location.hash==='');
  assert.equal(await shared.locator('#dungeon').inputValue(),raw.id,'hash navigation still imports routes');
  assert.deepEqual(await shared.evaluate(()=>history.state),{test:'keep'});
  assert.equal(shared.url(),sharedBase);
  await shared.locator('#add-pull').click();
  await shared.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  await shared.reload();await shared.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await shared.locator('#pull-count').textContent(),'2','hashchange imports are also consumed before reload');
  await shared.evaluate(()=>{location.hash='route=invalid';});
  await shared.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Import:'));
  assert.equal(new URL(shared.url()).hash,'#route=invalid','failed imports keep the original link');
  assert.equal(await shared.locator('#pull-count').textContent(),'2','failed imports preserve the current route');
  await shared.close();
  const legacy=await browser.newPage();legacy.on('pageerror',e=>errors.push(e.message));
  sharedRoute.name='Legacy saved route';
  await legacy.addInitScript(route=>{
    if(!localStorage.getItem('fellowship-atlas-v1'))localStorage.setItem('fellowship-atlas-v1',JSON.stringify({
      drafts:{[route.dungeonId]:route},saved:[route],lastDungeon:route.dungeonId,
    }));
  },sharedRoute);
  requests.length=0;
  await legacy.goto(origin+prefix);await legacy.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await legacy.locator('#route-name').inputValue(),'Legacy saved route');
  assert.equal(dungeonRequests().length,1,'legacy migration loads only the referenced dungeon');
  requests.length=0;
  await legacy.reload();await legacy.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await legacy.locator('#route-name').inputValue(),'Legacy saved route');
  assert.equal(dungeonRequests().length,1,'migrated saves reopen with only their own dungeon');
  await legacy.close();
  assert.equal(fs.existsSync(path.join(root,'log-import/prototype-fixtures.js')),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('Published bundle: Pages prefix, separate WASM, edits, URL-only log dialog and refresh passed without external requests.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
