import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySummons,suspectLateEncounterNPCs,bossProximityAdds} from '../log-import/summon-evidence.js';
const actors=[{id:1,gameID:133,type:'NPC'},{id:2,gameID:134,type:'NPC'}];
const row={key:'2:7',actorID:2,instance:7,gameID:134,firstTime:20000,nearest:[]};
const run=(events,rows=[row],a=actors)=>classifySummons({fightID:5,actors:a,rows,events});
test('Direct summon identity takes precedence over a boss heuristic',()=>assert.equal(run([{fight:5,type:'summon',timestamp:19900,sourceID:1,targetID:2,targetInstance:7}])[0].basis,'fl-summon-event'));
test('Brogg Raiders cast classifies new Mancatchers, not every late mob',()=>{
 const e={fight:5,type:'cast',timestamp:19000,sourceID:1,abilityGameID:631};
 assert.equal(run([e])[0].classification,'probable-summon');
 for(const r of [{...row,gameID:13},{...row,firstTime:18000},{...row,firstTime:23000},{...row,nearest:[{distance:0.5}]}])assert.equal(run([e],[r]).length,0);
 assert.equal(run([{...e,fight:6}]).length,0);
 assert.equal(run([{...e,abilityGameID:630}]).length,0);
});
test('Missing instance on a multi-instance actor cannot classify all instances as summons',()=>{
 const e={fight:5,type:'summon',timestamp:19000,sourceID:1,targetID:2};
 assert.equal(run([e],[row,{...row,key:'2:8',instance:8}]).length,0);
});
test('Same mechanism accepts a verified rule for another boss without broad late-mob exclusion',()=>{
 const rules=[{id:'other-boss',bossGameID:900,abilityGameID:901,childGameIDs:[902],windowMs:2000}];
 const result=classifySummons({fightID:5,actors:[{id:9,gameID:900,type:'NPC'}],rows:[{...row,gameID:902}],
  events:[{fight:5,type:'cast',timestamp:19000,sourceID:9,abilityGameID:901}],rules});
 assert.equal(result[0].rule,'other-boss');
});
test('Generic late-encounter heuristic is diagnostic only and preserves earlier pulled mobs',()=>{
 const result=suspectLateEncounterNPCs({fightID:5,actors:[{id:9,subType:'Boss'}],
  rows:[{...row,nearest:[{distance:100}]},{...row,key:'earlier',firstTime:1000,nearest:[{distance:100}]}],
  events:[{fight:5,type:'dungeonencounterstart',encounterID:1,timestamp:2000},{fight:5,type:'dungeonencounterend',encounterID:1,timestamp:25000}]});
 assert.equal(result.length,1);assert.equal(result[0].exclude,false);
});

test('Golem Shatter excludes only a complete nearby trio after an actual death',()=>{
 const parent={key:'1:1',actorID:1,gameID:160,positions:[{t:9500,x:100,y:100}],deaths:[{timestamp:10000}]};
 const children=[0,1,2].map(i=>({...row,key:`2:${i+1}`,instance:i+1,gameID:161,firstTime:10500+i*100,
   firstPosition:{t:10500+i*100,x:100+i*50,y:100},nearest:[{distance:2000}]}));
 const classify=rs=>run([],rs,[]);
 assert.equal(classify([parent,...children]).length,3);
 for(const rs of [[{...parent,deaths:[]},...children],[parent,...children.slice(1)],
   [parent,...children.map(r=>({...r,firstTime:9999}))],
   [parent,...children.map(r=>({...r,firstPosition:{...r.firstPosition,x:5000}}))],
   [parent,...children.map(r=>({...r,nearest:[{distance:0.5}]}))]])assert.equal(classify(rs).length,0);
});

test('Boss proximity handles arbitrary boss/add types with fresh combat evidence',()=>{
 const events=[{fight:5,type:'dungeonencounterstart',encounterID:1,timestamp:1000},
   {fight:5,type:'dungeonencounterend',encounterID:1,timestamp:30000}];
 for(const [boss,child]of [[168,164],[168,165],[172,241],[199,182],[900,999]]){
   const parent={key:'1:1',actorID:1,gameID:boss,firstTime:1000,positions:[{t:19000,x:0,y:0,hp:100,eventType:'damage'}],deaths:[]};
   const add={...row,gameID:child,firstPosition:{t:20000,x:100,y:100},nearest:[{distance:2000}]};
   const a=[{id:1,gameID:boss,type:'NPC',subType:'Boss'}];
   assert.equal(run(events,[parent,add],a).length,1);
   for(const bad of [{...add,firstTime:5000},{...add,nearest:[{distance:10}]},{...add,firstPosition:{t:20000,x:10000,y:0}}])assert.equal(run(events,[parent,bad],a).length,0);
   assert.equal(run(events,[{...parent,deaths:[{timestamp:15000}]},add],a).length,0);
 }
});

