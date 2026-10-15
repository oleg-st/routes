import test from 'node:test';
import assert from 'node:assert/strict';
import {networkProbeSettings,probeStun,probeRelay,runNetworkProbe,networkVerdict} from '../collaboration/network-check.js';
function rtc(mode){const instances=[];return {instances,PeerConnection:class{
  constructor(config){this.config=config;this.closed=false;instances.push(this);}
  createDataChannel(){}
  createOffer(){return mode==='hang'?new Promise(()=>{}):Promise.resolve({type:'offer',sdp:'test'});}
  async setLocalDescription(){if(mode==='error')throw Error('Blocked');queueMicrotask(()=>{this.onicecandidate?.({candidate:{type:mode==='srflx'?'srflx':'host',address:'private-data-not-for-output'}});this.onicecandidate?.({candidate:null});});}
  close(){this.closed=true;}
}};}
function sockets(mode){const instances=[];return {instances,Socket:class{
  constructor(url){this.url=url;this.readyState=0;this.messages=[];instances.push(this);queueMicrotask(()=>{if(this.closed)return;this.readyState=1;this.onopen?.();});}
  send(message){const data=JSON.parse(message);this.messages.push(data);if(data[0]==='REQ'&&mode!=='hang')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify([mode==='reject'?'CLOSED':'EOSE',data[1]])}));}
  close(){this.closed=true;this.readyState=3;}
}};}

test('Preflight settings use the room relays and strip TURN and credentials',async()=>{
  const result=await networkProbeSettings({relayConfig:{urls:['wss://test.invalid']},rtcConfig:{iceServers:[{urls:['turn:private.invalid','stun:stun.invalid'],username:'secret-user',credential:'secret-password'},{urls:'turns:private.invalid'}]}});
  assert.deepEqual(result,{iceServers:[{urls:['stun:stun.invalid']}],relayUrls:['wss://test.invalid']});assert.ok(!JSON.stringify(result).includes('secret'));
});

test('A STUN candidate is evidence only; host candidates do not imply Internet reachability',async()=>{
  for(const [mode,expected]of [['srflx','reachable'],['host','unconfirmed'],['error','unavailable']]){
    const fake=rtc(mode),result=await probeStun({iceServers:[],...fake});assert.equal(result,expected);assert.ok(fake.instances.every(pc=>pc.closed));assert.equal(fake.instances[0].onicecandidate,null);
  }
  assert.equal(await probeStun({PeerConnection:null,iceServers:[]}), 'unsupported');
});

test('STUN timeout and cancellation close even a stalled offer',async()=>{
  const stalled=rtc('hang');assert.equal(await probeStun({iceServers:[],timeoutMs:10,...stalled}),'unconfirmed');assert.ok(stalled.instances[0].closed);
  const cancelled=rtc('hang'),controller=new AbortController(),pending=probeStun({iceServers:[],signal:controller.signal,...cancelled});controller.abort();assert.equal(await pending,'cancelled');assert.ok(cancelled.instances[0].closed);
});

test('Relay access requires a Nostr response, not just an open WebSocket',async()=>{
  for(const [mode,expected]of [['ok',true],['reject',false],['hang',false]]){
    const fake=sockets(mode);assert.equal(await probeRelay('wss://test.invalid',{...fake,timeoutMs:10}),expected);assert.ok(fake.instances[0].closed);assert.deepEqual(fake.instances[0].messages.map(m=>m[0]),['REQ','CLOSE']);
  }
});

test('Parallel checks report partial results and release all resources',async()=>{
  const web=rtc('srflx'),ws=sockets('ok'),updates=[],result=await runNetworkProbe({...web,...ws,iceServers:[],relayUrls:['wss://one.invalid','wss://two.invalid'],onUpdate:r=>updates.push(r)});
  assert.equal(result.stun,'reachable');assert.equal(result.relay,'reachable');assert.ok(updates.length>1);assert.ok(web.instances.every(p=>p.closed)&&ws.instances.every(s=>s.closed));
  assert.ok(!JSON.stringify(updates).includes('private-data'));assert.equal(networkVerdict(result).state,'possible');assert.match(networkVerdict(result).detail,/another participant/);
});

test('Offline, unsupported and already cancelled checks do not open connections',async()=>{
  const web=rtc('srflx'),ws=sockets('ok'),base={...web,...ws,iceServers:[],relayUrls:['wss://test.invalid']};
  assert.equal((await runNetworkProbe({...base,online:false})).relay,'skipped');
  assert.equal((await runNetworkProbe({...base,PeerConnection:null})).webrtc,false);
  const controller=new AbortController();controller.abort();let updates=0;await runNetworkProbe({...base,signal:controller.signal,onUpdate:()=>updates++});
  assert.equal(updates,0);assert.equal(web.instances.length,0);assert.equal(ws.instances.length,0);
});

test('Verdicts distinguish uncertainty, signaling failure and actual direct or relay connections',()=>{
  const uncertain={online:true,webrtc:true,stun:'unconfirmed',relay:'reachable'};
  assert.equal(networkVerdict(uncertain).title,'TURN may be needed');
  assert.equal(networkVerdict({...uncertain,relay:'unconfirmed'}).title,'Signaling access not confirmed');
  assert.equal(networkVerdict({...uncertain,stun:'unavailable'}).title,'WebRTC check could not run');
  assert.equal(networkVerdict({online:false}).title,'Browser reports offline');
  assert.equal(networkVerdict({webrtc:false}).title,'WebRTC is unavailable');
  const direct={self:false,status:'connected',connection:'direct'},relay={...direct,connection:'relay'};
  assert.equal(networkVerdict(uncertain,[direct]).title,'Working without TURN');
  assert.equal(networkVerdict(uncertain,[relay]).title,'Connected through TURN');
  assert.equal(networkVerdict(uncertain,[direct,relay]).title,'Some connections use TURN');
  assert.equal(networkVerdict(uncertain,[{...direct,status:'reconnecting'}]).title,'TURN may be needed');
});
