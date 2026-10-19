import test from 'node:test';
import assert from 'node:assert/strict';
import {createAggroEvidence,combineAggroEvidence} from '../log-import/aggro-evidence.js';
import {createReviewSession} from '../log-import/review-session.js';
const placement={worldPosition:{x:0,y:0}},packs=[{id:'a',placements:[placement]}];
const point=(t,extra={})=>({key:'player',type:'Player',t,x:200,y:0,hp:100,visibility:'visible',...extra});
test('Aggro highlight requires observed contact just before engagement',()=>{
  const check=createAggroEvidence(packs,[point(1000),point(1500)]);
  assert.deepEqual(check('a',900,2000),{distance:200,range:1100,sources:['player']});
  assert.equal(check('a',1600,2000),null,'earlier pulls do not explain this choice');
  assert.equal(check('a',900,999),null,'post-engagement evidence is not used');
  for(const extra of [{hp:0},{visibility:'invisible'},{visibility:'unknown'},{interpolated:true},{x:1200}]){
    assert.equal(createAggroEvidence(packs,[point(1000,extra),point(1500,extra)])('a',900,2000),null);
  }
  assert.equal(createAggroEvidence([{id:'a',placements:[{...placement,patrolPath:[{x:0,y:0}]}]}],[point(1000),point(1500)])('a',900,2000),null);
});
test('Social evidence uses another confirmed engaged living mob and respects dormant activation',()=>{
  const npc={key:'npc',type:'NPC',confirmedSource:true,activeSince:0,deathTime:3000};
  const observations=[point(1000,npc),point(1500,npc)];
  assert.deepEqual(createAggroEvidence(packs,observations)('a',900,2000),{distance:200,range:1000,sources:['social aggro']});
  assert.equal(createAggroEvidence(packs,observations)('a',900,2000,['npc']),null,'no self justification');
  for(const extra of [{confirmedSource:false},{activeSince:1400},{deathTime:900},{x:1001}]){
    assert.equal(createAggroEvidence(packs,observations.map(p=>({...p,...extra})))('a',900,2000),null);
  }
  const dormant=[{id:'a',placements:[{...placement,activation:'player-contact'}]}];
  assert.equal(createAggroEvidence(dormant,observations)('a',900,2000),null);
  assert.equal(createAggroEvidence(dormant,[point(1000),point(1500)])('a',900,2000),null);
  assert.ok(createAggroEvidence(dormant,[point(1000,{x:50}),point(1500,{x:50})])('a',900,2000));
});
test('Evidence is conditional on every assignment for a choice, survives back, and never removes choices',()=>{
  const evidence={distance:200,range:1100,sources:['player']};
  assert.equal(combineAggroEvidence([evidence,null]),null);
  const fixture={groups:{a:{label:'G1'},b:{label:'G2'},x:{label:'G3'},y:{label:'G4'}},variants:[
    {pulls:[{groups:['x']},{groups:['a']}],aggro:{a:evidence}},
    {pulls:[{groups:['y']},{groups:['a']}],aggro:{a:null}},
    {pulls:[{groups:['x']},{groups:['b']}],aggro:{b:null}},
  ]};
  const session=createReviewSession(fixture);session.choose('x');
  assert.equal(session.state().options.length,2);
  assert.deepEqual(session.state().options[0].aggro,evidence);
  session.back();assert.equal(session.state().remaining,3);
  const mixed=createReviewSession({...fixture,variants:fixture.variants.map(v=>({...v,pulls:[v.pulls[1]]}))});
  assert.equal(mixed.state().options.find(o=>o.id==='a').aggro,null);
});

test('A visible player crossing during the pull ranks above pre-engagement proximity and social aggro',()=>{
  const evidence={distance:200,range:1100,sources:['player']};
  const fixture={groups:{a:{label:'G1'},b:{label:'G2'}},variants:[
    {pulls:[{groups:['a']}],aggro:{a:{distance:100,range:1000,sources:['social aggro']}},
      proximity:{a:{minDistance:100,maxDistance:100,sources:['player']}}},
    {pulls:[{groups:['b']}],passage:{b:evidence},
      proximity:{b:{minDistance:200,maxDistance:200,sources:['player']}}},
  ]};
  const session=createReviewSession(fixture),state=session.state();
  assert.deepEqual(state.options.map(o=>o.id),['b','a']);
  assert.deepEqual(state.options[0].passage,evidence);
  assert.equal(session.choose('a').complete,true,'weaker alternatives remain selectable');
  assert.deepEqual(session.back(),state);
  fixture.variants.push({...fixture.variants[1],passage:{b:null}});
  assert.equal(createReviewSession(fixture).state().options.find(o=>o.id==='b').passage,null);
});
