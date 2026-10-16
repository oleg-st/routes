import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySummons,suspectLateEncounterNPCs} from '../log-import/summon-evidence.js';
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

test('Confirmed boss/add pairs require late appearance away from static spawns and a nearby living boss',()=>{
 const events=[{fight:5,type:'dungeonencounterstart',encounterID:1,timestamp:1000},
   {fight:5,type:'dungeonencounterend',encounterID:1,timestamp:30000}];
 for(const [boss,child]of [[168,164],[168,165],[172,241],[199,182]]){
   const parent={key:'1:1',actorID:1,gameID:boss,firstTime:1000,positions:[{t:19000,x:0,y:0,hp:100}],deaths:[]};
   const add={...row,gameID:child,firstPosition:{x:100,y:100},nearest:[{distance:2000}]};
   const a=[{id:1,gameID:boss,type:'NPC',subType:'Boss'}];
   assert.equal(run(events,[parent,add],a).length,1);
   for(const bad of [{...add,firstTime:5000},{...add,nearest:[{distance:10}]},{...add,firstPosition:{x:10000,y:0}},{...add,gameID:999}])assert.equal(run(events,[parent,bad],a).length,0);
   assert.equal(run(events,[{...parent,deaths:[{timestamp:15000}]},add],a).length,0);
 }
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
