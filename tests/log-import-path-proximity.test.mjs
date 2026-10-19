import test from 'node:test';
import assert from 'node:assert/strict';
import {createPathProximity} from '../log-import/path-proximity.js';
import {createReviewSession} from '../log-import/review-session.js';

const packs=[{id:'a',placements:[{worldPosition:{x:0,y:0}}]},
  {id:'b',placements:[{worldPosition:{x:5000,y:0},patrolPath:[{x:0,y:200},{x:1000,y:200}]}]}];
test('Path ranking uses observed visible living players within the displayed pull window',()=>{
  const closest=createPathProximity(packs,[
    {type:'Player',key:'visible',t:10,x:500,y:0,hp:100,visibility:'visible'},
    {type:'Player',key:'hidden',t:5,x:0,y:0,hp:100,visibility:'invisible'},
    {type:'Player',key:'dead',t:5,x:0,y:0,hp:0,visibility:'visible'},
    {type:'Player',key:'late',t:30,x:0,y:0,hp:100,visibility:'visible'},
    {type:'Player',key:'inferred',t:15,x:0,y:0,hp:100,visibility:'visible',interpolated:true},
    {type:'NPC',key:'chain',t:15,x:300,y:0,activeSince:5,deathTime:50},
    {type:'NPC',key:'self',t:20,x:0,y:0,activeSince:20},
    {type:'NPC',key:'dead-npc',t:12,x:0,y:0,activeSince:5,deathTime:10},
  ]);
  assert.equal(closest('a',10).minDistance,500);
  assert.deepEqual(closest('a',20),{minDistance:500,maxDistance:500,sources:['player'],patrol:false});
  assert.equal(closest('a',30,10).minDistance,0,'movement after engagement counts within the same pull');
  assert.equal(closest('a',20,11),null,'earlier approaches and NPC positions do not count');
  assert.equal(closest('a',30,31),null,'window start is part of the cache key');
  assert.equal(closest('b',20).minDistance,200);
  assert.equal(closest('b',20).patrol,true);
  assert.equal(closest('a',1),null);
});

const score=distance=>({minDistance:distance,maxDistance:distance,sources:['player'],patrol:false});
test('Choices show conditional distance ranges, rank closer packs first and keep every candidate',()=>{
  const f={groups:{a:{label:'G1'},b:{label:'G2'},c:{label:'G3'}},variants:[
    {pulls:[{groups:['a']},{groups:['c']}],proximity:{a:score(900),c:score(300)}},
    {pulls:[{groups:['b']},{groups:['c']}],proximity:{b:score(100),c:score(300)}},
    {pulls:[{groups:['b']},{groups:['a']}],proximity:{b:score(200),a:score(400)}},
  ]};
  const s=createReviewSession(f),state=s.state();
  assert.equal(state.remaining,3);assert.equal(state.options[0].id,'b');
  assert.equal(state.options[0].closestToPath,true);
  assert.deepEqual(state.options[0].proximity,{minDistance:100,maxDistance:200,sources:['player'],patrol:false});
  const next=s.choose('b');assert.equal(next.remaining,2);
  assert.equal(next.options[0].id,'c');assert.equal(next.options.find(o=>o.id==='a').proximity.maxDistance,400);
  assert.deepEqual(s.back(),state);
});

test('Estimated gap proximity stays below observed approach and above missing evidence',()=>{
  const state=createReviewSession({groups:{a:{label:'G1'},b:{label:'G2'},c:{label:'G3'}},variants:[
    {pulls:[{groups:['b']}],proximity:{b:{...score(20),estimated:true}}},
    {pulls:[{groups:['a']}],proximity:{a:score(900)}},
    {pulls:[{groups:['c']}]},
  ]}).state();
  assert.deepEqual(state.options.map(o=>o.id),['a','b','c']);
  assert.equal(state.options[1].proximity.estimated,true);
});
