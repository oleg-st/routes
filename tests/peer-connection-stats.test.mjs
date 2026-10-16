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
  assert.deepEqual(await peerConnectionStats(pc),{connection:'direct',pingMs:100});
});
