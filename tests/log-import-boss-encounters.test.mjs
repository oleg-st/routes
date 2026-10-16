import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stormwatchBoss,silkenBoss,restoreBossEncounters,restoreBossCatalog} from '../data/boss-encounters.js';
import {correctDungeon,placementName} from '../data/placement-corrections.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createReviewSession} from '../log-import/review-session.js';
import {encounterIdentity} from '../log-import/boss-encounters.js';
import {analyzeRouteEvents} from '../log-import/live-analysis.js';
import {firstEngagements} from '../log-import/intended-pulls.js';
import {newRoute,newPull,encodeRoute,decodeRoute} from '../route-model.js';
import {mapViews,mapCoordinates,onMap} from '../map-views.js';
const raw=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id===stormwatchBoss.dungeonID);
const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const dungeon=correctDungeon(raw,'custom');
const bridge=dungeon.enemies.find(p=>p.placementId===stormwatchBoss.bridge);
const final=dungeon.enemies.find(p=>p.placementId===stormwatchBoss.final);
const resource=p=>({x:p.worldPosition.y,y:p.worldPosition.x,hitPoints:70,maxHitPoints:100});
const event=(timestamp,p,instance=1)=>({fight:5,type:'damage',timestamp,sourceID:1,targetID:2,targetInstance:instance,
  sourceResources:{...resource(p),hitPoints:100},targetResources:resource(p)});
const log=events=>({complete:true,reportCode:'example',fight:{id:5,startTime:0,endTime:60000,
  dungeonPulls:[0,10000,20000,30000,40000,50000].map((startTime,i)=>({id:i+1,startTime,endTime:startTime+9999}))},
  actors:[{id:1,type:'Player'},{id:2,type:'NPC',subType:'Boss',gameID:133}],events});
const match=async input=>matchLiveLog(input,{dungeon,catalog,presets:{},dungeonData:'custom'});
const pulls=result=>result.variants[0].pulls.map(p=>({id:p.id,enemies:p.groups.flatMap(id=>result.groups[id].enemies)}));

test('Silken Hollow restores Vexira on the lair map, imports her own pull and preserves route transfers',async()=>{
  const raw=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id===silkenBoss.dungeonID);
  const boss=raw.enemies.find(p=>p.placementId===silkenBoss.placementID);
  assert.equal(catalog.get(boss.id).gameId,92);assert.equal(catalog.get(boss.id).isBoss,true);
  assert.equal(catalog.get(boss.id).dungeonScore,0);
  assert.deepEqual(restoreBossEncounters(raw),raw);
  assert.deepEqual(restoreBossEncounters({...raw,enemies:raw.enemies.filter(p=>p!==boss)}),raw);
  const restored=restoreBossCatalog([...catalog.values()].filter(e=>e.id!==boss.id));
  assert.equal(restored.filter(e=>e.id===boss.id).length,1);
  assert.deepEqual(restoreBossCatalog(restored),restored);
  for(const mode of ['custom','fellership']){
    const dungeon=correctDungeon(raw,mode),view=mapViews(dungeon)[0];
    assert.equal(onMap(boss,view),true);assert.deepEqual(mapCoordinates(boss,view),silkenBoss.fullMapPoint);
    const result=await matchLiveLog({complete:true,reportCode:'example',
      fight:{id:5,startTime:0,endTime:30000,dungeonPulls:[{id:1,startTime:0,endTime:10000},{id:2,startTime:20000,endTime:30000}]},
      actors:[{id:1,type:'Player'},{id:2,type:'NPC',subType:'Boss',gameID:92}],
      events:[{...event(21000,boss),targetResources:{x:-7292,y:44017,hitPoints:100,maxHitPoints:100}}]},
      {dungeon,catalog,presets:{},dungeonData:mode});
    assert.deepEqual(pulls(result),[{id:'segment-2',enemies:[boss.placementId]}]);
    const route=newRoute(dungeon,'25647984');route.pulls[0].enemies=[boss.placementId];
    const encoded=await encodeRoute(route,dungeon);
    for(const target of ['custom','fellership'])assert.deepEqual((await decodeRoute(encoded,[correctDungeon(raw,target)],catalog)).pulls[0].enemies,[boss.placementId]);
  }
});

test('Stormwatch restores two independent placements and keeps both across route export and data modes',async()=>{
  assert.equal(dungeon.enemies.filter(p=>p.id===stormwatchBoss.enemyID).length,2);
  assert.notEqual(bridge.packId,final.packId);
  assert.match(placementName(bridge,catalog.get(bridge.id)),/Bridge/);
  assert.match(placementName(final,catalog.get(final.id)),/Final/);
  assert.deepEqual(restoreBossEncounters(raw),raw);
  const upstream={...raw,enemies:raw.enemies.filter(p=>p.placementId!==final.placementId)};
  assert.deepEqual(restoreBossEncounters(upstream),raw);
  const route=newRoute(dungeon,'25647984');route.pulls[0].enemies=[bridge.placementId];
  route.pulls.push({...newPull(1),enemies:[final.placementId]});
  const encoded=await encodeRoute(route,dungeon);
  for(const mode of ['custom','fellership']){
    const copy=await decodeRoute(encoded,[correctDungeon(raw,mode)],catalog);
    assert.deepEqual(copy.pulls.map(p=>p.enemies),[[bridge.placementId],[final.placementId]]);
  }
});