test('Proximity preserves earlier trash, static spawns, bosses, stale samples and dead or passive bosses',()=>{
 const boss={key:'1:1',actorID:1,gameID:900,firstTime:10000,positions:[{t:20000,x:0,y:0,hp:100,eventType:'damage'}],deaths:[]};
 const add={...row,gameID:999,firstTime:20000,firstPosition:{t:20000,x:100,y:0},nearest:[{distance:5000}]};
 const actors=[{id:1,gameID:900,type:'NPC',subType:'Boss'},{id:2,gameID:999,type:'NPC'}];
 const events=[{fight:5,type:'dungeonencounterstart',encounterID:999,timestamp:10000},{fight:5,type:'dungeonencounterend',encounterID:999,timestamp:30000}];
 const check=(b=boss,r=add,es=events)=>bossProximityAdds({fightID:5,actors,rows:[b,r],events:es});
 assert.equal(check().length,1);
 for(const r of [
   {...add,firstTime:5000,firstPosition:{t:5000,x:100,y:0},positions:[{t:20000,x:100,y:0}]},
   {...add,nearest:[{distance:999}]},
   {...add,actorID:1},
   {...add,firstPosition:undefined},
   {...add,firstPosition:{x:100,y:0}},
   {...add,firstPosition:{t:24000,x:100,y:0}},
   {...add,firstPosition:{t:20000,x:3001,y:0}},
 ])assert.equal(check(boss,r).length,0);
 // Unmapped adds still need an identity when a player Chickenizes them.
 assert.equal(check(boss,{...add,nearest:[]}).length,1);
 assert.equal(check(boss,{...add,nearest:[],firstPosition:undefined}).length,0);
 for(const b of [
   {...boss,positions:[{...boss.positions[0],t:16000}]},
   {...boss,positions:[{...boss.positions[0],hp:0}]},
   {...boss,positions:[{...boss.positions[0],eventType:'applybuff'}]},
   {...boss,deaths:[{timestamp:19999}]},
 ])assert.equal(check(b).length,0);
 assert.equal(check(boss,add,events.map(e=>({...e,timestamp:e.timestamp-20000}))).length,0);
 // Without encounter events, fresh boss combat is still enough; proximity
 // to a passive boss alone remains insufficient.
 assert.equal(check(boss,add,[]).length,1);
 assert.equal(check({...boss,positions:[{...boss.positions[0],eventType:'applybuff'}]},add,[]).length,0);
});

test('Han-Eth response adds beyond the generic radius require late, nearby live boss evidence',()=>{
 const events=[{fight:5,type:'dungeonencounterstart',encounterID:38,timestamp:1000},
   {fight:5,type:'dungeonencounterend',encounterID:38,timestamp:30000}];
 const parent={key:'1:1',actorID:1,gameID:319,positions:[{t:19900,x:-9300,y:64100,hp:100,eventType:'damage'}],deaths:[]};
 const actors=[{id:1,gameID:319,type:'NPC',subType:'Boss'}];
 const add={...row,gameID:316,firstPosition:{t:20000,x:-9177,y:67631},nearest:[{distance:8582}]};
 assert.equal(run(events,[parent,add],actors)[0].rule,'han-eth-response-unit');
 for(const bad of [{...add,firstTime:5000},{...add,nearest:[{distance:500}]},
   {...add,firstPosition:{t:20000,x:-9300,y:72000}},{...add,gameID:331}])assert.equal(run(events,[parent,bad],actors).length,0);
 assert.equal(run(events,[{...parent,deaths:[{timestamp:18000}]},add],actors).length,0);
});

test('Opening adds are recognized across wipes, including observations just before the start event',()=>{
 const actors=[{id:1,gameID:900,type:'NPC',subType:'Boss'},{id:2,gameID:999,type:'NPC'}];
 const events=[10000,50000].flatMap(start=>[{fight:5,type:'dungeonencounterstart',encounterID:42,timestamp:start},
   {fight:5,type:'dungeonencounterend',encounterID:42,timestamp:start+10000}]);
 const parent={key:'1:1',actorID:1,gameID:900,positions:[10050,50050].map(t=>({t,x:0,y:0,hp:100,eventType:'damage'})),deaths:[{timestamp:20000}]};
 const adds=[10000,49999].map((t,i)=>({...row,key:`2:${i+1}`,instance:i+1,gameID:999,firstTime:t,firstPosition:{t,x:100,y:0},nearest:[{distance:5000}]}));
 const result=classifySummons({fightID:5,actors,rows:[parent,...adds],events});
 assert.deepEqual(result.map(r=>r.key),['2:1','2:2']);
 assert.ok(result.every(r=>r.basis==='first-appearance-near-active-boss'));
});

test('Chilgar pillar rule preserves ordinary Remnants and needs a recent nearby cast',()=>{
 const a=[{id:1,gameID:28,type:'NPC'}],e={fight:5,type:'cast',timestamp:10000,sourceID:1,abilityGameID:222,sourceResources:{x:0,y:0}};
 const add={...row,gameID:155,firstPosition:{x:1200,y:500},nearest:[{distance:1600}]};
 assert.equal(run([e],[add],a)[0].rule,'chilgar-pillar');
 for(const bad of [{...add,nearest:[{distance:1}]},{...add,firstTime:30000},{...add,firstPosition:{x:5000,y:0}}])assert.equal(run([e],[bad],a).length,0);
});

test('Silken boss cast identifies both add types without excluding static, early or distant mobs',()=>{
 const a=[{id:1,gameID:92,type:'NPC'}];
 const e={fight:5,type:'cast',timestamp:10000,sourceID:1,abilityGameID:1396,sourceResources:{x:0,y:0}};
 for(const gameID of [90,91]){
   const add={...row,gameID,firstTime:15642,firstPosition:{x:2500,y:100},nearest:[{distance:2700}]};
   assert.equal(run([e],[add],a)[0].rule,'silken-boss-adds');
   for(const bad of [{...add,firstTime:9999},{...add,firstTime:18001},{...add,nearest:[{distance:500}]},
     {...add,firstPosition:{x:5000,y:0}},{...add,firstPosition:undefined},{...add,gameID:267}])assert.equal(run([e],[bad],a).length,0);
   for(const bad of [{...e,fake:true},{...e,abilityGameID:1600},{...e,fight:6}])assert.equal(run([bad],[add],a).length,0);
   assert.equal(run([e],[add],[{...a[0],gameID:133}]).length,0);
 }
});
