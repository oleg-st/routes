import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPath,connectingThreshold,components,distance3D,samePatrolUnit} from '../scripts/social-pack-model.mjs';
const p=(x,y=0,z=0)=>({x,y,z});
test('Corroborated nearby members on a long shared route form one patrol',()=>{
  const a={worldPosition:p(0),patrolPath:[p(0),p(6000)]};
  const b={worldPosition:p(215),patrolPath:structuredClone(a.patrolPath)};
  assert.equal(samePatrolUnit(a,b,true),true);
  assert.equal(samePatrolUnit(a,b,false),false);
  assert.equal(samePatrolUnit(a,{...b,worldPosition:p(1001)},true),false);
  assert.equal(samePatrolUnit(a,{...b,patrolPath:[p(0),p(5999)]},true),false);
  assert.equal(samePatrolUnit({...a,patrolPath:[p(0),null]},{...b,patrolPath:[p(0),null]},true),false);
});
test('Social geometry uses height and allows indirect links',()=>{
  assert.equal(distance3D(p(0),p(0,600,800)),1000);
  const edges=[{a:'a',b:'b',h:87},{a:'b',b:'c',h:2},{a:'a',b:'c',h:89}];
  assert.equal(connectingThreshold(['a','b','c'],edges,e=>e.h),87);
  assert.equal(components(['a','b','c','d'],edges).length,2);
});
test('A patrol may leave the radius between two covered endpoints',()=>{
  const result=auditPath([p(-1500),p(1500)],[p(-1500),p(1500)],1000);
  assert.equal(result.status,'has-outside-section');
  assert.ok(result.farWitness.distance>1000);
});
test('Overlapping stationary envelopes cover an entire patrol segment',()=>{
  assert.equal(auditPath([p(-1500),p(1500)],[p(-1000),p(0),p(1000)],1000).status,'always-within-radius');
});
test('Patrol encounters between waypoints are detected in 3D',()=>{
  assert.equal(auditPath([p(-2000),p(2000)],[p(0,0,500)],1000).nearestDistance,500);
  assert.equal(auditPath([p(-2000),p(2000)],[p(0,0,1100)],1000).nearestDistance,1100);
});
test('Missing path points do not invent a connecting segment',()=>{
  const r=auditPath([p(-2000),null,p(2000)],[p(0)],1000);
  assert.equal(r.status,'incomplete-path');assert.equal(r.nearestDistance,2000);
});
