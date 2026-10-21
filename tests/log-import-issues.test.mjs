import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveImport} from '../log-import/live-import.js';
import {recoverableMatchingProblems} from '../log-import/import-issues.js';

const url='https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv?fight=5';
const fight={id:5,name:'Test',startTime:0,endTime:10000,dungeonPulls:[{id:1,startTime:0,endTime:10000}]};
const result=()=>({groups:{a:{enemies:['a']}},variants:[{pulls:[{groups:['a']}]}],matching:{aggroRadius:1500}});
const failure=code=>Object.assign(new Error('Matching failed'),{diagnostics:{code}});
async function setup(t,match){
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({access_token:'mock',token_type:'Bearer'})}));
  let apiCalls=0,matchCalls=0,mode='custom';
  const fetcher=async(_,request)=>{
    apiCalls++;
    const metadata=JSON.parse(request.body).query.includes('RouteImportMetadata');
    const report=metadata?{fights:[fight],masterData:{actors:[{id:1,type:'Player'}]}}:
      {events:{data:[{fight:5,type:'cast',timestamp:100,sourceID:1,abilityGameID:1}],nextPageTimestamp:null}};
    return {ok:true,json:async()=>({data:{reportData:{report}}})};
  };
  const live=createLiveImport({data:{dungeons:[{id:'test',name:'Test'}],enemies:[],'modifier-placements':{dungeons:{}}},
    dungeonData:()=>mode,persist:async()=>{},storage:{},location:{},
    callback:{callback:{code:'mock',verifier:'mock'},pending:{url,dungeonData:'custom'}},
    matchLog:async(log,options)=>{matchCalls++;return match(log,options,matchCalls);}});
  await live.resume();
  return {live,fetcher,counts:()=>[apiCalls,matchCalls],mode:value=>{mode=value;}};
}

test('Relic problems wait for explicit acceptance and reuse the exact prepared route',async t=>{
  const route={...result(),skippedRelics:[{kind:'portal'},{kind:'invis'}]};
  const {live,fetcher,counts,mode}=await setup(t,()=>route);
  assert.equal(await live.load(url,{fetcher}),null);
  assert.equal(live.canContinue(),true);
  assert.deepEqual(live.issues().map(i=>i.code),['unplaced-portal','unplaced-invis']);
  assert.equal(live.diagnostics().acceptedIssues,undefined);
  await assert.rejects(live.continueImport(url.replace('fight=5','fight=6')),/Import this log first/);
  mode('changed');await assert.rejects(live.continueImport(url),/Dungeon data changed/);mode('custom');
  const controller=new AbortController();controller.abort();
  await assert.rejects(live.continueImport(url,{signal:controller.signal}),e=>e.name==='AbortError');
  assert.equal(live.canContinue(),true);
  const issues=live.issues();
  assert.equal(await live.continueImport(url),route);
  assert.deepEqual(counts(),[2,1]);
  assert.deepEqual(live.diagnostics().acceptedIssues,issues);
  assert.equal(live.canContinue(),false);
  assert.deepEqual(live.issues(),[]);
  await assert.rejects(live.continueImport(url),/Import this log first/);
});

for(const code of Object.keys(recoverableMatchingProblems))test(`${code} lists every problem before accepting a partial route`,async t=>{
  const route={...result(),partial:{matched:1,skipped:[{name:'Unknown enemy',pull:1}]},skippedRelics:[{kind:'portal'}]};
  const {live,fetcher,counts}=await setup(t,(_,options)=>{if(!options.allowPartial)throw failure(code);return route;});
  assert.equal(await live.load(url,{fetcher}),null);
  assert.deepEqual(live.issues().map(i=>i.code),[code,'partial-route','unplaced-portal']);
  assert.equal(live.canContinue(),true);
  assert.deepEqual(live.missingEnemies(),route.partial.skipped);
  assert.equal(await live.continueImport(url),route);
  assert.deepEqual(counts(),[2,2]);
});

test('Failed recovery and unexpected failures never offer Skip issues and import',async t=>{
  for(const code of ['no-compatible-route','invalid-data']){
    const {live,fetcher,counts}=await setup(t,()=>{throw failure(code);});
    await assert.rejects(live.load(url,{fetcher}),/Matching failed/);
    assert.equal(live.canContinue(),false);
    assert.deepEqual(live.issues(),[]);
    await assert.rejects(live.continueImport(url),/Import this log first/);
    assert.deepEqual(counts(),[2,code==='invalid-data'?1:2]);
  }
});

test('Incomplete downloads never run matching or expose a recovery button',async t=>{
  const {live,fetcher,counts}=await setup(t,()=>result());
  const incomplete=async(...args)=>{
    const response=await fetcher(...args),payload=await response.json();
    const events=payload.data.reportData.report.events;
    if(events)delete events.nextPageTimestamp;
    return {...response,json:async()=>payload};
  };
  await assert.rejects(live.load(url,{fetcher:incomplete}),/Incomplete event response/);
  assert.equal(live.canContinue(),false);
  assert.deepEqual(counts(),[2,0]);
});

test('Cancel, disconnect and a clean retry discard pending warnings',async t=>{
  const {live,fetcher}=await setup(t,(_,__,n)=>n===3?result():{...result(),skippedRelics:[{kind:'portal'}]});
  await live.load(url,{fetcher});live.cancelImport();
  assert.equal(live.canContinue(),false);assert.equal(live.diagnostics(),null);
  await live.load(url,{fetcher});
  assert.ok(await live.load(url,{fetcher}));
  assert.equal(live.canContinue(),false);assert.deepEqual(live.issues(),[]);
  await live.load(url,{fetcher});live.disconnect();
  assert.equal(live.canContinue(),false);assert.equal(live.diagnostics(),null);
});

test('Expanded search with remaining relic problems still waits for acceptance',async t=>{
  const route={...result(),skippedRelics:[{kind:'portal'}]};
  const {live,fetcher,counts}=await setup(t,(_,options)=>{
    if(options.adaptiveRadius)return route;
    if(options.allowPartial)return {...result(),partial:{matched:1,skipped:[]}};
    throw failure('no-compatible-route');
  });
  await live.load(url,{fetcher});
  assert.equal(await live.expandSearch(url),null);
  assert.deepEqual(live.issues().map(i=>i.code),['unplaced-portal']);
  assert.equal(live.canFindMissing(),false);
  assert.ok((await live.continueImport(url)).expandedSearch);
  assert.deepEqual(counts(),[2,3]);
});
