import test from 'node:test';
import assert from 'node:assert/strict';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {matchingConfig} from '../log-import/matching-config.js';

// The first NPC event is after it moved away from spawn. No targeted player
// attack or exact spawn identity can bypass the approach constraint.
function fixture(distance,{buried=false}={}){
  const dungeon={id:'radius-test',name:'Radius test',mapImages:[],enemies:[
    {id:'enemy',placementId:'spawn',packId:'pack',worldPosition:{x:0,y:0},buried},
  ]};
  const log={complete:true,reportCode:'example',fight:{id:1,startTime:0,endTime:1000,dungeonPulls:[{id:1,startTime:0,endTime:1000}]},
    actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:123}],events:[
      {type:'damage',timestamp:100,fight:1,sourceID:2,targetID:1,
        sourceResources:{x:0,y:500,hitPoints:100,maxHitPoints:100},
        targetResources:{x:0,y:distance,hitPoints:100,maxHitPoints:100}},
    ]};
  const options={dungeon,catalog:new Map([['enemy',{id:'enemy',gameId:123,name:'Enemy'}]]),presets:{},dungeonData:'custom',config:{...matchingConfig,aggroRadius:1000}};
  return {log,options};
}

test('Matching keeps its configured radius; explicit diagnostic search increases by 100',async()=>{
  const {log,options}=fixture(1150);
  await assert.rejects(matchLiveLog(log,options),error=>
    error.diagnostics.aggroRadius===1000&&error.diagnostics.radiusAttempts.length===1);
  const result=await matchLiveLog(log,{...options,adaptiveRadius:true});
  assert.equal(result.variants.length,1);
  assert.deepEqual(result.matching,{aggroRadius:1200,buriedRadius:100,attackRange:6000,
    radiusAttempts:[{radius:1000,matched:false},{radius:1100,matched:false},{radius:1200,matched:true}]});
  await assert.rejects(matchLiveLog(log,{...options,adaptiveRadius:false}),error=>
    error.diagnostics.aggroRadius===1000&&error.diagnostics.radiusAttempts.length===1);
});

test('An already matching route retains the original radius',async()=>{
  const {log,options}=fixture(950);
  const result=await matchLiveLog(log,options);
  assert.deepEqual(result.matching.radiusAttempts,[{radius:1000,matched:true}]);
});

test('Adaptive search has a finite ceiling and does not expand buried contact',async()=>{
  for(const {log,options} of [fixture(3100),fixture(150,{buried:true})]){
    await assert.rejects(matchLiveLog(log,{...options,adaptiveRadius:true}),error=>{
      assert.equal(error.diagnostics.code,'no-compatible-route');
      assert.equal(error.diagnostics.aggroRadius,3000);
      assert.equal(error.diagnostics.radiusAttempts.length,21);
      return true;
    });
  }
  const {log,options}=fixture(90,{buried:true});
  assert.equal((await matchLiveLog(log,options)).matching.aggroRadius,1000);
});

test('Impossible instance counts and incomplete logs are not retried at larger radii',async()=>{
  const {log,options}=fixture(950);
  log.events.push({...log.events[0],timestamp:200,sourceInstance:2});
  await assert.rejects(matchLiveLog(log,options),error=>error.diagnostics.radiusAttempts.length===1);
  await assert.rejects(matchLiveLog({...log,complete:false},options),/Incomplete log/);
});

test('Cancellation between radius attempts prevents another match',async()=>{
  const {log,options}=fixture(1150),controller=new AbortController();
  const radii=[];
  await assert.rejects(matchLiveLog(log,{...options,adaptiveRadius:true,signal:controller.signal,onProgress:message=>{
    if(!message.startsWith('Matching packs with approach radius'))return;
    radii.push(message);
    if(message.includes('1100'))controller.abort();
  }}),{name:'AbortError'});
  assert.equal(radii.length,2);
  assert.equal(matchingConfig.aggroRadius,1500);
});

test('The default ordinary radius is fixed at 1500',async()=>{
  const {log,options}=fixture(1450);delete options.config;
  assert.deepEqual((await matchLiveLog(log,options)).matching.radiusAttempts,[{radius:1500,matched:true}]);
});
