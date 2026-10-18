import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deathSkipRows,confirmedDeathSkips} from '../log-import/death-skips.js';
import {analyzeRouteEvents} from '../log-import/live-analysis.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {newRoute,scoreRoute,encodeRoute,decodeRoute} from '../route-model.js';
import {campfires} from '../data/map-campfires.js';
import {mapCampfires,mapViews} from '../map-views.js';
const rawDungeon=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id==='Level.ID.SandTomb');
const fire=campfires[rawDungeon.id][0];
const fireResources=()=>({x:fire.worldPosition.y,y:fire.worldPosition.x,hitPoints:100,maxHitPoints:100});

function example(){
  const placement=(id,x)=>({id:'mob',placementId:id,packId:id,worldPosition:{x,y:x},mapPosition:{x:.5,y:.5},mapImageId:rawDungeon.mapImages[0].id});
  const dungeon={...rawDungeon,requiredScore:5,enemies:[placement('skip',100),placement('kill',10000)]};
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
      {fight:5,type:'cast',timestamp:6000,sourceID:2,abilityGameID:959,sourceResources:fireResources()},
      {fight:5,type:'applydebuff',timestamp:7000,sourceID:1,targetID:1,abilityGameID:1000109,targetResources:fireResources()},
    ]};
  return {log,dungeon,catalog};
}
const detect=({log,dungeon,catalog})=>deathSkipRows(log,analyzeRouteEvents(log,dungeon,catalog).npcRows,{dungeonID:dungeon.id});

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
    const note=result.drawings.find(d=>d.kind==='note'),view=mapViews(dungeon)[0],point=mapCampfires(dungeon,view).find(c=>c.id===fire.id).point;
    assert.equal(note.text,'Death skip');assert.equal(note.afterTime,7);
    assert.deepEqual(note.points,[[point[0]-view.width*34/1400,point[1]]]);
    const transferable=newRoute(rawDungeon,'test');
    transferable.drawings=result.drawings.map(({afterTime,...d})=>d);
    assert.equal((await decodeRoute(await encodeRoute(transferable,rawDungeon),[rawDungeon],catalog)).drawings[0].text,note.text);
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
    input=>{input.log.fight.dungeonPulls[0].encounterID=39;},
    input=>{input.log.actors[2].subType='Boss';},
    input=>{input.log.events.push({fight:5,type:'cast',timestamp:4500,sourceID:2,targetID:3,abilityGameID:1478});},
    input=>{input.log.events[5].fake=true;},
    input=>{input.log.events[5].type='begincast';},
    input=>{input.log.events[5].sourceResources.x+=10000;},
    input=>{input.log.events[5].sourceID=1;},
    input=>{input.log.events[6].abilityGameID=123;},
    input=>{input.log.events[6].fake=true;},
    input=>{input.log.events[6].fight=6;},
    input=>{delete input.log.events[6].targetResources;},
    input=>{input.log.events[6].timestamp=5500;},
    input=>{input.log.events[6].targetResources.x+=10000;},
    input=>{input.log.events.push({fight:5,type:'resurrect',timestamp:6500,targetID:1,sourceID:2});},
    input=>{input.log.events.push({fight:5,type:'heal',timestamp:6500,targetID:1,targetResources:fireResources()});},
    input=>{input.log.events.push({...input.log.events[0],timestamp:2000,targetID:2});},
    input=>{input.log.actors.push({id:5,type:'Pet',petOwner:2});input.log.events.push({...input.log.events[0],timestamp:2000,targetID:5});},
  ];
  for(const mutate of cases){const input=example();mutate(input);assert.deepEqual(detect(input),[],mutate.toString());}
});

