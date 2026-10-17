import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {repeatedSummonPatterns} from '../log-import/summon-patterns.js';

function fixture(kind='cast'){
  const actors=[{id:1,type:'NPC',gameID:901},{id:2,type:'NPC',gameID:902}];
  const rows=[],events=[];
  for(let i=0;i<3;i++){
    const t=10000+i*20000,x=i*5000;
    rows.push({key:`1:${i+1}`,actorID:1,instance:i+1,gameID:901,firstTime:t-9000,
      positions:[{t:t-100,x,y:0,hp:100,eventType:'damage'}],deaths:kind==='death'?[{timestamp:t}]:[]});
    if(kind==='cast')events.push({fight:5,type:'cast',sourceID:1,sourceInstance:i+1,abilityGameID:903,timestamp:t,sourceResources:{x,y:0,hitPoints:100}});
    for(let j=0;j<2;j++){
      const instance=i*2+j+1,firstTime=t+300+j*100;
      rows.push({key:`2:${instance}`,actorID:2,instance,gameID:902,firstTime,
        firstPosition:{t:firstTime,x:x+100+j*50,y:0},nearest:[{distance:5000}]});
    }
  }
  return {fightID:5,actors,rows,events};
}
test('Repeated casts or deaths identify arbitrary summon types without a per-NPC rule',()=>{
  for(const kind of ['cast','death']){
    const input=fixture(kind),result=repeatedSummonPatterns(input);
    assert.equal(result.length,6);
    assert.ok(result.every(r=>r.basis===`repeated-npc-${kind}-spawn`&&r.waveCount===3));
    assert.deepEqual(result.map(r=>r.key),input.rows.filter(r=>r.actorID===2).map(r=>r.key));
  }
  const input=fixture();input.events.push(...structuredClone(input.events));
  assert.equal(repeatedSummonPatterns(input).length,6);
});

test('One caster can create repeated waves without removing earlier instances of the same child type',()=>{
  const input=fixture();input.rows=input.rows.filter(r=>r.actorID===2||r.instance===1);
  input.events.forEach(e=>e.sourceInstance=1);
  input.rows.push({...input.rows[1],key:'2:99',instance:99,firstTime:1000,firstPosition:{t:1000,x:100,y:0}});
  assert.equal(repeatedSummonPatterns(input).length,6);
});

test('Recorded Shatter waves are inferred with renamed NPC types while ordinary Shardlings remain',()=>{
  // Compact geometry from c4nFLaThdAxtVpYv/89; game IDs are deliberately
  // unrelated to Golem/Shatter, so no verified mechanic can satisfy this test.
  const input=JSON.parse(fs.readFileSync(new URL('./fixtures/log-summon-death-waves.json',import.meta.url)));
  assert.deepEqual(repeatedSummonPatterns(input).map(r=>r.key),['87:1','87:2','87:3','87:10','87:11','87:12']);
});
test('A single nearby cast/death, duplicate events and unrelated abilities cannot infer summons',()=>{
  for(const kind of ['cast','death']){
    const input=fixture(kind);input.rows=input.rows.slice(0,3);input.events=input.events.slice(0,1);
    input.events.push(...structuredClone(input.events),...structuredClone(input.events));
    assert.deepEqual(repeatedSummonPatterns(input),[]);
  }
  const input=fixture();input.events.forEach((e,i)=>e.abilityGameID+=i);
  assert.deepEqual(repeatedSummonPatterns(input),[]);
  const frequent=fixture();frequent.events.push(...frequent.events.map(e=>({...e,timestamp:e.timestamp-3500})));
  assert.deepEqual(repeatedSummonPatterns(frequent),[]);
});
test('Cast patterns preserve static or earlier mobs, stale/missing positions, bosses and ambiguous parents',()=>{
  const changes=[
    a=>a.rows.filter(r=>r.actorID===2).forEach(r=>r.nearest=[{distance:999}]),
    a=>a.rows.filter(r=>r.actorID===2).forEach(r=>r.firstTime-=5000),
    a=>a.rows.filter(r=>r.actorID===2).forEach(r=>r.firstPosition.t+=2000),
    a=>a.rows.filter(r=>r.actorID===2).forEach(r=>delete r.firstPosition),
    a=>a.rows.filter(r=>r.actorID===2).forEach(r=>r.firstPosition.x+=2000),
    a=>a.actors[1].subType='Boss',
    a=>a.events.forEach(e=>delete e.sourceInstance),
    a=>a.events.forEach(e=>e.fake=true),
    a=>a.events.forEach(e=>e.positionOnly=true),
    a=>a.events.forEach(e=>e.fight=6),
    a=>a.events.forEach(e=>e.sourceResources.hitPoints=0),
    a=>a.actors[0].type='Player',
    a=>a.rows.filter(r=>r.actorID===1).forEach(r=>r.firstTime+=8000),
    a=>a.rows.filter(r=>r.actorID===1).forEach(r=>r.deaths=[{timestamp:r.firstTime+1000}]),
    a=>a.events.push(...a.events.map(e=>({...e,abilityGameID:904}))),
  ];
  for(const change of changes){const input=fixture();change(input);assert.deepEqual(repeatedSummonPatterns(input),[],String(change));}
});
test('Death patterns require fresh positions, multiple children and distinct parents at separate locations',()=>{
  const changes=[
    a=>a.rows.filter(r=>r.actorID===1).forEach(r=>r.positions[0].t-=2000),
    a=>a.rows=a.rows.filter(r=>r.actorID===1||r.instance%2),
    a=>a.rows.filter(r=>r.actorID===1).forEach(r=>r.key='same-parent'),
    a=>a.rows.forEach(r=>{for(const p of r.positions??[])p.x=0;if(r.firstPosition)r.firstPosition.x=100;}),
  ];
  for(const change of changes){const input=fixture('death');change(input);assert.deepEqual(repeatedSummonPatterns(input),[],String(change));}
});

test('Tight death waves tolerate surrounding casts but reject multiple possible corpses',()=>{
  const input=fixture('death');
  input.events=fixture().events.map(e=>({...e,timestamp:e.timestamp-1000}));
  assert.equal(repeatedSummonPatterns(input).length,6);
  input.actors.push({id:3,type:'NPC',gameID:904});
  input.rows.push(...input.rows.filter(r=>r.actorID===1).map(r=>({...r,key:`3:${r.instance}`,actorID:3,gameID:904})));
  assert.deepEqual(repeatedSummonPatterns(input),[]);
});
