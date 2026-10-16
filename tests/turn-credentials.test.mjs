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
