import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deathSkipRows} from '../log-import/death-skips.js';
import {analyzeRouteEvents} from '../log-import/live-analysis.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {newRoute,scoreRoute} from '../route-model.js';

function example(){
  const placement=(id,x)=>({id:'mob',placementId:id,packId:id,worldPosition:{x,y:x},mapPosition:{x:.5,y:.5},mapImageId:'map'});
  const dungeon={id:'test',name:'Test',requiredScore:5,enemies:[placement('skip',100),placement('kill',10000)],mapImages:[{id:'map',width:100,height:100}]};
  const catalog=new Map([['mob',{id:'mob',gameId:900,name:'Mob',dungeonScore:5}]]);
  const resource=(x,hp=100)=>({x,y:x,hitPoints:hp,maxHitPoints:100});
  const log={complete:true,reportCode:'example',fight:{id:5,startTime:0,endTime:30000,dungeonPulls:[
    {id:1,startTime:1000,endTime:5000,encounterID:0},{id:2,startTime:10000,endTime:30000,encounterID:0}]},
    actors:[{id:1,type:'Player'},{id:2,type:'Player'},{id:3,type:'NPC',gameID:900},{id:4,type:'NPC',gameID:900}],events:[
      {fight:5,type:'damage',timestamp:1000,sourceID:3,targetID:1,sourceResources:resource(100,99),targetResources:resource(100)},
      {fight:5,type:'damage',timestamp:4999,sourceID:3,targetID:1,sourceResources:resource(100,98),targetResources:resource(100,1)},
      {fight:5,type:'death',timestamp:5001,sourceID:3,targetID:1},
      {fight:5,type:'damage',timestamp:11000,sourceID:2,targetID:4,sourceResources:resource(10000),targetResources:resource(10000,80)},
      {fight:5,type:'death',timestamp:20000,sourceID:2,targetID:4},
    ]};
  return {log,dungeon,catalog};
}
const detect=({log,dungeon,catalog})=>deathSkipRows(log,analyzeRouteEvents(log,dungeon,catalog).npcRows);

test('A living diversion pack is omitted while a later kill retains its full score',async()=>{
  const input=example(),{log,dungeon,catalog}=input;
  assert.deepEqual(detect(input),[{key:'3:1',pullID:1,reason:'survived-death-skip'}]);
  for(const allowPartial of [false,true]){
    const result=await matchLiveLog(log,{dungeon,catalog,presets:{},dungeonData:'custom',allowPartial});
    const route=newRoute(dungeon,'test');
    route.pulls=result.variants[0].pulls.map(p=>({enemies:p.groups.flatMap(id=>result.groups[id].enemies)}));
    assert.deepEqual(route.pulls,[{enemies:['kill']}]);
    assert.equal(scoreRoute(route,dungeon,catalog).percent,100);
    assert.equal(result.deathSkips.length,1);
  }
});

test('Missing mob deaths do not alone establish a death skip',()=>{
  const cases=[
    input=>{input.log.complete=false;},
    input=>{input.log.events=input.log.events.filter(e=>e.targetID!==1||e.type!=='death');},
    input=>{input.log.events[2].fake=true;},
    input=>{input.log.events[2].fight=6;},
    input=>{input.log.events.push({...input.log.events[2],targetID:2});},
    input=>{input.log.events.push({fight:5,type:'death',timestamp:4500,targetID:3});},
    input=>{input.log.events.push({...input.log.events[0],timestamp:25000});},
    input=>{input.log.events[1].sourceResources.hitPoints=10;},
    input=>{delete input.log.events[1].sourceResources.maxHitPoints;},
    input=>{input.log.fight.dungeonPulls[0].encounterID=39;},
    input=>{input.log.actors[2].subType='Boss';},
    input=>{input.log.events.push({fight:5,type:'cast',timestamp:4500,sourceID:2,targetID:3,abilityGameID:1478});},
    input=>{input.log.events=input.log.events.filter(e=>e.targetID!==4||e.type!=='death');},
    input=>{input.log.events[3].sourceID=1;},
  ];
  for(const mutate of cases){const input=example();mutate(input);assert.deepEqual(detect(input),[],mutate.toString());}
});

test('vYbAnLBdZNfJk4tR/2 excludes 35 points from the diversion but keeps the late Heart of Rot kill',()=>{
  const log=JSON.parse(fs.readFileSync('tests/fixtures/xul-death-skip.json'));
  const dungeon=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id==='Level.ID.SandTomb');
  const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
  const rows=analyzeRouteEvents(log,dungeon,catalog).npcRows;
  const skipped=deathSkipRows(log,rows),keys=new Set(skipped.map(r=>r.key));
  assert.equal(skipped.length,10);
  assert.ok(skipped.every(r=>r.pullID===4));
  const byGameID=new Map([...catalog.values()].map(e=>[e.gameId,e]));
  assert.equal(rows.filter(r=>keys.has(r.key)).reduce((n,r)=>n+byGameID.get(r.gameID).dungeonScore,0),35);
  assert.ok(rows.some(r=>r.key==='38:3'&&r.deaths.length));
  assert.equal(keys.has('38:3'),false);
});
