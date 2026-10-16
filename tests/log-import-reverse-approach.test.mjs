import test from 'node:test';
import assert from 'node:assert/strict';
import {reverseApproachEvidence,scoreReverseApproach,compareReverseRank} from '../log-import/reverse-approach.js';
const member={placementId:'m',worldPosition:{x:0,y:0}},packs=[{id:'p',placements:[member]}];
const player={type:'Player',key:'runner',visibility:'visible',hp:10,t:10,x:828,y:0};
const run=(extra={})=>reverseApproachEvidence({packs,observations:[player],radius:1000,...extra});
test('Any living visible player supplies soft skipped-pack evidence; selected packs explain it',()=>{
 const evidence=run();assert.equal(evidence[0].closest.distance,828);
 assert.equal(scoreReverseApproach(evidence,[]).missedPackCount,1);
 assert.equal(scoreReverseApproach(evidence,['p']).missedPackCount,0);
});
test('Invisible, unknown, dead and NPC observations do not imply body aggro',()=>{
 for(const change of [{visibility:'invisible'},{visibility:'unknown'},{hp:0},{type:'NPC'}])assert.deepEqual(run({observations:[{...player,...change}]}),[]);
});
test('No reverse inference from unknown patrol phase, replaced members, later visits or known engagement',()=>{
 assert.deepEqual(run({packs:[{id:'p',placements:[{...member,patrolPath:[{x:0,y:0},{x:2000,y:0}]}]}]}),[]);
 assert.deepEqual(run({removedPlacementIDs:['m']}),[]);
 assert.deepEqual(run({endTime:9}),[]);
 assert.deepEqual(run({engagedAt:new Map([['p',10]])}),[]);
});
test('Repeated samples do not multiply the penalty; strong evidence ranks but does not reject',()=>{
 const e=run({observations:[player,{...player,t:11,x:500}]});assert.equal(e.length,1);assert.equal(e[0].first.t,10);assert.equal(e[0].closest.distance,500);
 const a={score:999999,reverse:scoreReverseApproach(e,['p'])},b={score:0,reverse:scoreReverseApproach(e,[])};
 assert.ok(compareReverseRank(a,b)<0);assert.equal([a,b].sort(compareReverseRank).length,2);
});
