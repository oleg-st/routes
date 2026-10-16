// Native RTCPeerConnection + Trystero in independent browser profiles.
// Deterministic mode replaces only the Nostr relay, never the WebRTC transport.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const realPublic=process.env.RT_PUBLIC_SIGNALING==='1',site=process.env.RT_SITE==='1';
const bundle=site?null:await build({entryPoints:['app.js'],bundle:true,format:'esm',write:false,alias:{'loro-crdt':'loro-crdt/base64'},plugins:realPublic?[]:[{name:'local-signaling',setup(b){
  b.onLoad({filter:/[/\\]room-config\.js$/},()=>({loader:'js',contents:"export const roomAppId='route-together-browser-test';export const roomTransportConfig={relayConfig:{urls:['wss://relay.route-together.test'],redundancy:1},rtcConfig:{iceServers:[]},_test_only_mdnsHostFallbackToLoopback:true};"}));
  // Controlled local WebRTC must not depend on a public TURN verification flow.
  b.onLoad({filter:/[/\\]turn-service-config\.js$/},()=>({loader:'js',contents:'export const turnServiceConfig={};'}));
}}]});
const root=path.resolve(site?'dist':'.'),prefix=site?'/RoutePlanner/':'/';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,url.pathname.slice(prefix.length)||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.avif':'image/avif'}[path.extname(file)]||'application/octet-stream'});res.end(bytes);});
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const sockets=new Map(),events=[];
function relay(ws){
  const subscriptions=new Map();sockets.set(ws,subscriptions);
  const matches=(e,f)=>(!f.kinds||f.kinds.includes(e.kind))&&(!f['#x']||e.tags?.some(([k,v])=>k==='x'&&f['#x'].includes(v)))&&(!f.since||e.created_at>=f.since);
  ws.onMessage(message=>{
    const [type,id,...rest]=JSON.parse(String(message));
    if(type==='REQ'){subscriptions.set(id,rest);for(const e of events)if(rest.some(f=>matches(e,f)))ws.send(JSON.stringify(['EVENT',id,e]));ws.send(JSON.stringify(['EOSE',id]));}
    if(type==='CLOSE')subscriptions.delete(id);
    if(type==='EVENT'){const e=id;events.push(e);for(const [socket,subs]of sockets)for(const [sub,filters]of subs)if(filters.some(f=>matches(e,f)))socket.send(JSON.stringify(['EVENT',sub,e]));ws.send(JSON.stringify(['OK',e.id,true,'']));}
  });ws.onClose(()=>sockets.delete(ws));
}
try{
  const origin=`http://127.0.0.1:${server.address().port}${prefix}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[],contexts=[];
  async function page(hash=''){const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);if(!realPublic)await context.routeWebSocket(/wss?:\/\//,relay);if(bundle)await context.route(origin+'app.js',r=>r.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));const p=await context.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+hash);await p.locator('#map-loading').waitFor({state:'hidden'});return p;}
  const waiting=await page('#room=ZZZZZZZZ2345');await waiting.locator('#room-name').fill('Waiting');await waiting.locator('#room-join').click();await waiting.locator('#dialog').waitFor({state:'hidden'});await waiting.locator('#room-waiting').waitFor();assert.equal(await waiting.locator('#workspace').isHidden(),true);assert.equal(await waiting.locator('#export').isDisabled(),true);await waiting.locator('#room-leave').click();await waiting.locator('#workspace').waitFor();await waiting.context().close();
  const a=await page();await a.locator('#together').click();await a.locator('#room-name').fill('Leader');await a.locator('#room-class-button').click();await a.locator('[data-class-id="rime"]').click();await a.locator('#room-create').click();await a.locator('#dialog').waitFor({state:'hidden'});const code=await a.locator('#room-code-display').textContent();console.log('Created room',code);
  async function join(role='player',name='Guest') {const p=await page('#room='+code);await p.locator('#room-name').fill(name);await p.locator('#room-class-button').click();await p.locator('[data-class-id="lisa"]').click();assert.equal(await p.locator('#room-code').inputValue(),code.replaceAll('-',''));await p.locator('#room-role').selectOption(role);await p.locator('#room-join').click();await p.locator('#dialog').waitFor({state:'hidden'});return p;}
  const creatorSession=await a.locator('#room-avatars [data-avatar-session]').getAttribute('data-avatar-session');
  await a.reload();await a.waitForFunction(()=>!document.querySelector('#room-bar').hidden&&!document.querySelector('#workspace').hidden);
  assert.equal(await a.locator('#room-avatars [data-avatar-session]').count(),1);assert.equal(await a.locator('#room-avatars .room-crown').count(),1);
  assert.match(await a.locator('#room-avatars').innerText(),/Leader/);assert.equal(await a.locator('#room-session-count').innerText(),'Sessions 1/4');
  assert.notEqual(await a.locator('#room-avatars [data-avatar-session]').getAttribute('data-avatar-session'),creatorSession);
  assert.equal(await a.locator('#dungeon').isEnabled(),true);assert.equal(await a.locator('#room-code-display').textContent(),code);
  const kicked=await join('player','Remove me');await kicked.waitForFunction(()=>document.querySelector('#room-status').dataset.sync==='synced');
  assert.equal(await kicked.locator('[data-kick-session]').count(),0);
  const kickSession=await kicked.locator('#room-session-list [data-session]').first().getAttribute('data-session');
  await a.locator('[data-avatar-session="'+kickSession+'"]').hover();await a.locator('[data-kick-session="'+kickSession+'"]').click();await a.locator('#room-kick-cancel').click();assert.equal(await kicked.locator('#room-bar').isVisible(),true);
  await a.locator('[data-avatar-session="'+kickSession+'"]').hover();await a.locator('[data-kick-session="'+kickSession+'"]').click();await a.screenshot({path:'tmp/route-together-kick.png'});await a.locator('#room-kick-confirm').click();
  await kicked.locator('#room-bar').waitFor({state:'hidden'});assert.equal(new URL(kicked.url()).hash,'');assert.equal(await kicked.evaluate(()=>sessionStorage.getItem('rt-room')),null);assert.equal(await kicked.locator('#add-pull').isEnabled(),true);
  await kicked.getByText('You were disconnected by the room creator.',{exact:true}).waitFor();assert.equal(await a.locator('#room-code-display').textContent(),code);
  await kicked.reload();assert.equal(await kicked.locator('#room-bar').isHidden(),true);await kicked.context().close();
  const b=await join();
  assert.ok(new URL(b.url()).hash.startsWith('#room='),'Accepting an invitation must retain the room URL');
  await b.waitForFunction(()=>!document.querySelector('#workspace').hidden,{},{timeout:realPublic?60000:20000});console.log('WebRTC connected');
  await a.locator('#add-pull').click();await b.waitForFunction(()=>document.querySelector('#pull-count').textContent==='2');
  await b.locator('#shadow').click();await a.waitForFunction(()=>document.querySelector('#shadow').getAttribute('aria-pressed')==='true');
  const map=await b.locator('#map').boundingBox(),click=(x,y)=>b.mouse.click(map.x+x,map.y+y);
  await b.locator('[data-tool=marker]').click();await click(400,380);await b.locator('#marker-label').fill('Team marker');await b.locator('#place-marker').click();
  await b.locator('[data-tool=note]').click();await click(500,420);await b.getByRole('textbox',{name:'Note text'}).fill('Shared note');await b.locator('#place-note').click();
  for(const [tool,y] of [['line',220],['portal',300],['invis',500]]){await b.locator('[data-tool='+tool+']').click();await click(280,y);await click(600,y);}
  await a.waitForFunction(()=>document.querySelectorAll('#drawings > g').length===5);
  const viewer=await join('spectator','Guest');await viewer.waitForFunction(()=>!document.querySelector('#workspace').hidden);
  await viewer.waitForFunction(()=>document.querySelectorAll('#drawings > g').length===5);assert.equal(await viewer.locator('#add-pull').isDisabled(),true);assert.equal(await viewer.locator('#undo').isDisabled(),true);await viewer.keyboard.press('n');assert.equal(await viewer.locator('#pull-count').textContent(),'2');
  await a.locator('#room-sessions').evaluate(e=>e.open=true);await a.waitForFunction(()=>document.querySelectorAll('#room-session-list li[data-session]').length===3);
  assert.equal(new Set(await a.locator('#room-session-list [data-session]').evaluateAll(es=>es.map(e=>e.dataset.session))).size,3);
  await a.waitForFunction(()=>document.querySelector('#room-session-list [data-leader=true]')?.textContent.includes('Rime'));
  assert.equal(await a.locator('#room-avatars [data-avatar-session]').count(),3);assert.equal(await a.locator('#room-avatars .room-empty-slot').count(),1);assert.equal(await a.locator('#room-avatars .room-crown').count(),1);await a.locator('#room-avatars img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await a.locator('#room-avatars').screenshot({path:'tmp/route-together-roster.png'});
  const originalSession=await b.locator('#room-session-list [data-session]').first().getAttribute('data-session');
  await b.locator('#room-profile').click();await b.waitForFunction(()=>document.querySelector('#room-network-check')?.dataset.state==='direct');await b.locator('#room-name').fill('Cursor player');await b.locator('#room-class-button').click();await b.locator('[data-class-id="warmaster"]').click();await b.locator('#room-profile-save').click();
  await a.waitForFunction(()=>[...document.querySelectorAll('#room-session-list li')].some(li=>li.textContent.includes('Cursor player')&&li.textContent.includes('Helena')));
  assert.equal(await b.locator('#room-session-list [data-session]').first().getAttribute('data-session'),originalSession);
  const remote=a.locator('#remote-cursors [data-cursor-session="'+originalSession+'"]');
  const moveCursor=async(p)=>{const target=await p.locator('#map').evaluate(el=>{const v=el.viewBox.baseVal,point=el.createSVGPoint();point.x=v.x+v.width*.42;point.y=v.y+v.height*.48;const screen=point.matrixTransform(el.getScreenCTM());return {x:point.x,y:point.y,clientX:screen.x,clientY:screen.y};});await p.mouse.move(target.clientX,target.clientY);return target;};
  await a.locator('#room-sessions').evaluate(e=>e.open=false);const target=await moveCursor(b);await remote.waitFor();
  assert.ok(Math.abs(Number(await remote.getAttribute('data-map-x'))-target.x)<1);assert.equal(await remote.locator('text').textContent(),'Cursor player');assert.equal(await remote.locator('path').getAttribute('fill'),'#B46831');assert.match(await remote.locator('image').getAttribute('href'),/warmaster-hero-200.avif/);await remote.locator('image').evaluate(el=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=el.getAttribute('href');}));await a.screenshot({path:'tmp/route-together-cursor.png'});await remote.screenshot({path:'tmp/route-together-cursor-detail.png'});
  await viewer.locator('#remote-cursors [data-cursor-session="'+originalSession+'"] ').waitFor();
  await a.waitForFunction(()=>[...document.querySelectorAll('.room-ping')].filter(e=>/^\d+ ms$/.test(e.textContent)).length===2);
  await viewer.waitForFunction(()=>[...document.querySelectorAll('.room-ping')].filter(e=>/^\d+ ms$/.test(e.textContent)).length===2);
  assert.match(await a.locator('#room-session-list').textContent(),/Ping \d+ ms/);
  assert.equal(await a.locator('.room-ping').first().textContent(),'you');
  await a.locator('#room-avatars').screenshot({path:'tmp/route-together-ping.png'});
  await a.setViewportSize({width:820,height:850});
  for(const ping of await a.locator('.room-ping').all())assert.equal(await ping.isVisible(),true);
  await a.locator('#room-avatars').screenshot({path:'tmp/route-together-ping-narrow.png'});
  await a.setViewportSize({width:1180,height:850});await a.mouse.move(450,450);await a.mouse.wheel(0,-300);await remote.waitFor();assert.ok(Math.abs(Number(await remote.getAttribute('data-map-x'))-target.x)<1,'Remote coordinates must survive another viewport and zoom');
  const viewerSession=await viewer.locator('#room-session-list [data-session]').first().getAttribute('data-session');await moveCursor(viewer);assert.equal(await a.locator('#remote-cursors [data-cursor-session="'+viewerSession+'"]').count(),0);
  await b.mouse.move(10,10);assert.equal(await remote.count(),1);
  await moveCursor(b);await remote.waitFor();await b.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await remote.count(),1);
  await b.locator('#room-profile').click();assert.equal(await remote.count(),1);await b.locator('#close-dialog').click();
  // Simulate a hidden tab and wait beyond the former cursor TTL; the last point remains.
  await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await new Promise(resolve=>setTimeout(resolve,3200));assert.equal(await remote.count(),1);assert.ok(Math.abs(Number(await remote.getAttribute('data-map-x'))-target.x)<1);
  await b.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  // The creator can switch everyone to another dungeon and restore its previous room route.
  const previousDungeon=await a.locator('#dungeon').inputValue(),nextDungeon=await a.locator('#dungeon option').evaluateAll((options,current)=>options.find(o=>o.value!==current).value,previousDungeon);
  assert.equal(await a.locator('#dungeon').isDisabled(),false);assert.equal(await b.locator('#dungeon').isDisabled(),true);assert.equal(await viewer.locator('#dungeon').isDisabled(),true);
  await a.locator('#dungeon').selectOption(nextDungeon);await Promise.all([a,b,viewer].map(p=>p.waitForFunction(id=>document.querySelector('#dungeon').value===id&&document.querySelector('#pull-count').textContent==='1',nextDungeon)));
  assert.equal(await remote.count(),0);assert.equal(await b.locator('#room-code-display').textContent(),code);assert.equal(await b.locator('#room-session-list [data-session]').first().getAttribute('data-session'),originalSession);assert.equal(await viewer.locator('#add-pull').isDisabled(),true);
  await a.locator('#add-pull').click();await b.waitForFunction(()=>document.querySelector('#pull-count').textContent==='2');
  await a.locator('#dungeon').selectOption(previousDungeon);await b.waitForFunction(id=>document.querySelector('#dungeon').value===id&&document.querySelectorAll('#drawings > g').length===5,previousDungeon);
  assert.equal(await b.locator('#pull-count').textContent(),'2');
  const archived=await b.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('fellowship-route-together');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('bookmarks'),read=tx.objectStore('bookmarks').getAll();read.onsuccess=()=>resolve(read.result);tx.oncomplete=()=>db.close();};}));
  assert.ok(archived.some(route=>route.dungeonId===previousDungeon));assert.ok(archived.some(route=>route.dungeonId===nextDungeon));
  await a.reload();await a.waitForFunction(()=>!document.querySelector('#room-bar').hidden&&!document.querySelector('#workspace').hidden);await a.waitForFunction(()=>document.querySelector('#room-session-list [data-leader=true]')?.textContent.includes('(you)'));
  // Persisting and reconnecting keeps lineage and role without sharing IndexedDB across contexts.
  await b.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});await b.reload();await b.waitForFunction(()=>!document.querySelector('#room-bar').hidden&&!document.querySelector('#workspace').hidden);
  assert.equal(await b.locator('#pull-count').textContent(),'2');await b.locator('#add-pull').click();await a.waitForFunction(()=>document.querySelector('#pull-count').textContent==='3');
  await moveCursor(a);const creatorCursor=b.locator('#remote-cursors [data-cursor-session]');await creatorCursor.waitFor();await a.locator('#room-leave').click();await creatorCursor.waitFor({state:'detached'});await b.waitForFunction(()=>document.querySelectorAll('#room-session-list li[data-session]').length===2);
  assert.equal(await b.locator('#room-session-list [data-leader=true]').count(),0);
  const late=await join('player','Late');await late.waitForFunction(()=>!document.querySelector('#workspace').hidden);assert.equal(await late.locator('#pull-count').textContent(),'3');
  assert.equal(await late.locator('#drawings > g').count(),5);
  if(!realPublic){
    const fourth=await join('player','Fourth');await fourth.waitForFunction(()=>!document.querySelector('#workspace').hidden);
    await b.waitForFunction(()=>document.querySelectorAll('#room-session-list [data-session]').length===4&&document.querySelector('#room-status').dataset.state==='connected');
    const started=Date.now();await b.locator('#add-pull').click();await Promise.all([viewer,late,fourth].map(p=>p.waitForFunction(()=>document.querySelector('#pull-count').textContent==='4',{}, {timeout:2500})));await b.waitForFunction(()=>document.querySelector('#room-status').dataset.state==='connected',{}, {timeout:2500});console.log('Four-session edit + acknowledgment: '+(Date.now()-started)+' ms (local machine)');
    await Promise.all([b,viewer,late,fourth].map(p=>p.waitForFunction(()=>document.querySelector('#room-status').dataset.sync==='synced')));
    const fourthSession=await fourth.locator('#room-session-list [data-session]').first().getAttribute('data-session');await moveCursor(fourth);await b.locator('#remote-cursors [data-cursor-session="'+fourthSession+'"]').waitFor();
    const fifth=await join('player','Fifth');await fifth.waitForFunction(()=>document.querySelector('#room-status').dataset.state==='full');assert.equal(await fifth.locator('#workspace').isHidden(),true);
    await fourth.locator('#room-leave').click();await b.waitForFunction(()=>document.querySelectorAll('#room-session-list li[data-session]').length===3);
    await fifth.locator('#room-reconnect').click();await fifth.waitForFunction(()=>!document.querySelector('#workspace').hidden).catch(async error=>{console.log('Fifth reconnect:',await fifth.locator('#room-bar').innerText(),await b.locator('#room-bar').innerText());throw error;});await b.waitForFunction(()=>document.querySelectorAll('#room-session-list li[data-session]').length===4);
  }
  await b.locator('#room-sessions').evaluate(e=>e.open=true);await b.screenshot({path:'tmp/route-together-room.png'});
  assert.deepEqual(errors,[]);console.log(`Room UI: native WebRTC, ${realPublic?'public':'controlled'} Nostr, ${site?'Pages bundle':'source bundle'}, isolated storage, player/spectator, session roster, refresh and creator departure passed.`);
  for(const c of contexts)await c.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
