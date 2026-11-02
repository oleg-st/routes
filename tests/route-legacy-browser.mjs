// Exercise the production bundler and real HTTP requests beneath a path prefix.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {chromium} from 'playwright';
import {buildSiteAssets} from '../scripts/build-site-assets.mjs';
import {dataNames} from '../data/runtime-loader.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {modifierPlacementIds} from '../data/modifier-spawns.js';
import {legacyDictionary} from '../route-legacy.js';
const temporary=path.resolve('tmp'),root=fs.mkdtempSync(path.join(temporary,'route-legacy-'));
const ds=JSON.parse(fs.readFileSync('data/dungeons.json')).map(correctDungeon);
const es=JSON.parse(fs.readFileSync('data/enemies.json'));
const requests=[],prefix='/planner/';
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;requests.push(pathname);
  if(!pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,pathname.slice(prefix.length)||'index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html','Cache-Control':'public,max-age=31536000,immutable'});res.end(bytes);
  });
});
let browser;
try{
  fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'log-import'));
  for(const name of dataNames)fs.writeFileSync(path.join(root,`data/${name}.json`),'[]');
  fs.copyFileSync('route-legacy.js',path.join(root,'route-legacy.js'));
  fs.writeFileSync(path.join(root,'log-import/matcher-worker.js'),'self.onmessage=()=>{};');
  fs.writeFileSync(path.join(root,'styles.css'),'body{}');
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><link rel="stylesheet" href="styles.css"><script type="module" src="app.js"></script>');
  fs.writeFileSync(path.join(root,'app.js'),`
    import {decodeRoute} from '../../route-model.js';
    const ds=${JSON.stringify(ds)},es=new Map(${JSON.stringify(es)}.map(e=>[e.id,e]));
    window.openRoute=text=>decodeRoute(text,ds,es);window.ready=true;
  `);
  const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const built=await buildSiteAssets(root);
  assert.match(built.legacyRouteURL,/^assets\/route-legacy\.[a-f0-9]+\.js$/);
  const app=fs.readFileSync(path.join(root,built.appURL),'utf8');
  assert.ok(app.includes(`import("./${path.basename(built.legacyRouteURL)}")`),'legacy must be an external dynamic import');
  assert.ok(!app.includes('different enemy dataset'),'legacy-only validation stays out of the main bundle');
  const changed=fs.readFileSync(path.join(root,'route-legacy.js'),'utf8').replace('different enemy dataset','changed enemy dataset');
  fs.writeFileSync(path.join(root,'route-legacy.js'),changed);
  fs.writeFileSync(path.join(root,'app.js'),appSource);
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><link rel="stylesheet" href="styles.css"><script type="module" src="app.js"></script>');
  const changedBuild=await buildSiteAssets(root);
  assert.notEqual(changedBuild.legacyRouteURL,built.legacyRouteURL);
  assert.notEqual(changedBuild.appURL,built.appURL,'new legacy module invalidates its importer');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);await page.waitForFunction(()=>window.ready);
  const legacyRequests=()=>requests.filter(p=>/route-legacy\./.test(p));
  assert.equal(legacyRequests().length,0,'startup does not load compatibility');
  for(const format of ['r5','r4']){
    const text=fs.readFileSync(`tests/fixtures/compact-route-current-${format}.txt`,'utf8');
    assert.equal((await page.evaluate(text=>window.openRoute(text),text)).pulls.length,7);
    assert.equal(legacyRequests().length,0,`${format} does not load compatibility`);
  }
  const r3=fs.readFileSync('tests/fixtures/compact-route-current-r3.txt','utf8');
  await page.evaluate(text=>window.openRoute(text),r3);
  assert.deepEqual(legacyRequests(),[prefix+changedBuild.legacyRouteURL]);
  const d=ds[0],dictionary=await legacyDictionary(d,modifierPlacementIds(d.id)),id=d.enemies[0].placementId;
  for(const format of ['R1.','R2.']){
    const payload=[d.id.slice(9),d.routeBuildId,dictionary.fingerprint,'Legacy',[[[dictionary.placements.indexOf(id)]]]];
    const text=format+deflateRawSync(JSON.stringify(payload)).toString('base64url');
    const route=await page.evaluate(text=>window.openRoute(text),text);
    assert.deepEqual(route.pulls[0].enemies,[id]);
  }
  assert.equal(legacyRequests().length,1,'R1, R2, R3 share one cached module');
  assert.deepEqual(errors,[]);
  console.log(`Lazy compatibility verified: 0 requests for startup/R4/R5, 1 for R1–R3; ${fs.statSync(path.join(root,built.legacyRouteURL)).size} bytes in the optional module.`);
}finally{
  await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));
  if(path.dirname(root)!==temporary)throw new Error('Invalid temporary build directory.');
  fs.rmSync(root,{recursive:true,force:true});
}
