import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeighborApproach} from '../log-import/neighbor-approach.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createLiveImport} from '../log-import/live-import.js';

const placement=(id,x,extra={})=>({id,placementId:id,packId:id,worldPosition:{x,y:0},...extra});
const pack=(id,x,extra={})=>({id,placements:[placement(id,x,extra)]});

test('Neighbor hypotheses require earlier independent confirmation and cannot grow a chain',()=>{
  const packs=[pack('a',0),pack('b',1000),pack('c',2000)];
  const check=createNeighborApproach({packs,confirmed:[{packId:'a',time:100}],radius:1500});
  assert.equal(check('a',200),null);assert.equal(check('b',100),null);
  assert.equal(check('b',200).distance,1000);
  assert.equal(check('c',300),null,'accepting b does not make it a new seed');
  assert.equal(createNeighborApproach({packs,confirmed:[],radius:1500})('b',200),null);
});

test('Neighbor search preserves buried contact and does not use unseen source patrol positions',()=>{
  const packs=[pack('a',0,{patrolPath:[{x:10000,y:0}]}),pack('b',1000,{buried:true}),pack('c',10001),
    pack('d',10000,{patrolPath:[{x:1000,y:0},{x:2000,y:0}]})];
  const check=createNeighborApproach({packs,confirmed:[{packId:'a',time:100}],radius:1500});
  assert.equal(check('b',200),null);assert.equal(check('c',200),null);
  assert.equal(check('d',200).distance,1000,'target patrol is a possible neighbor, not observed contact');
});

export function neighborFixture(){
  const dungeon={id:'neighbor-test',name:'Neighbor test',mapImages:[],enemies:[placement('a',0),placement('b',2800)]};
  const resources=x=>({x:0,y:x,hitPoints:100,maxHitPoints:100});
  const log={complete:true,reportCode:'c4nFLaThdAxtVpYv',fight:{id:5,name:dungeon.name,startTime:0,endTime:1000,dungeonPulls:[{id:1,startTime:0,endTime:1000}]},
    actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:123},{id:3,type:'NPC',gameID:124}],events:[
      // Passive coordinates identify the spawn, but do not provide NPC chain aggro.
      {type:'applydebuff',timestamp:100,fight:5,sourceID:1,targetID:2,targetResources:resources(0),sourceResources:resources(-10000)},
      {type:'damage',timestamp:200,fight:5,sourceID:3,targetID:1,sourceResources:resources(-5000),targetResources:resources(-10000)},
    ]};
  return {log,options:{dungeon,presets:{},dungeonData:'custom',catalog:new Map([['a',{id:'a',name:'A',gameId:123}],['b',{id:'b',name:'B',gameId:124}]])}};
}

test('An opt-in neighbor search keeps ordinary ranges, counts and exact identity constraints',async()=>{
  const {log,options}=neighborFixture();
  await assert.rejects(matchLiveLog(log,options),e=>e.diagnostics?.code==='no-compatible-route');
  await assert.rejects(matchLiveLog(log,{...options,neighborRadius:1500}));
  const result=await matchLiveLog(log,{...options,neighborRadius:3000});
  assert.equal(result.variants.length,1);assert.equal(result.matching.aggroRadius,1500);
  assert.deepEqual(result.neighborHypotheses.map(h=>[h.placementId,h.source.packId]),[['b','a']]);
  const group=Object.values(result.groups).find(g=>g.enemies.includes('b'));
  assert.equal(result.variants[0].proximity[group.id].minDistance,12800,'player path distance is separate from the retained neighbor hypothesis');
  assert.deepEqual(result.variants[0].proximity[group.id].sources,['player']);
  assert.equal(result.variants[0].passage[group.id],null);
  const extra=structuredClone(log);extra.events.push({...extra.events[1],timestamp:300,sourceInstance:2});
  await assert.rejects(matchLiveLog(extra,{...options,neighborRadius:7500}),e=>e.diagnostics.counts.some(c=>c.observed>c.available));
  const unconfirmed=structuredClone(log);unconfirmed.events[0].targetResources.y=500;
  await assert.rejects(matchLiveLog(unconfirmed,{...options,neighborRadius:7500}));
  const late=structuredClone(log);late.events[0].timestamp=300;
  await assert.rejects(matchLiveLog(late,{...options,neighborRadius:7500}));
});

