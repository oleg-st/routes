import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await page.addInitScript(()=>localStorage.setItem('fellowship-dungeon-data','fellership'));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(await page.locator('#dungeon-data').count(),0);
  const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
  fs.mkdirSync('tmp/game-catalog-migration/screenshots',{recursive:true});
  for(const dungeon of dungeons){
    await page.locator('#dungeon').selectOption(dungeon.id);
    await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.ok(await page.locator('#markers > g').count()>0,dungeon.name);
    const href=await page.locator('#map-image').getAttribute('href');
    assert.match(href,/images\/dungeons\/(?:maps|combined)\//);
    assert.ok(await page.evaluate(async href=>{const image=new Image();image.src=href;await image.decode();return image.naturalWidth>0;},href));
    if(['Level.ID.SpiderForest','Level.ID.MoorCastle'].includes(dungeon.id))await page.screenshot({path:`tmp/game-catalog-migration/screenshots/${dungeon.id.split('.').at(-1)}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log(`Game catalogs UI: ${dungeons.length} dungeon maps decoded with markers, no source selector or HTTP/JavaScript failures.`);
}finally{await browser?.close();server.kill();server.stdout.destroy();server.stderr.destroy();server.unref();}
