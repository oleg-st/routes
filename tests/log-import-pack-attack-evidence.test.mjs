import test from 'node:test';
import assert from 'node:assert/strict';
import {withOpeningPackEvidence} from '../log-import/pack-attack-evidence.js';
import {createApproachFilter} from '../log-import/approach-filter.js';
import {matchLiveLog} from '../log-import/live-matcher.js';

const catalog=new Map([['boar',{gameId:342,name:'Raging Razorback'}]]);
const placement=(x,extra={})=>({id:'boar',worldPosition:{x,y:0},...extra});
const packs=[{id:'pack',placements:[placement(0),placement(700),placement(1500)]}];
const attack={type:'cast',t:1000,x:-2537,y:0,key:'player',targetKey:'boar:1',abilityGameID:966,range:6000};
const row={key:'boar:1',gameID:342,firstTime:1000,firstPosition:{t:1001,x:0,y:4.53,hp:100,maxHP:100,eventType:'applydebuff'}};
const enrich=(a=attack,r=row,ps=packs)=>withOpeningPackEvidence([a],{packs:ps,rows:[r],catalog})[0];

test('A fresh opening cast near an isolated spawn supports later pack members at the normal radius',()=>{
  const confirmed=enrich();assert.equal(confirmed.confirmedPackId,'pack');
  assert.equal(attack.confirmedPackId,undefined,'original evidence is not mutated');
  const filter=createApproachFilter({packs,observations:[],attacks:[confirmed],playerRadius:1500,chainRadius:1500});
  assert.equal(filter.check('pack',2000,'boar:2').witness.scope,'established-pack-member');
  assert.equal(filter.check('pack',999,'earlier-mob').supported,false);
  const distant=createApproachFilter({packs,observations:[],attacks:[{...confirmed,x:-10000}],playerRadius:1500,chainRadius:1500});
  assert.equal(distant.check('pack',2000,'boar:2').supported,false,'targeted range still applies');
});

test('Damaged, delayed, passive, distant or inferred positions do not establish pack membership',()=>{
  for(const patch of [{hp:99},{maxHP:undefined},{hp:0,maxHP:0},{t:999},{t:1251},{eventType:'damage'},{eventType:'applybuff'},{y:10.01},{x:NaN}]){
    assert.equal(enrich(attack,{...row,firstPosition:{...row.firstPosition,...patch}}).confirmedPackId,undefined,JSON.stringify(patch));
  }
  assert.equal(enrich(attack,{...row,firstPosition:undefined}).confirmedPackId,undefined);
  for(const patch of [{type:'damage'},{fake:true},{abilityGameID:1478},{t:1100},{targetKey:'other'}]){
    assert.equal(enrich({...attack,...patch}).confirmedPackId,undefined,JSON.stringify(patch));
  }
});

test('Other same-type spawns and patrol paths veto ambiguous membership',()=>{
  for(const competing of [placement(50),placement(5000,{patrolPath:[{x:-50,y:0},{x:50,y:0}]})]){
    assert.equal(enrich(attack,row,[...packs,{id:'other',placements:[competing]}]).confirmedPackId,undefined);
  }
  for(const extra of [{patrolPath:[{x:0,y:0}]},{buried:true},{activation:'player-contact'}]){
    assert.equal(enrich(attack,row,[{id:'pack',placements:[placement(0,extra)]}]).confirmedPackId,undefined);
  }
});

test('Small spawn discrepancies do not lose ranged-pulled siblings in a full import',async()=>{
  const enemies=packs[0].placements.map((p,i)=>({...p,placementId:`boar-${i}`,packId:'pack'}));
  const dungeon={id:'test',name:'Test',mapImages:[],enemies};
  const resources=x=>({x:0,y:x,hitPoints:100,maxHitPoints:100});
  const log={complete:true,reportCode:'example',fight:{id:1,startTime:0,endTime:10000,dungeonPulls:[{id:1,startTime:1000,endTime:10000}]},
    actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:342}],events:[
      {fight:1,type:'cast',timestamp:1000,sourceID:1,targetID:2,targetInstance:1,abilityGameID:966,sourceResources:resources(-2537)},
      {fight:1,type:'applydebuff',timestamp:1001,sourceID:1,targetID:2,targetInstance:1,abilityGameID:1001241,targetResources:resources(4.53)},
      ...[1,2,3].map((instance,i)=>({fight:1,type:'damage',timestamp:5000+i*1000,sourceID:2,sourceInstance:instance,targetID:1,
        sourceResources:resources(-4500-i*300),targetResources:resources(-5000-i*300)})),
    ]};
  const options={dungeon,catalog,presets:{},dungeonData:'custom'};
  const result=await matchLiveLog(log,options);
  assert.deepEqual(result.matching.radiusAttempts,[{radius:1500,matched:true}]);
  assert.equal(result.variants.length,1);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies).sort(),['boar-0','boar-1','boar-2']);
  assert.equal(result.partial,undefined);
  assert.deepEqual(result.inferredPlacements,[]);
  // A stale or already-damaged target must not confer the new pack evidence.
  for(const mutate of [e=>e.timestamp=1400,e=>e.targetResources.hitPoints=99]){
    const bad=structuredClone(log);mutate(bad.events[1]);
    await assert.rejects(matchLiveLog(bad,options),e=>e.diagnostics?.code==='no-compatible-route');
  }
});
