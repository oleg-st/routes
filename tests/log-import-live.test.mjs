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
import {mapViews,mapCoordinates} from '../map-views.js';
const url='https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv?fight=5';
const fight={id:5,name:'Example',startTime:100,endTime:200,dungeonPulls:[{id:1,startTime:100,endTime:200}]};
const actors=[{id:1,type:'Player'},{id:2,type:'NPC',gameID:123}];
const event={type:'damage',timestamp:120,fight:5,sourceID:1,targetID:2,targetInstance:1,amount:123456,sourceResources:{x:3,y:4,hitPoints:100,mana:88}};
const response=report=>({ok:true,json:async()=>({data:{reportData:{report}}})});
const metadata=()=>({fights:[fight],masterData:{actors:[...actors,{id:99,type:'Player'}]}});
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};

test('Single-layer imports draw invisibility between the recorded positions instead of the map origin',async()=>{
 const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
 const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json')).filter(d=>d.mapImages.length===1).map(d=>correctDungeon(d,'custom'));
 for(const dungeon of dungeons){
   const boss=dungeon.enemies.find(p=>catalog.get(p.id).isBoss),start=dungeon.enemies.find(p=>p.packId!==boss.packId);
   const resources=p=>({x:p.worldPosition.y,y:p.worldPosition.x,hitPoints:100,maxHitPoints:100});
   const input={complete:true,reportCode:'example',fight:{...fight,name:dungeon.name,startTime:0,endTime:10000,dungeonPulls:[{id:1,startTime:4000,endTime:9000}]},
     actors:[{id:1,type:'Player'},{id:2,type:'NPC',subType:'Boss',gameID:catalog.get(boss.id).gameId}],events:[
       {fight:5,timestamp:1000,type:'cast',sourceID:1,abilityGameID:1486,sourceResources:resources(start)},
       {fight:5,timestamp:1000,type:'applybuff',sourceID:1,targetID:1,abilityGameID:1002146,targetResources:resources(start)},
       {fight:5,timestamp:2000,type:'removebuff',sourceID:1,targetID:1,abilityGameID:1002146,targetResources:resources(boss)},
       {...event,timestamp:4000,targetResources:resources(boss),sourceResources:resources(boss)},
     ]};
   const result=await matchLiveLog(input,{dungeon,catalog,presets:{},dungeonData:'custom'}),view=mapViews(dungeon)[0];
   assert.equal(result.drawings.length,1,dungeon.name);
   const drawing=result.drawings[0];assert.equal(drawing.kind,'invis');assert.equal(drawing.mapId,view.id);assert.equal(drawing.afterTime,2);
   for(const [i,p]of [start,boss].entries())assert.ok(drawing.points[i].every((v,j)=>Math.abs(v-mapCoordinates(p,view)[j])<1e-6),dungeon.name);
   assert.ok(Math.hypot(...drawing.points[0].map((v,i)=>v-drawing.points[1][i]))>1);
 }
});
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
  assert.equal((await loadReportFights(url.replace('fight=5','fight=last'),{token:'x',fetcher})).selectedFightID,8);
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
test('A unique inferred route completes without a redundant choice',()=>{
  const review=createReviewSession({assumption:'Missing member',inferredPlacements:['b'],groups:{g:{label:'G1',enemies:['a','b']}},variants:[{pulls:[{groups:['g']}]}]});
  assert.equal(review.state().complete,true);assert.deepEqual(review.state().options,[]);
  assert.equal(review.state().canBack,false);
});

test('Chicken on an identified summon does not require or exclude a map placement',async()=>{
  const p={id:'mob',placementId:'static',packId:'pack',worldPosition:{x:100,y:100},mapPosition:{x:0.5,y:0.5},mapImageId:'map'};
  const dungeon={id:'test',name:'Test',enemies:[p],mapImages:[{id:'map',width:100,height:100}]};
  const catalog=new Map([['mob',{id:'mob',gameId:90,name:'Recluse'}]]);
  const input={complete:true,reportCode:'example',fight,actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:90},{id:3,type:'NPC',gameID:92}],events:[
    {...event,targetResources:{x:100,y:100,hitPoints:100,maxHitPoints:100}},
    {fight:5,type:'summon',timestamp:140,sourceID:3,targetID:2,targetInstance:2},
    {fight:5,type:'cast',timestamp:150,sourceID:1,targetID:2,targetInstance:2,abilityGameID:1478},
  ]};
  const options={dungeon,catalog,presets:{},dungeonData:'custom'};
  const result=await matchLiveLog(input,options);
  assert.equal(result.variants.length,1);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies),['static']);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.excluded),[]);
  const unknown=structuredClone(input);unknown.events.at(-1).targetID=99;
  await assert.rejects(matchLiveLog(unknown,options),/Chicken target could not be identified/);
  const ordinary=structuredClone(input);ordinary.events.at(-1).targetInstance=1;
  assert.deepEqual(Object.values((await matchLiveLog(ordinary,options)).groups).flatMap(g=>g.excluded),['static']);
});

