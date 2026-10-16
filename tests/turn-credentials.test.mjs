import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnCredentials} from '../collaboration/turn-credentials.js';
import {connectionConfig} from '../collaboration/connection-config.js';
const settings={endpoint:'https://turn.example/credentials',siteKey:'public-site-key'};
const iceServers=[{urls:['turns:turn.cloudflare.com:443?transport=tcp'],username:'user',credential:'password'}];
test('Automatic TURN is lazy, bypassed for manual servers, cached in memory and renewed on expiry',async()=>{
  let clock=1000,verified=0,issued=0;const get=createTurnCredentials({settings,now:()=>clock,verify:async()=>{verified++;return 'token';},fetchImpl:async(url,options)=>{issued++;assert.equal(url,settings.endpoint);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.deepEqual(JSON.parse(options.body),{token:'token'});return Response.json({iceServers,expiresAt:clock+14400000});}});
  assert.equal(verified,0);const first=await get();assert.deepEqual(first.turnConfig,iceServers);await get();assert.equal(issued,1);
  const manual={turnConfig:[{urls:'turn:manual.example',username:'own',credential:'own'}]};assert.equal(await get(manual),manual);assert.equal(verified,1);
  clock+=14400000;await get();assert.equal(issued,2);
  const explicit=await get({rtcConfig:{iceServers:[{urls:'stun:example.org'}],iceTransportPolicy:'relay'}});assert.equal(explicit.rtcConfig.iceServers.length,2);assert.equal(explicit.rtcConfig.iceTransportPolicy,'relay');
  const disabled=createTurnCredentials({settings:{endpoint:'',siteKey:''},verify:()=>assert.fail()});assert.deepEqual(await disabled(),{});
  assert.equal(connectionConfig({relayOnly:true,automatic:true}).rtcConfig.iceTransportPolicy,'relay');
});
test('Automatic TURN handles denial and bad responses without retaining failed credentials',async()=>{
  for(const status of [403,429,503]){
    const get=createTurnCredentials({settings,verify:async()=>'',fetchImpl:async()=>new Response('private upstream details',{status})});await assert.rejects(get(),error=>!error.message.includes('private'));
  }
  for(const data of [{iceServers,expiresAt:0},{iceServers:[],expiresAt:Date.now()+14400000},{iceServers:[{...iceServers[0],urls:['turn:evil.example:3478?transport=udp']}],expiresAt:Date.now()+14400000}]){
    const get=createTurnCredentials({settings,verify:async()=>'',fetchImpl:async()=>Response.json(data)});await assert.rejects(get(),/Invalid relay/);
  }
});
test('Automatic TURN cancellation never requests credentials after a cancelled verification',async()=>{
  const controller=new AbortController();const get=createTurnCredentials({settings,verify:async()=>{controller.abort();return 'token';},fetchImpl:()=>assert.fail('Must not issue credentials')});await assert.rejects(get({},controller.signal),/abort/i);
});

test('Automatic TURN survives reload without persisting verification tokens and renews before expiry',async()=>{
  let clock=1000,verified=0,issued=0;const values=new Map();
  const storage=()=>({getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
  const options={settings,storage,now:()=>clock,verify:async()=>{verified++;return 'single-use-token';},fetchImpl:async()=>{issued++;return Response.json({iceServers,expiresAt:clock+14400000});}};
  await createTurnCredentials(options)();
  assert.equal([...values.values()].some(value=>value.includes('single-use-token')),false);
  assert.deepEqual((await createTurnCredentials(options)()).turnConfig,iceServers);
  assert.equal(verified,1);assert.equal(issued,1);
  clock+=14400000-30000;await createTurnCredentials(options)();assert.equal(verified,2);assert.equal(issued,2);
});

test('Automatic TURN rejects corrupt, foreign or invalid stored credentials',async()=>{
  const good={endpoint:settings.endpoint,siteKey:settings.siteKey,data:{iceServers,expiresAt:14401000}};
  for(const value of ['broken JSON',JSON.stringify({...good,endpoint:'https://other.example/credentials'}),JSON.stringify({...good,siteKey:'another-key'}),JSON.stringify({...good,data:{...good.data,iceServers:[null]}}),JSON.stringify({...good,data:{...good.data,expiresAt:1}})]){
    let verified=0,removed=0;
    const get=createTurnCredentials({settings,now:()=>1000,storage:()=>({getItem:()=>value,removeItem:()=>removed++,setItem(){}}),verify:async()=>{verified++;return 'token';},fetchImpl:async()=>Response.json(good.data)});
    await get();assert.equal(verified,1);assert.equal(removed,1);
  }
});

test('Automatic TURN remains usable when session storage is blocked or full',async()=>{
  for(const storage of [()=>{throw Error('Blocked');},()=>({getItem(){throw Error('Blocked');},removeItem(){throw Error('Blocked');},setItem(){throw Error('Full');}})]){
    let verified=0;
    const get=createTurnCredentials({settings,storage,verify:async()=>{verified++;return 'token';},fetchImpl:async()=>Response.json({iceServers,expiresAt:Date.now()+14400000})});
    await get();await get();assert.equal(verified,1);
  }
});