test('vYbAnLBdZNfJk4tR/2 excludes 35 points from the diversion but keeps the late Heart of Rot kill',()=>{
  const log=JSON.parse(fs.readFileSync('tests/fixtures/xul-death-skip.json'));
  const dungeon=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id==='Level.ID.SandTomb');
  const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
  const rows=analyzeRouteEvents(log,dungeon,catalog).npcRows;
  const skipped=deathSkipRows(log,rows,{dungeonID:dungeon.id}),keys=new Set(skipped.map(r=>r.key));
  assert.equal(skipped.length,10);
  assert.ok(skipped.every(r=>r.pullID===4));
  const byGameID=new Map([...catalog.values()].map(e=>[e.gameId,e]));
  assert.equal(rows.filter(r=>keys.has(r.key)).reduce((n,r)=>n+byGameID.get(r.gameID).dungeonScore,0),35);
  assert.ok(rows.some(r=>r.key==='38:3'&&r.deaths.length));
  assert.equal(keys.has('38:3'),false);
  const [confirmed]=confirmedDeathSkips(log,rows,{dungeonID:dungeon.id});
  assert.equal(confirmed.campfireID,fire.id);
  assert.deepEqual(confirmed.playerIDs,[2]);
  assert.equal(confirmed.activatedBy,23);
  assert.equal(confirmed.activatedAt-log.fight.startTime,501038);
  assert.equal(confirmed.endTime-log.fight.startTime,503208);
});

test('The campfire may be activated while the tank is still kiting, before death',()=>{
  const input=example();input.log.events[5].timestamp=3000;
  assert.equal(detect(input).length,1);
  // Confirmed respawns replace the old low-damage heuristic.
  input.log.events[1].sourceResources.hitPoints=10;
  assert.equal(detect(input).length,1);
});

test('The confirmed sequence needs no final NPC health or position sample',()=>{
  const input=example();
  for(const e of input.log.events.filter(e=>e.sourceID===3))delete e.sourceResources;
  assert.equal(detect(input).length,1);
  input.log.events[5].timestamp=3000;
  assert.equal(detect(input).length,1);
  input.log.events[5].timestamp=500;
  assert.equal(detect(input).length,0,'The checkpoint activation must follow the pull');
});

test('The first respawn can be delayed; explicit checkpoint events only need coordinates',()=>{
  const input=example();input.log.fight.endTime=180000;
  input.log.events[5].timestamp=80000;input.log.events[6].timestamp=160000;
  delete input.log.events[5].sourceResources.hitPoints;
  delete input.log.events[6].targetResources.hitPoints;
  assert.equal(detect(input).length,1);
});

test('A partially killed pack retains its killed and later repulled members without restoring skipped siblings',async()=>{
  for(const later of [false,true]){
    const input=example(),{log,dungeon,catalog}=input;
    log.actors.push({id:5,type:'NPC',gameID:900});
    dungeon.enemies.push({...dungeon.enemies[0],placementId:'retained',worldPosition:{x:200,y:200}});
    log.events.push({...log.events[0],sourceID:5,timestamp:2000,sourceResources:{x:200,y:200,hitPoints:90,maxHitPoints:100}});
    if(later)log.events.push({...log.events.at(-1),timestamp:12000});
    log.events.push({fight:5,type:'death',timestamp:later?15000:4000,targetID:5});
    assert.deepEqual(detect(input).map(r=>r.key),['3:1']);
    const result=await matchLiveLog(log,{dungeon,catalog,presets:{},dungeonData:'custom'});
    assert.deepEqual(result.variants[0].pulls.flatMap(p=>p.groups.flatMap(id=>result.groups[id].enemies)).sort(),['kill','retained']);
    assert.deepEqual(result.inferredPlacements,[]);
    assert.equal(result.drawings.filter(d=>d.kind==='note').length,1);
  }
});

test('Every participant must die and respawn at the same checkpoint; passive heals are not combat evidence',()=>{
  const input=example();input.log.actors.push({id:5,type:'Player'});
  input.log.events.push({...input.log.events[0],timestamp:2000,targetID:5});
  assert.equal(detect(input).length,0);
  input.log.events.push({fight:5,type:'death',timestamp:4500,targetID:5});
  assert.equal(detect(input).length,0);
  input.log.events.push({...input.log.events[6],timestamp:7500,sourceID:5,targetID:5});
  assert.equal(detect(input).length,1);
  input.log.events.push({fight:5,type:'heal',timestamp:4000,sourceID:2,targetID:1});
  assert.equal(detect(input).length,1);
});
