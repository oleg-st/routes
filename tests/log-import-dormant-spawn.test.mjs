import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dormantSpawnEvidence} from '../log-import/dormant-spawn-evidence.js';
import {matchLiveLog} from '../log-import/live-matcher.js';

const catalog=new Map([['flower',{gameId:182,name:'Wild Bloom'}]]);
const actors=[{id:1,type:'Player'},{id:2,type:'NPC',gameID:182}];
const placement=(x,extra={})=>({id:'flower',placementId:`spawn-${x}`,worldPosition:{x,y:0},dormant:true,gameGuid:`guid-${x}`,...extra});
const packs=[{id:'pack',placements:[placement(0)]}];
const row={key:'2:1',actorID:2,gameID:182,firstTime:1000,firstPosition:{t:1000,x:0,y:4.1,hp:100,maxHP:100}};
const event={fight:1,type:'cast',timestamp:1002,sourceID:2,sourceInstance:1,targetID:1,sourceResources:{x:0,y:4.1,hitPoints:100}};
const evidence=(r=row,e=event,ps=packs)=>dormantSpawnEvidence({fightID:1,actors,events:[e],rows:[r],packs:ps,catalog});

test('An emerged dormant NPC near its spawn establishes its own identity',()=>{
  assert.equal(evidence().get('2:1'),'spawn-0');
  assert.equal(evidence(row,{...event,type:'damage'}).get('2:1'),'spawn-0');
  assert.equal(evidence(row,event,[{id:'pack',placements:[placement(0),placement(500)]}]).size,1,'no inferred activation of siblings');
});

test('Dormant identity rejects stale, damaged, passive, substituted and ambiguous evidence',()=>{
  for(const patch of [{hp:99},{hp:0,maxHP:0},{maxHP:undefined},{t:999},{t:1251},{y:11}]){
    assert.equal(evidence({...row,firstPosition:{...row.firstPosition,...patch}}).size,0,JSON.stringify(patch));
  }
  assert.equal(evidence({...row,firstPosition:undefined}).size,0);
  for(const patch of [{fight:2},{fake:true},{positionOnly:true},{type:'applybuff'},{sourceInstance:2},{sourceID:1},{targetID:2},
    {timestamp:999},{timestamp:1251},{sourceResources:{x:0,y:20,hitPoints:100}},{sourceResources:{x:0,y:4.1,hitPoints:0}}]){
    assert.equal(evidence(row,{...event,...patch}).size,0,JSON.stringify(patch));
  }
  for(const extra of [{dormant:false},{patrolPath:[{x:0,y:0}]}]){
    assert.equal(evidence(row,event,[{id:'pack',placements:[placement(0,extra)]}]).size,0);
  }
  for(const rival of [placement(50),placement(500,{patrolPath:[{x:-50,y:0},{x:50,y:0}]})]){
    assert.equal(evidence(row,event,[...packs,{id:'other',placements:[rival]}]).size,0);
  }
});

test('Two emerged flowers retain their separate placements despite missing player-contact samples',async()=>{
  const resources=x=>({x:0,y:x,hitPoints:100,maxHitPoints:100});
  const dungeon={id:'test',name:'Test',mapImages:[],enemies:[placement(0,{packId:'a'}),placement(500,{packId:'b'})]};
  const log={complete:true,reportCode:'example',fight:{id:1,startTime:0,endTime:5000,dungeonPulls:[{id:1,startTime:1000,endTime:5000}]},actors,events:[
    {...event,timestamp:1000,sourceResources:resources(4.1),targetResources:resources(140)},
    {fight:1,type:'applydebuff',timestamp:2000,sourceID:1,targetID:2,targetInstance:2,targetResources:resources(509.67)},
    {...event,timestamp:2002,sourceInstance:2,sourceResources:resources(509.67),targetResources:resources(810)},
  ]};
  const options={dungeon,catalog,presets:{},dungeonData:'custom'};
  for(const allowPartial of [false,true]){
    const result=await matchLiveLog(log,{...options,allowPartial});
    assert.equal(result.variants.length,1);
    assert.equal(result.matching.buriedRadius,100);
    assert.deepEqual(result.partial?.skipped??[],[]);
    assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies).sort(),['spawn-0','spawn-500']);
  }
  const passive={...log,events:log.events.map(e=>e.sourceID===2?{...e,type:'applybuff'}:e)};
  await assert.rejects(matchLiveLog(passive,options),e=>e.diagnostics?.code==='no-compatible-route');
});

const savedRun='private/logs/route-import-XyGpcHjNaAzgk7mW-20.json';
test('Urrak fight 20 imports G71 and G84 without skipping or swapping flowers',{skip:!fs.existsSync(savedRun)},async()=>{
  const saved=JSON.parse(fs.readFileSync(savedRun));
  const result=await matchLiveLog(saved.log,{...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e]))});
  assert.equal(result.partial,undefined);
  assert.equal(result.matching.aggroRadius,1500);assert.equal(result.matching.buriedRadius,100);
  assert.equal(result.variants.length,6);
  for(const variant of result.variants){
    const groups=variant.pulls[0].groups.map(id=>result.groups[id]);
    for(const label of ['G71 (buried)','G84 (buried)'])assert.equal(groups.filter(g=>g.label===label).length,1);
  }
});
