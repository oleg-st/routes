import test from 'node:test';
import assert from 'node:assert/strict';
import {peerConnectionStats} from '../collaboration/peer-connection-stats.js';

test('Ping uses the selected ICE pair RTT in milliseconds for direct and relay connections',async()=>{
  const stats=new Map([
    ['transport',{type:'transport',selectedCandidatePairId:'selected'}],
    ['other',{type:'candidate-pair',nominated:true,state:'succeeded',currentRoundTripTime:9}],
    ['selected',{type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.0476}],
    ['local',{candidateType:'host'}],['remote',{candidateType:'srflx'}],
  ]);
  const pc={connectionState:'connected',getStats:async()=>stats};
  assert.deepEqual(await peerConnectionStats(pc),{connection:'direct',pingMs:48});
  stats.get('remote').candidateType='relay';assert.deepEqual(await peerConnectionStats(pc),{connection:'relay',pingMs:48});
  for(const rtt of [undefined,NaN,Infinity,-1]){stats.get('selected').currentRoundTripTime=rtt;assert.equal((await peerConnectionStats(pc)).pingMs,null);}
  stats.get('selected').currentRoundTripTime=0;assert.equal((await peerConnectionStats(pc)).pingMs,0);
  pc.connectionState='disconnected';assert.equal((await peerConnectionStats(pc)).pingMs,null);
});

test('Missing stats stay unknown; nominated pair is used if selected-pair reference is unavailable',async()=>{
  assert.deepEqual(await peerConnectionStats(null),{connection:'unknown',pingMs:null});
  const stats=new Map(),pc={connectionState:'connected',getStats:async()=>stats};
  assert.deepEqual(await peerConnectionStats(pc),{connection:'unknown',pingMs:null});
  stats.set('pair',{type:'candidate-pair',nominated:true,state:'succeeded',currentRoundTripTime:.1});
  assert.deepEqual(await peerConnectionStats(pc),{connection:'unknown',pingMs:100});
  Object.assign(stats.get('pair'),{localCandidateId:'local',remoteCandidateId:'remote'});
  stats.set('local',{candidateType:'host'});stats.set('remote',{candidateType:'prflx'});
  assert.deepEqual(await peerConnectionStats(pc),{connection:'direct',pingMs:100});
});

test('Incomplete candidate details never imply direct; a known relay on either side is sufficient',async()=>{
  const stats=new Map([
    ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
    ['pair',{type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.02}],
  ]);
  const pc={connectionState:'connected',getStats:async()=>stats};
  for(const [local,remote,expected] of [
    [undefined,undefined,'unknown'],
    ['host',undefined,'unknown'],
    [undefined,'srflx','unknown'],
    ['host','unexpected','unknown'],
    ['relay',undefined,'relay'],
    [undefined,'relay','relay'],
    ['relay','host','relay'],
    ['srflx','host','direct'],
  ]){
    if(local===undefined)stats.delete('local');else stats.set('local',{candidateType:local});
    if(remote===undefined)stats.delete('remote');else stats.set('remote',{candidateType:remote});
    assert.deepEqual(await peerConnectionStats(pc),{connection:expected,pingMs:20},`${local}/${remote}`);
  }
});
