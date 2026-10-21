// Test our verification lifecycle with a stub widget, never bypass a real Turnstile challenge.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({stdin:{contents:`import {createOptionalTurnCredentials} from './collaboration/turn-credentials.js';import {verifyTurnstile} from './collaboration/turn-verification.js';window.makeClient=()=>createOptionalTurnCredentials({settings:{endpoint:'https://relay.test/credentials',siteKey:'test-public-key'},verify:verifyTurnstile});window.client=window.makeClient();window.start=()=>{window.outcome=null;window.client(window.config).then(value=>window.outcome={value},error=>window.outcome={error:error.message});};`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><style>'+fs.readFileSync('styles.css','utf8')+'</style><button onclick="start()">Connect</button><script>'+bundle.outputFiles[0].text+'</script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];let scripts=0,requests=0,deny=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',route=>{scripts++;return route.fulfill({contentType:'text/javascript',body:`window.turnstile={render(root,options){if(options.action!=='route-together-turn')throw Error('Wrong action');window.widgetOptions=options;const b=document.createElement('button');b.textContent='Test verification';b.onclick=()=>options.callback('test-token');root.append(b);return 'test-widget';},remove(){}};`});});
  await page.route('https://relay.test/credentials',route=>{
    const headers={'Access-Control-Allow-Origin':new URL(page.url()).origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    requests++;assert.deepEqual(route.request().postDataJSON(),{token:'test-token'});
    return route.fulfill({status:deny?429:200,headers,contentType:'application/json',body:JSON.stringify({iceServers:[{urls:['turns:turn.cloudflare.com:443?transport=tcp'],username:'temporary',credential:'temporary'}],expiresAt:Date.now()+14400000})});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);assert.equal(scripts,0);assert.equal(requests,0);
  await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:'Test verification'}).waitFor();
  assert.equal(await page.locator('.turn-verification').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:'tmp/turn-verification.png'});await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>window.outcome?.error);assert.equal(requests,0);assert.equal(await page.locator('.turn-verification').count(),0);
  await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:'Test verification'}).click();await page.waitForFunction(()=>window.outcome?.value);assert.equal(requests,1);assert.equal(scripts,1);
  assert.equal(await page.evaluate(()=>window.outcome.value.turnConfig[0].username),'temporary');assert.equal(await page.locator('.turn-verification').count(),0);
  await page.getByRole('button',{name:'Connect',exact:true}).click();await page.waitForFunction(()=>window.outcome?.value);assert.equal(requests,1);
  await page.reload();await page.getByRole('button',{name:'Connect',exact:true}).click();await page.waitForFunction(()=>window.outcome?.value);assert.equal(requests,1);assert.equal(scripts,1);assert.equal(await page.locator('.turn-verification').count(),0);
  deny=true;await page.evaluate(()=>{sessionStorage.clear();window.client=window.makeClient();});await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:'Test verification'}).click();await page.waitForFunction(()=>window.outcome?.value);assert.deepEqual(await page.evaluate(()=>window.outcome.value),{});
  await page.evaluate(()=>window.config={rtcConfig:{iceTransportPolicy:'relay'}});await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:'Test verification'}).click();await page.waitForFunction(()=>window.outcome?.error);assert.match(await page.evaluate(()=>window.outcome.error),/minute/);
  await page.evaluate(()=>window.config={});const beforeFailure=requests;await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:'Test verification'}).waitFor();await page.evaluate(()=>window.widgetOptions['error-callback']());await page.waitForFunction(()=>window.outcome?.value);assert.deepEqual(await page.evaluate(()=>window.outcome.value),{});assert.equal(requests,beforeFailure);assert.equal(await page.locator('.turn-verification').count(),0);
  await page.evaluate(()=>window.client=window.makeClient());await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:'Test verification'}).waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>window.outcome?.error);assert.equal(await page.locator('.turn-verification').count(),0);
  assert.deepEqual(errors,[]);console.log('TURN verification: lazy loading, cancellation, retry, temporary credentials, reload cache, direct fallback, strict relay-only, Escape and mobile layout passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
