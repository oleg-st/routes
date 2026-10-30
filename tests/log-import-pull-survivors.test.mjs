import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {abandonedPullSurvivors} from '../log-import/pull-survivors.js';
import {analyzeRouteEvents} from '../log-import/live-analysis.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {newRoute,newPull,scoreRoute,encodeRoute,decodeRoute} from '../route-model.js';

function example(){
  const log={complete:true,fight:{id:1,startTime:0,endTime:10000,dungeonPulls:[{id:1,startTime:100,endTime:2000,encounterID:0}]},
    actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:99}],events:[
      {fight:1,type:'damage',timestamp:100,sourceID:2,targetID:1,sourceResources:{x:10,y:10,hitPoints:100,maxHitPoints:100}},
      {fight:1,type:'damage',timestamp:1999,sourceID:2,targetID:1,sourceResources:{x:10,y:10,hitPoints:60,maxHitPoints:100}},
      {fight:1,type:'death',timestamp:2030,sourceID:2,targetID:1},
    ]};
  return log;
}
const detect=log=>abandonedPullSurvivors(log,analyzeRouteEvents(log,{enemies:[]},new Map()).npcRows);

test('A fresh survivor at a failed pull boundary is omitted without requiring a campfire skip',()=>{
  const log=example();
  assert.deepEqual(detect(log).map(r=>[r.key,r.pullID,r.lastHealth]),[['2:1',1,60]]);
  log.complete=false;
  assert.deepEqual(detect(log),[]);
});

test('Missing deaths, stale HP, individual deaths mid-pull and bosses are insufficient',()=>{
  for(const mutate of [
    log=>log.events.pop(),
    log=>{log.events[1].timestamp=500;},
    log=>{log.fight.dungeonPulls[0].endTime=5000;},
    log=>{log.actors[1].subType='Boss';},
    log=>{log.fight.dungeonPulls[0].encounterID=42;},
    log=>{log.events[1].sourceResources.hitPoints=4294967295;log.events[0].timestamp=-100;},
    log=>{log.events[2].fake=true;},
  ]){const log=example();mutate(log);assert.deepEqual(detect(log),[]);}
});

test('Later combat, kills, zero HP, overkill and Chicken retain the original observation',()=>{
  for(const event of [
    {type:'cast',timestamp:6000,sourceID:2},
    {type:'death',timestamp:6000,targetID:2},
    {type:'damage',timestamp:1999,targetID:2,targetResources:{hitPoints:0,maxHitPoints:100}},
    {type:'damage',timestamp:1999,targetID:2,overkill:10},
    {type:'cast',timestamp:1999,sourceID:1,targetID:2,abilityGameID:1478},
  ]){const log=example();log.events.push({fight:1,...event});assert.deepEqual(detect(log),[]);}
});

test('A late position-only cleanup without HP does not invent another engagement',()=>{
  const log=example();
  log.events.push({fight:1,type:'removedebuff',timestamp:8000,targetID:2,positionOnly:true});
  assert.equal(detect(log).length,1);
  log.events.push({fight:2,type:'death',timestamp:9000,targetID:2});
  assert.equal(detect(log).length,1,'events from another fight are ignored');
});

const file='private/logs/route-import-4HFCaqpxNTR9hgBG-1.json';
test('Wraithtide video replay has 98.93% before the last Witch, without scoring 11 survivors',{
  skip:!fs.existsSync(file),
},async()=>{
  const saved=JSON.parse(fs.readFileSync(file));
  const options={...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e]))};
  const result=await matchLiveLog(saved.log,options);
  assert.equal(result.partial,undefined);
  assert.equal(result.inferredPlacements.length,0);
  assert.equal(result.pullSurvivors.length,11);
  assert.deepEqual(result.pullSurvivors.map(r=>r.key).sort(),['6:10','6:11','7:12','7:13','7:14','8:5','8:6','12:7','26:3','27:3','27:4'].sort());
  assert.ok(result.variants.length>0);
  const placements=new Map(options.dungeon.enemies.map(p=>[p.placementId,p]));
  for(const variant of result.variants){
    const route=newRoute(options.dungeon,options.dungeon.routeBuildId);
    route.pulls=variant.pulls.map(p=>({...newPull(),enemies:p.groups.flatMap(id=>result.groups[id].enemies)}));
    route.excluded=variant.pulls.flatMap(p=>p.groups.flatMap(id=>result.groups[id].excluded));
    assert.equal(route.excluded.length,2,'only the two map Chicken targets receive markers; transformed boss summons are absent');
    const score=scoreRoute(route,options.dungeon,options.catalog);
    assert.equal(score.score,282);
    assert.equal(score.count,123);
    assert.equal(score.percent.toFixed(2),'100.36');
    const restored=await decodeRoute(await encodeRoute(route,options.dungeon),[options.dungeon],options.catalog);
    assert.deepEqual(restored.pulls.map(p=>p.enemies),route.pulls.map(p=>p.enemies));
    assert.equal(scoreRoute(restored,options.dungeon,options.catalog).score,282);
    const lastWitches=route.pulls.at(-1).enemies.filter(id=>options.catalog.get(placements.get(id).id).gameId===107);
    assert.equal(lastWitches.length,1);
    route.pulls.at(-1).enemies=route.pulls.at(-1).enemies.filter(id=>id!==lastWitches[0]);
    assert.equal(scoreRoute(route,options.dungeon,options.catalog).percent.toFixed(2),'98.93');
  }
});