test('One Brogg actor and instance imports bridge and final as separate pulls',async()=>{
  const result=await match(log([event(1000,bridge),event(31000,final)]));
  assert.equal(result.variants.length,1);
  assert.deepEqual(pulls(result),[{id:'segment-1',enemies:[bridge.placementId]},{id:'segment-4',enemies:[final.placementId]}]);
  assert.equal(result.assumption,null);
  assert.equal(createReviewSession(result).state().complete,true);
});

test('Encounter boundaries separate Brogg phases even within one API pull',async()=>{
  const input=log([{type:'dungeonencounterstart',timestamp:0,fight:5,encounterID:133},event(1000,bridge),
    {type:'dungeonencounterstart',timestamp:30000,fight:5,encounterID:133},event(31000,final)]);
  input.fight.dungeonPulls=[{id:1,startTime:0,endTime:60000}];
  assert.deepEqual(pulls(await match(input)),[{id:'segment-1',enemies:[bridge.placementId]},
    {id:'segment-1-encounter-1',enemies:[final.placementId]}]);
});

test('Wipes with reused or changed actor instances keep the first attempt of each phase',async()=>{
  for(const instances of [[1,1,1,1],[1,2,3,4]]){
    const input=log([event(1000,bridge,instances[0]),event(11000,bridge,instances[1]),event(31000,final,instances[2]),event(51000,final,instances[3])]);
    // Also allow a new actor identity after a reset.
    input.actors.push({id:3,type:'NPC',subType:'Boss',gameID:133});input.events[3].targetID=3;
    assert.deepEqual(pulls(await match(input)),[{id:'segment-1',enemies:[bridge.placementId]},{id:'segment-4',enemies:[final.placementId]}]);
  }
});

test('A bridge-only or final-only log never invents the other encounter',async()=>{
  for(const p of [bridge,final]){
    const result=await match(log([event(1000,p),event(21000,p,2)]));
    assert.deepEqual(pulls(result),[{id:'segment-1',enemies:[p.placementId]}]);
  }
});

test('Missing boss positions use player location and opening events stay in their own phase',async()=>{
  const input=log([event(1000,bridge),event(31000,final),event(31500,final)]);
  delete input.events[0].targetResources;delete input.events[1].targetResources;delete input.events[1].sourceResources;
  const result=await match(input);
  assert.deepEqual(pulls(result),[{id:'segment-1',enemies:[bridge.placementId]},{id:'segment-4',enemies:[final.placementId]}]);
});

test('Low HP, repeated pulls and passive summit samples do not invent a final encounter',async()=>{
  const input=log([event(1000,bridge),{...event(11000,bridge),targetResources:{...resource(bridge),hitPoints:60}},
    {...event(31000,final),type:'applybuff',positionOnly:true}]);
  assert.deepEqual(pulls(await match(input)),[{id:'segment-1',enemies:[bridge.placementId]}]);
});

test('Damage after Brogg retreats does not put the final encounter ahead of intervening trash',async()=>{
  const trash=[...Map.groupBy(dungeon.enemies,p=>p.packId).values()].find(ps=>ps.every(p=>!catalog.get(p.id).isBoss&&!p.patrolPath?.length));
  const input=log([
    {type:'dungeonencounterstart',timestamp:0,fight:5,encounterID:133},event(1000,bridge),
    {type:'dungeonencounterend',timestamp:5000,fight:5,encounterID:133},
    {...event(11000,final),sourceResources:resource(bridge)},
    ...trash.map((p,i)=>({...event(21000,p),targetID:10+i})),
    {type:'dungeonencounterstart',timestamp:50000,fight:5,encounterID:133},event(51000,final),
    {type:'dungeonencounterend',timestamp:59000,fight:5,encounterID:133},
  ]);
  input.actors.push(...trash.map((p,i)=>({id:10+i,type:'NPC',gameID:catalog.get(p.id).gameId})));
  assert.deepEqual(pulls(await match(input)),[
    {id:'segment-1',enemies:[bridge.placementId]},
    {id:'segment-3',enemies:trash.map(p=>p.placementId).sort()},
    {id:'segment-6',enemies:[final.placementId]},
  ]);
});

test('Report c4nFLaThdAxtVpYv fight 12 starts final Brogg at 643.093s, not the retreat damage at 326.976s',async()=>{
  // Minimal real events: encounter boundaries, first attacks and the damage
  // tick 366ms after the bridge encounter ended, with Brogg already upstairs.
  const input=JSON.parse(fs.readFileSync('tests/fixtures/stormwatch-brogg-retreat.json'));
  const identity=encounterIdentity(input,dungeon);
  const first=firstEngagements(input.events,{fightID:input.fight.id,actors:input.actors,key:identity.key});
  const rows=analyzeRouteEvents(input,dungeon,catalog,identity).npcRows;
  for(const [p,time]of [[bridge,9920016],[final,10313454]]){
    const key=`encounter:${p.placementId}`;
    assert.equal(first.get(key),time);
    assert.equal(rows.find(r=>r.key===key).firstTime,time);
  }
  assert.deepEqual(pulls(await match(input)),[
    {id:'segment-2',enemies:[bridge.placementId]},
    {id:'segment-7',enemies:[final.placementId]},
  ]);
  // Without a later encounter, the stray damage must not fabricate a final.
  input.events=input.events.filter(e=>e.timestamp<10313421);
  assert.deepEqual(pulls(await match(input)),[{id:'segment-2',enemies:[bridge.placementId]}]);
});
