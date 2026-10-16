import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadLog,loadReportFights,routeEventFilter,compactRouteEvent} from '../log-import/live-api.js';
import {fightLabel} from '../log-import/fight-label.js';
import {beginAuthorization,consumeCallback,exchangeCode} from '../log-import/oauth.js';
import {captureLogCallback,createLiveImport} from '../log-import/live-import.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {createReviewSession} from '../log-import/review-session.js';
const url='https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv?fight=5';
const fight={id:5,name:'Example',startTime:100,endTime:200,dungeonPulls:[{id:1,startTime:100,endTime:200}]};
const actors=[{id:1,type:'Player'},{id:2,type:'NPC',gameID:123}];
const event={type:'damage',timestamp:120,fight:5,sourceID:1,targetID:2,targetInstance:1,amount:123456,sourceResources:{x:3,y:4,hitPoints:100,mana:88}};
const response=report=>({ok:true,json:async()=>({data:{reportData:{report}}})});
const metadata=()=>({fights:[fight],masterData:{actors:[...actors,{id:99,type:'Player'}]}});
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
test('Live import selects one fight and one filtered stream; pages keep equal-time events and compact payloads',async()=>{
  const calls=[];
  const result=await loadLog(url,{token:'memory-only',fetcher:async(endpoint,options)=>{
    assert.equal(endpoint,'https://www.fellowshiplogs.com/api/v2/user');assert.equal(options.credentials,'omit');
    const body=JSON.parse(options.body);calls.push(body);assert.deepEqual(body.variables.fights,[5]);
    assert.equal(options.headers.Authorization,'Bearer memory-only');
    if(calls.length===1){assert.doesNotMatch(body.query,/abilities|gear|rankings|title|__type/);return response(metadata());}
    assert.equal(body.variables.filter,routeEventFilter);assert.match(body.query,/hostilityType:Friendlies/);
    assert.equal(body.variables.end,200);
    if(calls.length===2){assert.equal(body.variables.start,100);return response({events:{data:[event],nextPageTimestamp:120}});}
    assert.equal(body.variables.start,120);return response({events:{data:[{...event,amount:10},{...event,fight:99}],nextPageTimestamp:null}});
  }});
  assert.equal(calls.length,3);assert.equal(result.events.length,2);assert.equal(result.complete,true);
  assert.deepEqual(result.actors,actors);assert.equal(result.events[0].amount,undefined);assert.equal(result.events[0].sourceResources.mana,undefined);
});
test('Live loader rejects partial/invalid pagination, API errors, missing actors and expired login',async()=>{
  for(const bad of [{data:[event]},{data:[event],nextPageTimestamp:100},{data:[{...event,targetID:77}],nextPageTimestamp:null}]){
    let count=0;await assert.rejects(loadLog(url,{token:'x',fetcher:async()=>response(++count===1?metadata():{events:bad})}));
  }
  await assert.rejects(loadLog(url,{token:'x',fetcher:async()=>({ok:false,status:401})}),e=>e.status===401);
  await assert.rejects(loadLog(url,{token:'x',fetcher:async()=>({ok:true,json:async()=>({errors:[{message:'SECRET'}]})})}),e=>!e.message.includes('SECRET'));
  const controller=new AbortController();controller.abort();let requested=false;
  await assert.rejects(loadLog(url,{signal:controller.signal,fetcher:async()=>{requested=true;}}));assert.equal(requested,false);
});
test('Fight listing loads only summary fields, sorts newest first and defaults to the last run',async()=>{
  let calls=0;
  const fetcher=async(_,options)=>{
    calls++;const body=JSON.parse(options.body);
    assert.deepEqual(body.variables,{code:'c4nFLaThdAxtVpYv'});assert.doesNotMatch(body.query,/masterData|actors|events|dungeonPulls/);
    return response({fights:[{...fight,id:8,startTime:150},{...fight,id:5,startTime:100},{...fight,id:6,startTime:110}]});
  };
  const result=await loadReportFights(url.split('?')[0],{token:'x',fetcher});
  assert.deepEqual(result.fights.map(f=>f.id),[8,6,5]);assert.equal(result.selectedFightID,8);assert.equal(calls,1);
  assert.equal((await loadReportFights(url,{token:'x',fetcher})).selectedFightID,5);
  await assert.rejects(loadReportFights(url,{token:'x',fetcher:async()=>response({fights:[]})}),/no fights/);
});
test('Fight labels include number, outcome, dungeon, displayed league level and run duration',()=>{
  assert.equal(fightLabel({...fight,id:5,name:'Empyrean Sands',difficultyLevel:75,kill:true,completionTime:631135}),'Empyrean Sands · #5 · Eternal 55 · 10:31');
  assert.equal(fightLabel({...fight,id:6,name:'Urrak Markets',difficultyLevel:76,kill:false,completionTime:0,startTime:100,endTime:487100}),'Urrak Markets · #6 · Eternal 56 · Wipe · 8:07');
  assert.match(fightLabel({...fight,inProgress:true,kill:false}),/In progress/);
});
test('PKCE binds production redirect and callback scrubs authorization parameters even on failure',async()=>{
  const store=storage(),redirect='https://oleg-st.github.io/routes/',authorize=new URL(await beginAuthorization(store,1000,redirect));
  const search='?'+new URLSearchParams({state:authorize.searchParams.get('state'),code:'single-use'});
  const callback=consumeCallback(search,store,2000);assert.equal(callback.redirectURI,redirect);
  await exchangeCode(callback,async(_,options)=>{assert.equal(options.body.get('redirect_uri'),redirect);return {ok:true,json:async()=>({token_type:'Bearer',access_token:'x'})};});
  let cleaned;const captured=captureLogCallback({search:'?code=bad&state=bad',pathname:'/routes/',hash:'#keep'},{replaceState:(_,__,path)=>cleaned=path},store);
  assert.ok(captured.error);assert.equal(cleaned,'/routes/#keep');
  await assert.rejects(beginAuthorization(store,1000,'https://example.com/'));
});
test('Compact events retain portal/invisibility boundaries and HP while dropping combat statistics',()=>{
  const e=compactRouteEvent({...event,type:'applydebuff',abilityGameID:1002176,extraAbilityGameID:1506,targetResources:{x:10,y:20,hitPoints:40,maxHitPoints:80,classResources:[{amount:4}]}});
  assert.equal(e.extraAbilityGameID,1506);assert.deepEqual(e.targetResources,{x:10,y:20,hitPoints:40,maxHitPoints:80});assert.equal(e.amount,undefined);
});
test('Connecting from index.html uses the registered directory callback and saves the draft first',async()=>{
  const store=storage();let persisted=false,assigned;
  const live=createLiveImport({data:{},dungeonData:()=> 'custom',persist:async()=>{persisted=true;},storage:store,
    location:{href:'https://oleg-st.github.io/routes/index.html',assign:value=>{assert.equal(persisted,true);assigned=value;}}});
  await live.connect(url);assert.equal(new URL(assigned).searchParams.get('redirect_uri'),'https://oleg-st.github.io/routes/');
  assert.equal(JSON.parse(store.getItem('fellowship-route-import-pending')).url,url);
});
test('Live matching imports a uniquely identified boss once across repeated attempts',async()=>{
  const read=p=>JSON.parse(fs.readFileSync(p));
  const catalog=new Map(read('data/enemies.json').map(e=>[e.id,e]));
  const dungeon=correctDungeon(read('data/dungeons.json').find(d=>d.name==='Empyrean Sands'),'custom');
  const boss=dungeon.enemies.find(p=>catalog.get(p.id).isBoss),npc={id:2,type:'NPC',subType:'Boss',gameID:catalog.get(boss.id).gameId};
  const bossEvent={...event,targetResources:{x:boss.worldPosition.y,y:boss.worldPosition.x,hitPoints:10,maxHitPoints:100}};
  const result=await matchLiveLog({complete:true,reportCode:'c4nFLaThdAxtVpYv',fight:{...fight,name:dungeon.name,dungeonPulls:[{id:1,startTime:100,endTime:140},{id:2,startTime:150,endTime:200}]},actors:[actors[0],npc],events:[bossEvent,{...bossEvent,timestamp:180}]},
    {dungeon,catalog,presets:{},dungeonData:'custom'});
  assert.equal(result.variants.length,1);assert.equal(result.variants[0].pulls.length,1);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies),[boss.placementId]);
  assert.equal(createReviewSession(result).state().complete,true);
});
test('A unique inferred route requires a visible choice before saving',()=>{
  const review=createReviewSession({assumption:'Missing member',inferredPlacements:['b'],groups:{g:{label:'G1',enemies:['a','b']}},variants:[{pulls:[{groups:['g']}]}]});
  assert.equal(review.state().complete,false);assert.equal(review.state().options[0].id,'accept-inferred');
  review.choose('accept-inferred');assert.equal(review.state().complete,true);review.back();assert.equal(review.state().complete,false);
});
