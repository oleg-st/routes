import test from 'node:test';
import assert from 'node:assert/strict';
import {createGapApproach} from '../log-import/gap-approach.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createReviewSession} from '../log-import/review-session.js';
import fs from 'node:fs';
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

// Ardeos's recorded heading leads toward G35, then the next sample is back
// toward the party. The straight chord stays outside the ordinary radius.
const turningPlayer={key:'3:1',actorID:3,type:'Player',deaths:[],positions:[
  {t:14361,x:8892,y:4729,hp:100,eventType:'heal'},
  {t:14762,x:9407,y:4735,hp:100,eventType:'heal'},
  {t:14762,x:9407,y:4735,hp:100,eventType:'removebuff'},
  {t:18970,x:6280,y:6794,hp:100,eventType:'applybuff'},
]};
const turningPack={id:'souls',placements:[{worldPosition:{x:4606.552,y:11102.34}}]};
const turnCheck=options=>createGapApproach({packs:[turningPack],trajectories:[turningPlayer],...options});

test('A bounded player turnaround can enter the existing radius during a coordinate gap',()=>{
  const check=turnCheck(),hit=check('souls',29988,1500);
  assert.equal(hit.model,'turnaround');assert.equal(hit.source,'player');
  assert.ok(Math.abs(hit.distance-1500)<1e-6);
  assert.ok(hit.time>14762&&hit.time<18970);
  assert.ok(hit.pathDistance<=hit.speed*hit.gapMs/1000);
  assert.equal(check('souls',14800,1500),null,'contact must precede the NPC first event');
  assert.equal(check('souls',29988,100),null,'the player cannot reach the pack and return at the recorded speed');
  assert.equal(turnCheck({trajectories:[{...turningPlayer,positions:turningPlayer.positions.slice(1)}]})('souls',29988,1500),null,'no heading before the gap');
  const away=structuredClone(turningPlayer);away.positions[0].x=9922;
  assert.equal(turnCheck({trajectories:[away]})('souls',29988,1500),null,'do not invent a turn toward any nearby pack');
  assert.equal(turnCheck({trajectories:[{...turningPlayer,type:'NPC'}]})('souls',29988,1500),null);
});

test('Turnaround heading and the gap cannot cross death, invisibility, portals or map changes',()=>{
  for(const timestamp of [14500,16000])for(const options of [
    {trajectories:[{...turningPlayer,deaths:[{timestamp}]}]},
    {events:[{type:'mapchange',timestamp}]},
    {events:[{type:'applydebuff',targetID:3,abilityGameID:1002176,timestamp}]},
    {invisibility:[{playerID:3,start:{time:timestamp},end:{time:timestamp+100}}]},
  ])assert.equal(turnCheck(options)('souls',29988,1500),null);
  const stale=structuredClone(turningPlayer);stale.positions[0].t=12000;
  assert.equal(turnCheck({trajectories:[stale]})('souls',29988,1500),null);
  const jump=structuredClone(turningPlayer);jump.positions[0].x=4000;
  assert.equal(turnCheck({trajectories:[jump]})('souls',29988,1500),null);
  assert.equal(turnCheck({packs:[{...turningPack,placements:[{...turningPack.placements[0],dormant:true,gameGuid:'test'}]}]})('souls',29988,1500),null);
});

test('Turnaround evidence matches a whole three-enemy pack without inventing members',async()=>{
  const dungeon={id:'turn-test',name:'Turn',mapImages:[],enemies:[0,1,2].map(i=>({
    id:'soul',placementId:`soul-${i}`,packId:'souls',worldPosition:{x:4606.552+i*50,y:11102.34},
  }))};
  const resources=p=>({x:p.x,y:p.y,hitPoints:100,maxHitPoints:100});
  const playerEvents=turningPlayer.positions.map(p=>({type:p.eventType,timestamp:p.t,fight:1,targetID:3,targetResources:resources(p)}));
  const log={complete:true,reportCode:'example',fight:{id:1,startTime:0,endTime:40000,dungeonPulls:[{id:1,startTime:0,endTime:40000}]},
    actors:[{id:3,type:'Player'},{id:57,type:'NPC',gameID:100}],events:[...playerEvents,...[0,1,2].map(i=>({
      type:'cast',timestamp:29988+i*100,fight:1,sourceID:57,sourceInstance:i+1,sourceResources:resources({x:-1165,y:5191}),
    }))]};
  const result=await matchLiveLog(log,{dungeon,catalog:new Map([['soul',{id:'soul',gameId:100,name:'Lost Soul'}]]),presets:{},dungeonData:'custom'});
  assert.equal(result.variants.length,1);assert.equal(result.matching.aggroRadius,1500);
  assert.deepEqual(result.inferredPlacements,[]);assert.equal(result.partial,undefined);
  const groups=result.variants[0].pulls[0].groups.map(id=>result.groups[id]);
  assert.deepEqual(groups.flatMap(g=>g.enemies).sort(),['soul-0','soul-1','soul-2']);
  assert.equal(result.movementHypotheses.length,3);
  assert.ok(result.movementHypotheses.every(h=>h.key==='3:1'&&h.model==='turnaround'));
  for(const g of groups)assert.equal(result.variants[0].passage[g.id],null);
});

const savedRun='private/logs/new2/route-import-Hmd6QrcxDn8YWkGq-20.json';
test('Sailor Abyss imports all 88 enemies, including G35 in the first pull', {skip:!fs.existsSync(savedRun)},async()=>{
  const saved=JSON.parse(fs.readFileSync(savedRun)),options={...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e]))};
  const result=await matchLiveLog(saved.log,options);
  assert.equal(result.matching.aggroRadius,1500);assert.equal(result.partial,undefined);
  assert.equal(result.variants.length,1);assert.deepEqual(result.inferredPlacements,[]);
  const variant=result.variants[0],ids=variant.pulls.flatMap(p=>p.groups).flatMap(id=>result.groups[id].enemies);
  assert.equal(ids.length,88);assert.equal(new Set(ids).size,88);
  const souls=variant.pulls[0].groups.map(id=>result.groups[id]).find(g=>g.label==='G35');
  assert.equal(souls.enemies.length,3);
  assert.ok(result.movementHypotheses.some(h=>h.pack==='G35'&&h.key==='3:1'&&h.model==='turnaround'));
  assert.equal(variant.passage[souls.id],null,'inferred contact is never observed aggro evidence');
  assert.match(result.assumption,/actual path is unknown/);
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
  assert.equal(result.variants[0].proximity['group-0'].minDistance,2000,'path distance uses recorded players, not a hypothetical crossing');
  assert.equal(result.variants[0].proximity['group-0'].estimated,undefined);
  assert.equal(result.variants[0].passage['group-0'],null,'a drawn line through the pack is not observed contact');
  const review=createReviewSession(result);assert.equal(review.state().complete,true);
  assert.deepEqual(review.state().options,[]);
  const observedLog={...log,events:[events[0],{type:'heal',timestamp:5000,fight:1,targetID:1,targetResources:{x:0,y:-500,hitPoints:100}},...events.slice(1)]};
  const observed=await matchLiveLog(observedLog,{dungeon,catalog:new Map([['enemy',{id:'enemy',name:'Enemy',gameId:123}]]),presets:{},dungeonData:'custom'});
  assert.deepEqual(observed.movementHypotheses,[]);assert.equal(observed.assumption,null);
  assert.equal(createReviewSession(observed).state().complete,true);
});
