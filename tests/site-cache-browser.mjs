// Keep the browser cache enabled while deploying two builds at a Pages prefix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {buildSiteAssets} from '../scripts/build-site-assets.mjs';
import {dataNames} from '../data/runtime-loader.js';

const temporary=path.resolve('tmp');
fs.mkdirSync(temporary,{recursive:true});
const root=fs.mkdtempSync(path.join(temporary,'site-cache-'));
const prefix='/routes/';
const requests=[];
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  requests.push(pathname);
  if(!pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const filename=path.resolve(root,pathname.slice(prefix.length)||'index.html');
  if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(filename,(error,contents)=>{
    if(error){res.writeHead(404).end();return;}
    const extension=path.extname(filename);
    res.writeHead(200,{
      'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'}[extension],
      'Cache-Control':extension==='.html'?'no-cache':'public, max-age=31536000, immutable',
    });
    res.end(contents);
  });
});
let browser;
try{
  fs.mkdirSync(path.join(root,'data'));
  fs.mkdirSync(path.join(root,'log-import'));
  for(const file of ['data/runtime-loader.js','data/compact-data.js','data/dungeon-loader.js','log-import/matcher-client.js']){
    fs.copyFileSync(file,path.join(root,file));
  }
  fs.writeFileSync(path.join(root,'log-import/matcher-worker.js'),`
    import {version} from './dependency.js';
    self.onmessage=()=>self.postMessage({result:version});
  `);
  const prepare=version=>{
    fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><link rel="stylesheet" href="styles.css"><script type="module" src="app.js"></script>');
    fs.writeFileSync(path.join(root,'app.js'),`
      import {loadData} from './data/runtime-loader.js';
      import {createDungeonLoader} from './data/dungeon-loader.js';
      import {runLogMatching} from './log-import/matcher-client.js';
      import {LoroDoc} from 'loro-crdt';
      const doc=new LoroDoc();doc.getMap('test').set('version',${version});
      const data=await loadData();window.loadDungeon=createDungeonLoader(data.dungeons);
      window.result={version:doc.getMap('test').get('version'),data:data.heroes,worker:await runLogMatching({},{})};
      doc.free();
    `);
    fs.writeFileSync(path.join(root,'styles.css'),`body { --version: ${version}; }`);
    for(const name of dataNames)fs.writeFileSync(path.join(root,`data/${name}.json`),JSON.stringify(name==='heroes'?[version]:[]));
    fs.writeFileSync(path.join(root,'data/dungeons.json'),JSON.stringify(['Alpha','Beta'].map(name=>({id:'Level.ID.'+name,name,enemies:[],mapImages:[],requiredScore:name==='Alpha'?version:1}))));
    fs.writeFileSync(path.join(root,'log-import/dependency.js'),`export const version=${version};`);
  };
  prepare(1);
  const first=await buildSiteAssets(root);
  prepare(1);
  assert.deepEqual(await buildSiteAssets(root),first,'identical inputs must produce stable URLs');
  // A change exclusively in a worker dependency must also invalidate the app.
  prepare(1);
  fs.writeFileSync(path.join(root,'log-import/dependency.js'),'export const version=2;');
  const workerChange=await buildSiteAssets(root);
  assert.notEqual(workerChange.workerURL,first.workerURL);
  assert.notEqual(workerChange.appURL,first.appURL);
  prepare(1);
  await buildSiteAssets(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // No request interception: Playwright routing disables HTTP caching.
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
  await page.waitForFunction(()=>window.result);
  assert.deepEqual(await page.evaluate(()=>window.result),{version:1,data:[1],worker:1});
  for(const url of [first.loroURL,first.wasmURL])assert.equal(requests.filter(p=>p===prefix+url).length,1,`library asset loaded once: ${url}`);
  assert.ok(!requests.some(p=>/\/dungeon-/.test(p)),'startup loads the catalogue without dungeon geometry');
  for(const id of Object.keys(first.dungeonURLs))await page.evaluate(id=>window.loadDungeon(id),id);
  requests.length=0;
  // Prove the cache is warm using a second document navigation.
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
  await page.waitForFunction(()=>window.result);
  assert.ok(!requests.includes(prefix+first.appURL),'the old application must actually be cached');
  prepare(2);
  const second=await buildSiteAssets(root);
  for(const key of ['loroURL','wasmURL'])assert.equal(second[key],first[key],'application changes preserve library URLs');
  for(const key of ['appURL','cssURL','workerURL'])assert.notEqual(second[key],first[key]);
  assert.notEqual(second.dataURLs.heroes,first.dataURLs.heroes);
  assert.equal(second.dataURLs.enemies,first.dataURLs.enemies,'unchanged data remains cacheable');
  assert.notEqual(second.dungeonURLs['Level.ID.Alpha'],first.dungeonURLs['Level.ID.Alpha']);
  assert.equal(second.dungeonURLs['Level.ID.Beta'],first.dungeonURLs['Level.ID.Beta']);
  assert.notEqual(second.dataURLs.dungeons,first.dataURLs.dungeons,'catalogue tracks changed dungeon URLs');
  requests.length=0;
  await page.reload();
  await page.waitForFunction(()=>window.result);
  assert.deepEqual(await page.evaluate(()=>window.result),{version:2,data:[2],worker:2});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--version').trim()),'2');
  for(const url of [second.appURL,second.cssURL,second.workerURL,second.dataURLs.heroes])assert.ok(requests.includes(prefix+url),`new asset fetched: ${url}`);
  for(const url of [second.loroURL,second.wasmURL])assert.ok(!requests.includes(prefix+url),`unchanged library asset stays cached: ${url}`);
  assert.ok(!requests.some(p=>/\/dungeon-/.test(p)),'reloading still defers dungeon geometry');
  assert.equal(await page.evaluate(async()=>(await window.loadDungeon('Level.ID.Alpha')).requiredScore),2);
  await page.evaluate(()=>window.loadDungeon('Level.ID.Beta'));
  assert.ok(requests.includes(prefix+second.dungeonURLs['Level.ID.Alpha']),'changed dungeon fetched on demand');
  assert.ok(!requests.includes(prefix+second.dungeonURLs['Level.ID.Beta']),'unchanged dungeon stays cached across deployment');
  // Older cached HTML still points at /app.js rather than /assets/app.<hash>.js.
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><script type="module" src="app.js"></script>');
  await page.reload();
  await page.waitForFunction(()=>window.result);
  assert.deepEqual(await page.evaluate(()=>window.result),{version:2,data:[2],worker:2});
  assert.deepEqual(errors,[]);
  console.log('Warm-cache deployment: new app, CSS, JSON and worker load; Loro JS/WASM stay cached. Legacy app entry works beneath a Pages prefix.');
}finally{
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  if(path.dirname(root)!==temporary)throw new Error('Invalid temporary build directory.');
  fs.rmSync(root,{recursive:true,force:true});
}
