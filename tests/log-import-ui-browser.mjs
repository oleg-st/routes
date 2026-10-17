// Component test: prepared fixtures are test inputs only, never public UI data.
import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({stdin:{contents:`
  import {createLogImportUI} from './log-import/import-ui.js';
  import {logFixtures} from './tests/fixtures/log-review.js';
  window.result={};window.example='JLhT1y4Fa3n9Xjx8-6';
  const dialog=document.querySelector('dialog');
  window.ui=createLogImportUI({panel:document.querySelector('#panel'),
    showDialog:(title,html)=>{dialog.innerHTML=html;dialog.showModal();},closeDialog:()=>dialog.close(),
    live:{connected:()=>true,load:async()=>{if(window.failure)throw new Error('No complete route');return window.extraFixture??logFixtures.find(f=>f.id===window.example&&f.dungeonData==='custom');},
      diagnostics:()=>window.failure?.diagnostics,missingEnemies:()=>window.failure?.skipped,
      canFindMissing:()=>Boolean(window.failure&&!window.failure.searched),canContinue:()=>Boolean(window.failure&&!window.failure.done),
      expandSearch:async()=>{window.failure.searched=true;window.failure.skipped=window.failure.skipped.filter(r=>r.pull===2);return null;},
      continueImport:async()=>{window.failure.done=true;return window.extraFixture;}},
    preview:async(fixture,state)=>{window.result.preview=state;},commit:async()=>{window.result.saved=true;},cancel:async()=>{window.result.cancelled=true;},
    highlight:ids=>{window.result.highlight=ids;},focus:ids=>{window.result.focus=ids;},describe:ids=>ids.length+' enemies',onError:error=>{throw new Error(error);}});
  window.ui.open();`,resolveDir:process.cwd(),loader:'js'},bundle:true,format:'iife',write:false});
const html=`<!doctype html><html><body><dialog></dialog><section id="panel" hidden></section><script>${bundle.outputFiles[0].text}</script></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const submit=async()=>{await page.locator('#log-url').fill('https://www.fellowshiplogs.com/reports/JLhT1y4Fa3n9Xjx8?fight=6');await page.locator('#log-load').click();};
  await submit();await page.locator('[data-log-choice]').first().waitFor();
  const before=await page.evaluate(()=>window.result.preview);await page.locator('[data-log-choice]').first().hover();assert.ok((await page.evaluate(()=>window.result.highlight)).length);
  await page.locator('[data-log-focus]').first().click();assert.ok((await page.evaluate(()=>window.result.focus)).length);
  await page.locator('[data-log-choice]').first().click();await page.locator('[data-log-back]').click();assert.deepEqual(await page.evaluate(()=>window.result.preview),before);
  await page.locator('[data-log-cancel]').click();assert.equal(await page.evaluate(()=>window.result.cancelled),true);
  await page.evaluate(()=>{window.example='c4nFLaThdAxtVpYv-5';window.ui.open();});await submit();
  assert.equal(await page.evaluate(()=>window.result.saved),true);assert.equal(await page.locator('#panel').isHidden(),true);
  await page.evaluate(()=>{window.result.saved=false;window.example='rgTQYB9dqPzjJFha-7';window.ui.open();});await submit();
  assert.match(await page.locator('#panel').textContent(),/hypothesis/);await page.locator('[data-log-choice]').first().click();
  assert.equal(await page.evaluate(()=>window.result.saved),true);assert.equal(await page.locator('#panel').isHidden(),true);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{
    const score=d=>({minDistance:d,maxDistance:d,sources:['player'],patrol:false});
    window.extraFixture={title:'Path ranking',fightID:1,reportCode:'example',duration:10,
      groups:{a:{label:'G1',enemies:['a']},b:{label:'G2',enemies:['b']}},
      variants:[{pulls:[{groups:['a']}],proximity:{a:score(900)}},{pulls:[{groups:['b']}],proximity:{b:score(200)}}]};
    window.ui.open();
  });await submit();
  assert.equal(await page.locator('[data-log-choice]').first().getAttribute('data-log-choice'),'b');
  assert.match(await page.locator('[data-log-choice]').first().textContent(),/Closest to path.*200.*player/);
  assert.match(await page.locator('[data-log-choice]').last().textContent(),/900/);
  assert.equal(await page.locator('[data-log-choice]').count(),2);assert.deepEqual(errors,[]);
  await page.locator('[data-log-cancel]').click();
  await page.evaluate(()=>{
    window.result.saved=false;
    window.extraFixture.variants[1].proximity.b.estimated=true;
    window.extraFixture.assumption='The actual path is unknown; review this movement hypothesis before accepting.';
    window.extraFixture.movementHypotheses=[{placementId:'b'}];
    window.ui.open();
  });await submit();
  assert.equal(await page.locator('[data-log-choice]').first().getAttribute('data-log-choice'),'a');
  assert.match(await page.locator('[data-log-choice="b"]').textContent(),/Estimated across log gap/);
  assert.match(await page.locator('#panel').textContent(),/actual path is unknown/);
  await page.locator('[data-log-cancel]').click();
  await page.evaluate(()=>{window.extraFixture.variants=window.extraFixture.variants.slice(1);window.ui.open();});await submit();
  assert.equal(await page.locator('[data-log-choice]').count(),0);
  assert.equal(await page.evaluate(()=>window.result.saved),true);assert.equal(await page.locator('#panel').isHidden(),true);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{
    window.result.saved=false;window.extraFixture.expandedSearch={maxRadius:3000};
    window.extraFixture.assumption='Nearby packs may not have been pulled.';window.ui.open();
  });await submit();
  assert.equal(await page.evaluate(()=>window.result.saved),true,'a complete expanded result saves without another confirmation');
  assert.equal(await page.locator('#panel').isHidden(),true);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{
    delete window.extraFixture.expandedSearch;
    window.failure={diagnostics:{log:{reportCode:'JLhT1y4Fa3n9Xjx8',fight:{id:6}}},skipped:[
      {name:'Raider',pull:1},{name:'Shade',pull:1},{name:'Shade',pull:1},{name:'Soul',pull:2}]};
    window.ui.open();
  });await submit();
  assert.match(await page.locator('#log-missing-enemies').textContent(),/Pull 1Raider ×1Shade ×2Pull 2Soul ×1/);
  assert.equal(await page.locator('#log-expand').isVisible(),true);
  assert.equal(await page.locator('#log-expand').textContent(),'Find missing mobs');
  assert.match(await page.locator('#log-expand').getAttribute('title'),/confirmed packs pulled earlier.*Newly found packs do not extend/);
  assert.equal(await page.locator('#log-live-form > p.muted').count(),0);
  await page.locator('#log-expand').click();
  assert.equal(await page.locator('#log-missing-enemies').textContent(),'Pull 2Soul ×1');
  assert.equal(await page.locator('#log-expand').isHidden(),true);
  assert.equal(await page.getByRole('button',{name:'Download import diagnostics'}).isVisible(),true);
  await page.getByRole('button',{name:'Import without missing mobs'}).click();
  assert.equal(await page.evaluate(()=>window.result.saved),true);assert.deepEqual(errors,[]);
  console.log('Log import UI: choices, recovery by pull, search tooltip and automatic expanded import passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
