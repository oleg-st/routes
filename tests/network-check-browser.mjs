// Real browser ICE gathering; only the Nostr relay is controlled.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:['app.js'],bundle:true,format:'esm',write:false,alias:{'loro-crdt':'loro-crdt/base64'},plugins:[{name:'probe-settings',setup(b){b.onLoad({filter:/[/\\]room-config\.js$/},()=>({loader:'js',contents:"export const roomAppId='network-check-test';export const roomTransportConfig={relayConfig:{urls:['wss://probe.test']},rtcConfig:{iceServers:[]}};"}));}}]});
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const url=String(data).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});server.on('error',reject);});
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000}}),active=new Set(),errors=[];let connections=0;
  await context.routeWebSocket('wss://probe.test',ws=>{connections++;active.add(ws);ws.onMessage(message=>{const [type,id]=JSON.parse(String(message));if(type==='REQ')ws.send(JSON.stringify(['EOSE',id]));else assert.equal(type,'CLOSE','The probe must never publish signaling events');});ws.onClose(()=>active.delete(ws));});
  await context.route(origin+'/app.js',r=>r.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));
  await context.addInitScript(()=>{const Native=window.RTCPeerConnection;window.probeCount=0;window.probeActive=0;window.RTCPeerConnection=class extends Native{
    constructor(config){super(config);window.probeCount++;window.probeActive++;this.counted=true;}
    createOffer(...args){return window.stallProbe?new Promise(()=>{}):super.createOffer(...args);}
    close(){if(this.counted){this.counted=false;window.probeActive--;}super.close();}
  };});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});
  assert.equal(connections,0);assert.equal(await page.evaluate(()=>probeCount),0);
  await page.locator('#together').click();await page.waitForFunction(()=>document.querySelector('[data-network-title]')?.textContent==='TURN may be needed');
  assert.match(await page.locator('[data-network-components]').textContent(),/Signaling: responded/);assert.equal(await page.evaluate(()=>probeActive),0);assert.ok(connections>0);assert.ok(await page.locator('#room-create').isEnabled());
  await page.screenshot({path:'tmp/network-check.png'});
  // Profile preferences persist across tabs, while invitations only offer joining or declining.
  assert.equal(await page.locator('#room-class-label').textContent(),'Class');
  const options=await page.locator('#room-class-options [role=option]').allTextContents();assert.ok(options.includes('Sylvie'));assert.ok(options.every(text=>!text.includes(' · ')));
  await page.locator('#room-class-button').focus();await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.locator('#room-class').inputValue(),'gunde');
  await page.locator('#room-class-button').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#room-class-options').isHidden(),true);assert.equal(await page.locator('#dialog').isVisible(),true);
  await page.locator('#room-class-button').click();await page.locator('#room-class-options img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await page.screenshot({path:'tmp/route-together-class-picker.png'});await page.keyboard.press('Escape');
  await page.locator('#room-name').fill('Remembered player');await page.locator('#room-class-button').click();await page.locator('[data-class-id="mosse"]').click();
  await page.locator('#close-dialog').click();await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});await page.locator('#together').click();
  assert.equal(await page.locator('#room-name').inputValue(),'Remembered player');assert.equal(await page.locator('#room-class').inputValue(),'mosse');
  const invited=await context.newPage();await invited.goto(origin+'/#room=ZZZZZZZZ2345');await invited.locator('#room-join').waitFor();
  assert.equal(await invited.locator('#room-create').count(),0);assert.equal(await invited.locator('#room-code').inputValue(),'ZZZZZZZZ2345');assert.equal(await invited.locator('#room-code').isEditable(),false);
  assert.equal(await invited.locator('#room-name').inputValue(),'Remembered player');assert.equal(await invited.locator('#room-class').inputValue(),'mosse');assert.equal(await invited.locator('#room-bar').isHidden(),true);
  await invited.screenshot({path:'tmp/route-together-invitation.png'});
  await invited.locator('#room-decline').click();await invited.waitForFunction(()=>!location.hash);await invited.reload();await invited.locator('#map-loading').waitFor({state:'hidden'});assert.equal(await invited.locator('#dialog').isVisible(),false);
  await invited.locator('#together').click();assert.ok(await invited.locator('#room-create').isVisible());assert.equal(await invited.locator('#room-decline').count(),0);await invited.locator('#close-dialog').click();
  // Closing or pressing Escape also declines an invitation without joining a room.
  for(const dismiss of ['close','escape']){await invited.evaluate(()=>location.hash='room=ZZZZZZZZ2345');await invited.locator('#room-decline').waitFor();if(dismiss==='close')await invited.locator('#close-dialog').click();else await invited.keyboard.press('Escape');await invited.waitForFunction(()=>!location.hash);assert.equal(await invited.locator('#room-bar').isHidden(),true);}
  await invited.setViewportSize({width:390,height:844});await invited.locator('#together').click();
  const nameBox=await invited.locator('#room-name').boundingBox(),classBox=await invited.locator('#room-class-button').boundingBox(),createBox=await invited.locator('#room-create').boundingBox();assert.ok(classBox.y>=nameBox.y+nameBox.height+12);assert.ok(createBox.y>=classBox.y+classBox.height+12);
  assert.ok(await invited.locator('#dialog-content').evaluate(el=>el.scrollWidth<=el.clientWidth));await invited.screenshot({path:'tmp/route-together-mobile.png'});
  await invited.locator('#room-network summary').click();await invited.locator('#turn-only').scrollIntoViewIfNeeded();const checkbox=await invited.locator('#turn-only').boundingBox();assert.equal(checkbox.width,16);assert.ok(await invited.locator('#dialog-content').evaluate(el=>el.scrollWidth<=el.clientWidth));await invited.locator('#turn-only').check();assert.ok(await invited.locator('#turn-only').isChecked());await invited.screenshot({path:'tmp/route-together-network-expanded.png'});await invited.close();

  await page.evaluate(()=>window.stallProbe=true);await page.locator('[data-network-retry]').click();await page.waitForFunction(()=>probeActive===1);await page.locator('#close-dialog').click();await page.waitForFunction(()=>probeActive===0);
  await page.evaluate(()=>window.stallProbe=false);await page.locator('#together').click();await page.waitForFunction(()=>document.querySelector('[data-network-title]')?.textContent==='TURN may be needed');await page.locator('#close-dialog').click();
  // Browser capability failures are actionable without mislabeling them as NAT problems.
  await page.evaluate(()=>window.RTCPeerConnection=undefined);const before=connections;await page.locator('#together').click();await page.waitForFunction(()=>document.querySelector('[data-network-title]')?.textContent==='WebRTC is unavailable');assert.equal(connections,before);await page.locator('#close-dialog').click();
  assert.deepEqual(errors,[]);await context.close();assert.equal(active.size,0);console.log('Network indicator: on-demand checks, native ICE, relay response, retry, cancellation, unsupported browser, saved profile, invitation decline and mobile layout passed.');
}finally{await browser?.close();server.kill();}
