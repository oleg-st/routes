// Exercise the published bundle beneath a GitHub Pages-style prefix, without external requests.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('dist'),prefix='/RoutePlanner/';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,url.pathname.slice(prefix.length)||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.avif':'image/avif'}[path.extname(file)]||'application/octet-stream'});res.end(bytes);});
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[],external=[];
  const origin=`http://127.0.0.1:${server.address().port}`;
  page.on('pageerror',e=>errors.push(e.message));page.on('websocket',socket=>external.push(socket.url()));
  await page.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort();}return r.continue();});
  await page.goto(origin+prefix);await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#floor-panel').count(),0);
  for(const kind of ['ghorn','witch']){
    assert.ok(await page.locator('#'+kind+' img').evaluate(async i=>{await i.decode();return i.naturalWidth>0;}));
    await page.locator('#'+kind).click();
    const portrait=page.locator(`[data-placement="modifier:${kind}"] image`);
    assert.equal(await portrait.count(),1);
    assert.ok(await portrait.evaluate(async e=>{const i=new Image();i.src=e.getAttribute('href');await i.decode();return i.naturalWidth>0;}));
    await page.locator('#undo').click();
  }
  await page.locator('#add-pull').click();await page.locator('#shadow').click();await page.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
  await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#pull-count').textContent(),'2');assert.equal(await page.locator('#shadow').getAttribute('aria-pressed'),'true');
  await page.locator('#import-log-button').click();await page.locator('#log-url').waitFor();
  assert.equal(await page.getByText('Saved examples',{exact:true}).count(),0);assert.equal(await page.locator('[data-log-fixture]').count(),0);
  await page.locator('#log-url').press('Escape');assert.equal(await page.locator('#pull-count').textContent(),'2');
  await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await page.locator('#pull-count').textContent(),'2');
  assert.equal(fs.existsSync(path.join(root,'log-import/prototype-fixtures.js')),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('Published bundle: Pages prefix, embedded WASM, edits, URL-only log dialog and refresh passed without external requests.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
