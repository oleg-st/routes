import test from 'node:test';
import assert from 'node:assert/strict';
import {matchLiveLog} from '../log-import/live-matcher.js';

function example(){
  const placement=(id,type,x,packId)=>({id:type,placementId:id,packId,worldPosition:{x,y:x},mapPosition:{x:0.5,y:0.5},mapImageId:'map'});
  const dungeon={id:'test',name:'Test',enemies:[placement('a','mob',100,'pack'),placement('b','mob',200,'pack'),placement('c','mob',300,'pack'),placement('boss','boss',10000,'boss')],mapImages:[{id:'map',width:100,height:100}]};
  const catalog=new Map([['mob',{id:'mob',gameId:900,name:'Ordinary mob'}],['boss',{id:'boss',gameId:901,name:'Boss',isBoss:true}]]);
  const hit=(targetID,x,timestamp=10000)=>({fight:5,type:'damage',timestamp,sourceID:1,targetID,targetInstance:1,
    sourceResources:{x,y:x,hitPoints:100,maxHitPoints:100},targetResources:{x,y:x,hitPoints:90,maxHitPoints:100}});
  const log={complete:true,reportCode:'c4nFLaThdAxtVpYv',fight:{id:5,name:'Test',startTime:0,endTime:30000,dungeonPulls:[{id:1,startTime:0,endTime:15000},{id:2,startTime:15000,endTime:30000}]},
    actors:[{id:1,type:'Player'},{id:2,type:'NPC',gameID:900},{id:3,type:'NPC',gameID:901,subType:'Boss'}],events:[hit(2,100),hit(3,10000,20000)]};
  return {log,options:{dungeon,catalog,presets:{},dungeonData:'custom'}};
}
test('Explicit recovery imports observed members without inventing missing pack siblings',async()=>{
  const {log,options}=example();
  await assert.rejects(matchLiveLog(log,options),e=>e.diagnostics?.code==='no-compatible-route');
  const r=await matchLiveLog(log,{...options,allowPartial:true});
  assert.deepEqual(Object.values(r.groups).flatMap(g=>g.enemies).sort(),['a','boss']);
  assert.equal(r.variants[0].pulls.length,2);assert.equal(r.partial.matched,2);assert.deepEqual(r.partial.skipped,[]);
  assert.match(r.assumption,/Partial import/);assert.deepEqual(r.inferredPlacements,[]);
});
test('Recovery keeps one-to-one placement identity and reports duplicate observations',async()=>{
  const {log,options}=example();log.events.splice(1,0,{...log.events[0],timestamp:11000,targetInstance:2});
  const r=await matchLiveLog(log,{...options,allowPartial:true});
  assert.equal(r.partial.matched,2);assert.equal(r.partial.skipped.length,1);
  assert.deepEqual(Object.values(r.groups).flatMap(g=>g.enemies).sort(),['a','boss']);
  assert.match(r.assumption,/Ordinary mob ×1/);
});
test('Recovery skips an unknown Chicken target while retaining known enemies',async()=>{
  const {log,options}=example();log.actors.push({id:4,type:'NPC',gameID:999});
  log.events.push({fight:5,type:'cast',timestamp:25000,sourceID:1,targetID:4,abilityGameID:1478});
  await assert.rejects(matchLiveLog(log,options),e=>e.diagnostics?.code==='unknown-chicken-target');
  const r=await matchLiveLog(log,{...options,allowPartial:true});
  assert.equal(r.partial.matched,2);assert.equal(r.partial.skipped[0].key,'4:1');
  assert.deepEqual(Object.values(r.groups).flatMap(g=>g.excluded),[]);
});
test('Recovery still rejects incomplete or cancelled logs',async()=>{
  const {log,options}=example();
  await assert.rejects(matchLiveLog({...log,complete:false},{...options,allowPartial:true}),/Incomplete log/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(matchLiveLog(log,{...options,allowPartial:true,signal:controller.signal}),e=>e.name==='AbortError');
});
test('Recovery does not turn an unsupported remote pack into a valid match',async()=>{
  const {log,options}=example();
  options.catalog.set('remote',{id:'remote',gameId:902,name:'Remote mob'});
  options.dungeon.enemies.push({...options.dungeon.enemies[0],id:'remote',placementId:'remote',packId:'remote',worldPosition:{x:90000,y:90000}});
  log.actors.push({id:4,type:'NPC',gameID:902});
  log.events.push({...log.events[0],timestamp:12000,targetID:4,targetResources:{x:50000,y:50000,hitPoints:100,maxHitPoints:100}});
  log.events.sort((a,b)=>a.timestamp-b.timestamp);
  const r=await matchLiveLog(log,{...options,allowPartial:true});
  assert.equal(r.partial.matched,2);assert.equal(r.partial.skipped[0].key,'4:1');
});