test('Recovery lists missing mobs by pull, searches once, retains additions and reuses downloaded events',async t=>{
  const {log,options}=neighborFixture();
  options.dungeon.enemies.push(placement('c',20000));
  options.catalog.set('c',{id:'c',name:'C',gameId:125});
  log.actors.push({id:4,type:'NPC',gameID:125});
  log.fight.dungeonPulls.push({id:2,startTime:500,endTime:1000});
  log.events.push({...log.events[1],timestamp:600,sourceID:4});
  const previousDocument=globalThis.document,previousWorker=globalThis.Worker,requests=[];
  globalThis.document={baseURI:'http://localhost/'};
  globalThis.Worker=class{
    terminate(){this.stopped=true;}
    postMessage({log,options}){
      requests.push(options);
      matchLiveLog(log,options).then(result=>{if(!this.stopped)this.onmessage({data:{result}});},error=>{if(!this.stopped)this.onmessage({data:{error:error.message,diagnostics:error.diagnostics}});});
    }
  };
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({access_token:'mock',token_type:'Bearer'})}));
  let apiCalls=0,mode='custom';
  const url=`https://www.fellowshiplogs.com/reports/${log.reportCode}?fight=5`;
  const fetcher=async(_,request)=>{
    apiCalls++;const q=JSON.parse(request.body).query;
    const report=q.includes('RouteImportMetadata')?{fights:[log.fight],masterData:{actors:log.actors}}:{events:{data:log.events,nextPageTimestamp:null}};
    return {ok:true,json:async()=>({data:{reportData:{report}}})};
  };
  const live=createLiveImport({data:{dungeons:[options.dungeon],enemies:[...options.catalog.values()],'modifier-placements':{dungeons:{}}},
    dungeonData:()=>mode,persist:async()=>{},storage:{},location:{},callback:{callback:{code:'mock',verifier:'mock'},pending:{url,dungeonData:'custom'}}});
  try{
    await live.resume();
    await assert.rejects(live.load(url,{fetcher}),/Could not match/);
    assert.deepEqual(live.missingEnemies().map(r=>[r.name,r.pull]),[['B',1],['C',2]]);
    assert.equal(live.canFindMissing(),true);assert.equal(apiCalls,2);
    await assert.rejects(live.expandSearch(url.replace('fight=5','fight=6')),/Import this log first/);
    mode='fellership';await assert.rejects(live.expandSearch(url),/Dungeon data changed/);mode='custom';
    assert.equal(await live.expandSearch(url),null);
    assert.deepEqual(live.missingEnemies().map(r=>[r.name,r.pull]),[['C',2]]);
    assert.equal(live.canFindMissing(),false);assert.equal(live.canContinue(),true);
    await assert.rejects(live.expandSearch(url),/Import this log first/);
    const before=requests.length,result=await live.continueImport(url);
    assert.equal(requests.length,before,'reuse the prepared partial route');assert.equal(apiCalls,2);
    assert.equal(result.partial.matched,2);assert.equal(result.partial.skipped.length,1);
    assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies).sort(),['a','b']);
    assert.equal(live.canContinue(),false);assert.equal(result.expandedSearch.maxRadius,6000);
    live.cancelImport();assert.equal(live.diagnostics(),null);assert.equal(live.missingEnemies(),null);
    assert.equal(live.connected(),true,'cancelling an import keeps the log connection');
    await assert.rejects(live.continueImport(url),/Import this log first/);
    live.disconnect();assert.equal(live.missingEnemies(),null);assert.equal(live.canFindMissing(),false);
  }finally{globalThis.document=previousDocument;globalThis.Worker=previousWorker;}
});
