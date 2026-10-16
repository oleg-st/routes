import test from 'node:test';
import assert from 'node:assert/strict';
import {createGapApproach} from '../log-import/gap-approach.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createReviewSession} from '../log-import/review-session.js';
const packs=[{id:'p',placements:[{worldPosition:{x:0,y:0}}]}];
const player={key:'1:1',actorID:1,type:'Player',deaths:[],positions:[
  {t:0,x:0,y:-2000,hp:100,eventType:'heal'},{t:10000,x:0,y:2000,hp:100,eventType:'heal'}]};
const make=options=>createGapApproach({packs,trajectories:[player],...options});

test('Long-gap crossing is bounded by first engagement and never extrapolated',()=>{
  const check=make();
  assert.equal(check('p',2000,100),null);
  const hit=check('p',6000,100);
  assert.equal(hit.distance,0);assert.equal(hit.time,5000);assert.equal(hit.gapMs,10000);
  assert.equal(make({packs:[{id:'p',placements:[{worldPosition:{x:5000,y:0}}]}]})('p',20000,100),null);
});
test('Do not bridge deaths, map changes, portals, invisibility, huge gaps or impossible speed',()=>{
  for(const options of [
    {trajectories:[{...player,deaths:[{timestamp:4000}]}]},
    {events:[{type:'mapchange',timestamp:4000}]},
    {events:[{type:'applydebuff',targetID:1,abilityGameID:1002176,timestamp:4000}]},
    {invisibility:[{playerID:1,start:{time:3000},end:{time:4000}}]},
    {invisibility:[{playerID:1,start:null,end:{time:4000}}]},
    {maxGapMs:9000},{maxSpeed:100},
  ])assert.equal(make(options)('p',6000,100),null);
});
test('Buried contacts cannot be inferred; NPCs must already be in combat',()=>{
  assert.equal(make({packs:[{id:'p',placements:[{worldPosition:{x:0,y:0},burried:true}]}]})('p',6000,100),null);
  const npc={...player,type:'NPC'};
  assert.equal(make({trajectories:[npc]})('p',6000,100),null);
  npc.positions=[{...player.positions[0],eventType:'cast'},player.positions[1]];
  assert.equal(make({trajectories:[npc]})('p',6000,100).source,'engaged enemy');
});
test('A unique gap-based route completes automatically while retaining hypothesis evidence',async()=>{
  const dungeon={id:'gap-test',name:'Gap',mapImages:[],enemies:[{id:'enemy',placementId:'spawn',packId:'p',worldPosition:{x:0,y:0}}]};
  const events=[
    {type:'heal',timestamp:0,fight:1,targetID:1,targetResources:{x:0,y:-2000,hitPoints:100}},
    {type:'damage',timestamp:6000,fight:1,sourceID:2,sourceResources:{x:500,y:0,hitPoints:100}},
    {type:'heal',timestamp:10000,fight:1,targetID:1,targetResources:{x:0,y:2000,hitPoints:100}},
  ];
  const log={complete:true,reportCode:'example',actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:123}],events,
    fight:{id:1,startTime:0,endTime:11000,dungeonPulls:[{id:1,startTime:0,endTime:11000}]}};
  const result=await matchLiveLog(log,{dungeon,catalog:new Map([['enemy',{id:'enemy',name:'Enemy',gameId:123}]]),presets:{},dungeonData:'custom'});
  assert.equal(result.matching.aggroRadius,1500);assert.equal(result.variants.length,1);
  assert.ok(result.movementHypotheses.length);assert.match(result.assumption,/actual path is unknown/);
  assert.equal(result.variants[0].proximity['group-0'].estimated,true);
  const review=createReviewSession(result);assert.equal(review.state().complete,true);
  assert.deepEqual(review.state().options,[]);
  const observedLog={...log,events:[events[0],{type:'heal',timestamp:5000,fight:1,targetID:1,targetResources:{x:0,y:-500,hitPoints:100}},...events.slice(1)]};
  const observed=await matchLiveLog(observedLog,{dungeon,catalog:new Map([['enemy',{id:'enemy',name:'Enemy',gameId:123}]]),presets:{},dungeonData:'custom'});
  assert.deepEqual(observed.movementHypotheses,[]);assert.equal(observed.assumption,null);
  assert.equal(createReviewSession(observed).state().complete,true);
});
