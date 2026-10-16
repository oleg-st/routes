import test from 'node:test';
import assert from 'node:assert/strict';
import {positionEventTypes,routeEventFilter,isRouteEvent,compactRouteEvent} from '../log-import/live-api.js';
import {analyzeRouteEvents} from '../log-import/live-analysis.js';
import {firstEngagements} from '../log-import/intended-pulls.js';
import {matchLiveLog} from '../log-import/live-matcher.js';

const resources={x:10,y:20,hitPoints:90,maxHitPoints:100,mana:555};
test('Previously filtered aura and channel events retain only compact coordinate evidence',()=>{
  for(const type of positionEventTypes){
    assert.ok(routeEventFilter.includes(`"${type}"`));
    const raw={type,timestamp:10,fight:1,sourceID:1,targetID:2,abilityGameID:99,targetResources:resources,amount:400};
    assert.equal(isRouteEvent(raw),true);
    const compact=compactRouteEvent(raw);
    assert.equal(compact.positionOnly,true);
    assert.deepEqual(compact.targetResources,{x:10,y:20,hitPoints:90,maxHitPoints:100});
    assert.equal(compact.amount,undefined);
  }
  assert.equal(compactRouteEvent({type:'applybuff',abilityGameID:1002146}).positionOnly,undefined);
  assert.equal(isRouteEvent({type:'combatantinfo'}),false);
});

test('Passive NPC aura coordinates do not create route enemies or move first engagement earlier',()=>{
  const actors=[{id:1,type:'Player'},{id:2,type:'NPC',gameID:20},{id:3,type:'NPC',gameID:30}];
  const events=[
    compactRouteEvent({type:'applybuff',fight:1,timestamp:10,targetID:2,targetResources:resources}),
    compactRouteEvent({type:'refreshdebuff',fight:1,timestamp:12,targetID:3,targetResources:resources}),
    {type:'damage',fight:1,timestamp:20,sourceID:1,targetID:2,targetResources:{...resources,x:30}},
  ];
  const {npcRows,trajectories}=analyzeRouteEvents({actors,events},{enemies:[]},new Map());
  assert.equal(npcRows.length,1);assert.equal(npcRows[0].key,'2:1');
  assert.equal(npcRows[0].firstTime,20);
  assert.equal(npcRows[0].firstPosition.t,10);
  assert.equal(trajectories.find(r=>r.key==='3:1').positions.length,1);
  assert.deepEqual([...firstEngagements(events,{fightID:1,actors})],[['2:1',20]]);
});

test('An aura sample does not hide a same-time combat event at identical coordinates',()=>{
  const events=[compactRouteEvent({type:'applybuff',timestamp:10,targetID:2,targetResources:resources}),
    {type:'cast',timestamp:10,sourceID:2,sourceResources:resources}];
  const {npcRows}=analyzeRouteEvents({actors:[{id:2,type:'NPC',gameID:20}],events},{enemies:[]},new Map());
  assert.deepEqual(npcRows[0].positions.map(p=>p.eventType),['applybuff','cast']);
});

test('A player position from a buff fills a movement gap without widening approach radius',async()=>{
  const dungeon={id:'movement-test',name:'Movement',mapImages:[],enemies:[{id:'enemy',placementId:'spawn',packId:'pack',worldPosition:{x:0,y:0}}]};
  const events=[
    {type:'heal',fight:1,timestamp:0,targetID:1,targetResources:{x:0,y:5000,hitPoints:100}},
    compactRouteEvent({type:'applybuff',fight:1,timestamp:17000,targetID:1,abilityGameID:99,targetResources:{x:0,y:500,hitPoints:100}}),
    {type:'damage',fight:1,timestamp:20000,sourceID:2,targetID:1,sourceResources:{x:0,y:300,hitPoints:100},targetResources:{x:0,y:5000,hitPoints:100}},
  ];
  const log={complete:true,reportCode:'example',fight:{id:1,startTime:0,endTime:30000,dungeonPulls:[{id:1,startTime:0,endTime:30000}]},actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:20}],events};
  const options={dungeon,catalog:new Map([['enemy',{id:'enemy',gameId:20,name:'Enemy'}]]),presets:{},dungeonData:'custom',adaptiveRadius:false};
  assert.equal((await matchLiveLog(log,options)).matching.aggroRadius,1500);
  await assert.rejects(matchLiveLog({...log,events:events.filter(e=>!e.positionOnly)},options),e=>e.diagnostics?.code==='no-compatible-route');
});
