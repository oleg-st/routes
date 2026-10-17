// Exercise OAuth return, filtered requests and the actual worker in the public
// bundle under a Pages prefix. All Fellowship Logs responses are mocked.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {correctDungeon} from '../data/placement-corrections.js';
const root=path.resolve('dist'),prefix='/routes/';
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,pathname.slice(prefix.length)||'index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.avif':'image/avif'}[path.extname(file)]||'application/octet-stream'});res.end(bytes);});
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  const read=p=>JSON.parse(fs.readFileSync(p));
  const cat=new Map(read('data/enemies.json').map(e=>[e.id,e]));
  const dungeon=correctDungeon(read('data/dungeons.json').find(d=>d.name==='Empyrean Sands'),'custom');
  const boss=dungeon.enemies.find(p=>cat.get(p.id).isBoss),code='c4nFLaThdAxtVpYv';
  const fight={id:5,name:dungeon.name,startTime:100,endTime:10000,kill:true,difficultyLevel:75,completionTime:631135,modifiers:[],friendlyPlayers:[1],dungeonPulls:[{id:1,startTime:100,endTime:10000}]};
  const actors=[{id:1,type:'Player'},{id:2,type:'NPC',subType:'Boss',gameID:cat.get(boss.id).gameId}];
  const events=[{type:'damage',timestamp:200,fight:5,sourceID:1,targetID:2,targetInstance:1,sourceResources:{x:boss.worldPosition.y,y:boss.worldPosition.x,hitPoints:100,maxHitPoints:100},targetResources:{x:boss.worldPosition.y,y:boss.worldPosition.x,hitPoints:90,maxHitPoints:100}}];
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.addInitScript(({code})=>{
    if(sessionStorage.getItem('live-test-seeded'))return;
    sessionStorage.setItem('live-test-seeded','yes');
    sessionStorage.setItem('fellowship-log-probe-pkce',JSON.stringify({state:'test-state',verifier:'a'.repeat(43),createdAt:Date.now(),redirectURI:'https://oleg-st.github.io/routes/'}));
    sessionStorage.setItem('fellowship-route-import-pending',JSON.stringify({url:`https://www.fellowshiplogs.com/reports/${code}?fight=5`,dungeonData:'custom'}));
  },{code});
  let hold=true,release,notifyHeld;
  const firstEventsHeld=new Promise(resolve=>notifyHeld=resolve);
  await page.route('https://www.fellowshiplogs.com/**',async route=>{
    if(route.request().url().endsWith('/oauth/token')){
      const body=new URLSearchParams(route.request().postData());assert.equal(body.get('code_verifier'),'a'.repeat(43));assert.equal(body.get('redirect_uri'),'https://oleg-st.github.io/routes/');
      return route.fulfill({json:{token_type:'Bearer',access_token:'mock-memory-token'}});
    }
    const body=route.request().postDataJSON();requests.push(body);
    if(body.query.includes('RouteImportFights'))return route.fulfill({json:{data:{reportData:{report:{fights:[fight,{...fight,id:6,name:'Urrak Markets',kill:false,difficultyLevel:76,completionTime:0,startTime:20000,endTime:507100}]}}}}});
    const id=body.variables.fights[0];assert.ok([5,6].includes(id));
    if(body.query.includes('RouteImportMetadata'))return route.fulfill({json:{data:{reportData:{report:{fights:[{...fight,id}],masterData:{actors}}}}}});
    assert.ok(body.variables.filter.includes('applydebuff'));assert.ok(body.variables.filter.includes('1002176'));
    if(hold){notifyHeld();await new Promise(resolve=>release=resolve);}
    await route.fulfill({json:{data:{reportData:{report:{events:{data:events.map(e=>({...e,fight:id})),nextPageTimestamp:null}}}}}}).catch(()=>{});
  });
  await page.goto(origin+prefix+'?code=mock-code&state=test-state');
  await firstEventsHeld;
  assert.equal(await page.locator('#log-fight').inputValue(),'5','direct links keep the requested fight, even when a newer one exists');
  assert.equal(await page.locator('#log-fight option:checked').textContent(),'Empyrean Sands · #5 · Eternal 55 · 10:31');
  assert.equal(await page.locator('#log-fight').isVisible(),true);
  assert.equal(await page.locator('#log-fight').isDisabled(),true);
  assert.equal(await page.locator('#log-another').isVisible(),true);
  assert.equal(await page.locator('#log-another').isDisabled(),true);
  await page.screenshot({path:'tmp/log-import-direct-fight.png'});
  hold=false;release();
  await page.waitForFunction(()=>document.querySelector('#route-name')?.value==='Empyrean Sands · #5'&&!document.querySelector('#route-name').disabled);
  assert.equal(page.url(),origin+prefix);assert.equal(await page.locator('#dialog').evaluate(d=>d.open),false);
  assert.equal(await page.locator('#pull-count').textContent(),'1');assert.equal(requests.length,3);
  assert.equal(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('mock-memory-token')),false);
  await page.locator('#import-log-button').click();await page.locator('#log-fight').waitFor();
  assert.equal(await page.locator('#log-fight').inputValue(),'5');
  assert.equal(requests.length,3,'reopening a direct import reuses the fight list');
  const successDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download import diagnostics'}).click();
  const successPayload=JSON.parse(fs.readFileSync(await (await successDownload).path(),'utf8'));
  assert.equal(successPayload.log.fight.id,5);assert.equal(successPayload.error,undefined);
  assert.equal(await page.locator('#log-continue').isHidden(),true);
  await page.locator('#dialog').evaluate(d=>d.close());
  await page.locator('#import-log-button').click();
  assert.equal(await page.locator('#log-fight').inputValue(),'5');assert.equal(requests.length,3,'cached fights reopen without requests');
  hold=true;await page.locator('#log-url').fill(`https://www.fellowshiplogs.com/reports/${code}?fight=5`);await page.locator('#log-load').click();
  await page.waitForFunction(()=>!document.querySelector('#log-stop').hidden);await page.locator('#log-stop').click();
  await page.waitForFunction(()=>document.querySelector('#log-live-status').textContent==='Import cancelled.');release?.();
  assert.equal(await page.locator('#route-name').inputValue(),'Empyrean Sands · #5');assert.equal(await page.locator('#log-live-error').isHidden(),true);
  hold=false;
  await page.locator('#log-url').fill(`https://www.fellowshiplogs.com/reports/${code}`);
  for(const selector of ['?fight=last','#fight=last']){
    await page.locator('#log-url').fill(`https://www.fellowshiplogs.com/reports/${code}${selector}`);
    const beforeLast=requests.length;await page.locator('#log-load').click();
    await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    assert.equal(requests.length,beforeLast+3,'last-fight links load the list and import automatically');
    assert.deepEqual(requests.at(-1).variables.fights,[6]);
    await page.locator('#import-log-button').click();
    assert.equal(await page.locator('#log-fight').inputValue(),'6','reopening preserves the resolved fight');
  }
  await page.locator('#log-url').fill(`https://www.fellowshiplogs.com/reports/${code}`);
  const beforeList=requests.length;await page.locator('#log-load').click();await page.locator('#log-fight').waitFor();
  assert.equal(requests.length,beforeList+1,'listing must not fetch actors or events');
  assert.equal(await page.locator('#log-fight').inputValue(),'6');
  assert.deepEqual(await page.locator('#log-fight option').allTextContents(),['Urrak Markets · #6 · Eternal 56 · Wipe · 8:07','Empyrean Sands · #5 · Eternal 55 · 10:31']);
  assert.equal(await page.getByText(/Dungeon data:/).count(),0);
  await page.screenshot({path:'tmp/log-import-fight-list.png'});
  await page.locator('#log-fight').selectOption('5');await page.locator('#log-load').click();
  await page.waitForFunction(()=>!document.querySelector('#dialog').open);
  assert.deepEqual(requests.at(-1).variables.fights,[5]);
  const afterImport=requests.length;
  await page.locator('#import-log-button').click();await page.locator('#log-fight').waitFor();
  assert.equal(await page.locator('#log-fight').inputValue(),'5');assert.equal(requests.length,afterImport);
  await page.locator('#log-fight').selectOption('6');await page.locator('#log-load').click();
  await page.waitForFunction(()=>!document.querySelector('#dialog').open);
  assert.deepEqual(requests.at(-1).variables.fights,[6]);
  const afterSecondImport=requests.length;
  await page.locator('#import-log-button').click();
  assert.equal(await page.locator('#log-fight').inputValue(),'6');assert.equal(requests.length,afterSecondImport);
  await page.locator('#log-another').click();
  assert.equal(await page.locator('#log-url').inputValue(),'');assert.equal(await page.locator('#log-fight').isHidden(),true);
  assert.equal(await page.locator('#log-load').textContent(),'Load fights');
  assert.equal(await page.locator('#log-url').evaluate(e=>e===document.activeElement),true);
  assert.equal(requests.length,afterSecondImport,'choosing another log does not request anything');
  await page.locator('#dialog').evaluate(d=>d.close());await page.locator('#import-log-button').click();
  assert.equal(await page.locator('#log-url').inputValue(),'');assert.equal(await page.locator('#log-fight').isHidden(),true);
  await page.locator('#log-url').fill(`https://www.fellowshiplogs.com/reports/${code}?fight=5`);
  assert.equal(await page.locator('#log-fight').isHidden(),true);assert.equal(await page.locator('#log-load').textContent(),'Import');
  await page.screenshot({path:'tmp/log-import-live-browser.png'});
  // A failed match preserves the route and exports replayable inputs, without auth.
  events.push({...events[0],timestamp:300,targetInstance:2});
  await page.locator('#log-load').click();
  const diagnosticsButton=page.getByRole('button',{name:'Download import diagnostics'});await diagnosticsButton.waitFor();
  assert.match(await page.locator('#log-live-error').textContent(),/unmatched mobs/);
  assert.match(await page.locator('#log-missing-enemies').textContent(),/Pull 1/);
  assert.equal(await page.locator('#route-name').inputValue(),'Empyrean Sands · #6');
  const downloaded=page.waitForEvent('download');await diagnosticsButton.click();const download=await downloaded;
  assert.equal(download.suggestedFilename(),`route-import-${code}-5.json`);
  const payload=fs.readFileSync(await download.path(),'utf8'),diagnostic=JSON.parse(payload);
  assert.doesNotMatch(payload,/mock-memory-token|mock-code|test-state|Authorization|code_verifier/);
  assert.equal(diagnostic.details.code,'no-compatible-route');assert.equal(diagnostic.log.events.length,2);
  const {matchLiveLog}=await import('../log-import/live-matcher.js');
  await assert.rejects(matchLiveLog(diagnostic.log,{...diagnostic.matching,catalog:new Map(diagnostic.matching.catalog.map(e=>[e.id,e]))}),e=>e.diagnostics?.code==='no-compatible-route');
  const beforeRecovery=requests.length;
  await page.locator('#log-continue').click();
  await page.waitForFunction(()=>!document.querySelector('#dialog').open);
  assert.equal(requests.length,beforeRecovery,'recovery reuses the downloaded log without API requests');
  assert.equal(await page.locator('#route-name').inputValue(),'Empyrean Sands · #5');
  assert.equal(await page.locator('#pull-count').textContent(),'1');
  await page.locator('#import-log-button').click();
  assert.equal(await page.locator('#log-continue').isHidden(),true);
  const recoveredDownload=page.waitForEvent('download');await diagnosticsButton.click();
  const recovered=JSON.parse(fs.readFileSync(await (await recoveredDownload).path(),'utf8'));
  assert.equal(recovered.recovery.matched,1);assert.equal(recovered.recovery.skipped.length,1);
  await page.locator('#log-url').fill(`https://www.fellowshiplogs.com/reports/${code}`);assert.equal(await diagnosticsButton.isHidden(),true);
  assert.deepEqual(errors,[]);console.log('Live import: direct fight URLs, summary-only fight list, latest default, selected fight import, labels, PKCE, worker and cancel passed (mocked API).');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