test('Chicken on a new boss add uses its unique replacement without excluding ordinary mobs of the same type',async()=>{
  const placement=(id,x)=>({id,placementId:id,packId:id,worldPosition:{x,y:x},mapPosition:{x:0.5,y:0.5},mapImageId:'map'});
  const dungeon={id:'test',name:'Test',enemies:[placement('static',100),placement('boss',10000)],mapImages:[{id:'map',width:100,height:100}]};
  const catalog=new Map([['static',{id:'static',gameId:999,name:'Ordinary mob'}],['boss',{id:'boss',gameId:900,name:'Boss',isBoss:true}]]);
  const resources=x=>({x,y:x,hitPoints:100,maxHitPoints:100});
  const input={complete:true,reportCode:'example',fight,actors:[{id:1,type:'Player'},
    {id:2,type:'NPC',gameID:999},{id:3,type:'NPC',subType:'Boss',gameID:900},{id:4,type:'NPC',gameID:277}],events:[
    {...event,targetResources:resources(100)},
    {...event,timestamp:140,targetID:3,targetResources:resources(10000),sourceResources:resources(10000)},
    {fight:5,type:'cast',timestamp:150,sourceID:1,targetID:2,targetInstance:2,abilityGameID:1478},
    {...event,timestamp:151,targetID:4,targetResources:resources(10010),sourceResources:resources(10000)},
  ]};
  const result=await matchLiveLog(input,{dungeon,catalog,presets:{},dungeonData:'custom'});
  assert.equal(result.variants.length,1);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies).sort(),['boss','static']);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.excluded),[]);
  const ambiguous=structuredClone(input);
  ambiguous.events.push({...ambiguous.events.at(-1),targetInstance:2});
  await assert.rejects(matchLiveLog(ambiguous,{dungeon,catalog,presets:{},dungeonData:'custom'}));
});

test('Chicken on an unmapped boss add imports normally only with fresh nearby boss evidence',async()=>{
 const p={id:'boss',placementId:'boss',packId:'boss',worldPosition:{x:10000,y:10000},mapPosition:{x:0.5,y:0.5},mapImageId:'map'};
 const dungeon={id:'test',name:'Test',enemies:[p],mapImages:[{id:'map',width:100,height:100}]};
 const catalog=new Map([['boss',{id:'boss',gameId:900,name:'Boss',isBoss:true}]]);
 const resources=x=>({x,y:x,hitPoints:100,maxHitPoints:100});
 const input={complete:true,reportCode:'example',fight,actors:[{id:1,type:'Player'},
   {id:2,type:'NPC',gameID:279},{id:3,type:'NPC',subType:'Boss',gameID:900},{id:4,type:'NPC',gameID:277}],events:[
   {...event,timestamp:140,targetID:3,targetResources:resources(10000),sourceResources:resources(10000)},
   {...event,timestamp:145,targetResources:resources(10100),sourceResources:resources(10000)},
   {fight:5,type:'cast',timestamp:150,sourceID:1,targetID:2,targetInstance:1,abilityGameID:1478},
   {...event,timestamp:151,targetID:4,targetResources:resources(10100)},
 ]};
 const options={dungeon,catalog,presets:{},dungeonData:'custom'};
 for(const castOnly of [false,true]){
   const log=structuredClone(input);if(castOnly)log.events.splice(1,1);
   const result=await matchLiveLog(log,options);
   assert.equal(result.partial,undefined);assert.equal(result.variants.length,1);
   assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies),['boss']);
   assert.deepEqual(Object.values(result.groups).flatMap(g=>g.excluded),[]);
   const remote=structuredClone(log);
   for(const e of remote.events.filter(e=>[2,4].includes(e.targetID)&&e.targetResources))e.targetResources=resources(20000);
   await assert.rejects(matchLiveLog(remote,options),/Chicken target could not be identified/);
 }
});

test('Delayed Chicken geometry is usable within ten seconds, but ambiguous or later replacements are not',async()=>{
 const p={id:'mob',placementId:'static',packId:'pack',worldPosition:{x:100,y:100},mapPosition:{x:0.5,y:0.5},mapImageId:'map'};
 const options={dungeon:{id:'test',name:'Test',enemies:[p],mapImages:[{id:'map',width:100,height:100}]},
   catalog:new Map([['mob',{id:'mob',gameId:331,name:'Sanguine Disciple'}]]),presets:{},dungeonData:'custom',allowPartial:true};
 const input={complete:true,reportCode:'example',fight:{...fight,endTime:20000,dungeonPulls:[{id:1,startTime:100,endTime:20000}]},
   actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:331},{id:3,type:'NPC',gameID:278}],events:[
     {...event,type:'cast',abilityGameID:1478,timestamp:150},
     {...event,timestamp:7801,targetID:3,targetResources:{x:100,y:100,hitPoints:100,maxHitPoints:100}},
   ]};
 const result=await matchLiveLog(input,options);
 assert.deepEqual(result.partial.skipped,[]);
 assert.deepEqual(Object.values(result.groups).flatMap(g=>g.excluded),['static']);
 const late=structuredClone(input);late.events[1].timestamp=10151;
 await assert.rejects(matchLiveLog(late,options),/No enemies could be matched/);
 const ambiguous=structuredClone(input);ambiguous.events.push({...ambiguous.events[1],targetInstance:2});
 await assert.rejects(matchLiveLog(ambiguous,options),/No enemies could be matched/);
 const nextCast=structuredClone(input);nextCast.events.push({...nextCast.events[0],timestamp:1000,targetInstance:2});
 const nextResult=await matchLiveLog(nextCast,options);
 assert.deepEqual(nextResult.partial.skipped.map(r=>r.key),['2:1']);
});
