import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPortals,intendedPortals} from '../log-import/portals.js';
const resource=(x,y)=>({x,y,hitPoints:100});
const crossing=(id,time,x)=>[
  {fight:7,timestamp:time,type:'cast',abilityGameID:1506,sourceID:id,sourceResources:resource(x,0)},
  {fight:7,timestamp:time,type:'applydebuff',abilityGameID:1002176,targetID:id,targetResources:resource(5000,0)}];
const options={fightID:7,players:[{id:1},{id:2}],endTime:100000};
test('Portal debuff uses ordered same-timestamp before/after positions and averages each player once',()=>{
  const result=extractPortals([...crossing(1,1000,0),...crossing(2,2000,100)],options);
  assert.equal(result.usages.length,1);assert.equal(result.usages[0].playerCount,2);
  assert.deepEqual(result.usages[0].start.position,{x:50,y:0});assert.deepEqual(result.usages[0].end.position,{x:5000,y:0});
});
test('Separate post-wipe portal crossings remain distinct; placement casts do not create usages',()=>{
  const events=[{fight:7,type:'cast',timestamp:0,sourceID:1,abilityGameID:1504,sourceResources:resource(0,0)},...crossing(1,1000,0),...crossing(1,40000,0)];
  assert.equal(extractPortals(events,options).usages.length,2);
  assert.equal(extractPortals(events.slice(0,1),options).usages.length,0);
  assert.equal(intendedPortals(extractPortals(events,options).usages).length,1);
});

test('Nearby portal repeats collapse to the earliest; different exits and reverse trips stay distinct',()=>{
  const usage=(time,start,end)=>({kind:'portal',start:{time,position:{x:start,y:0}},end:{time,position:{x:end,y:0}}});
  const first=usage(1,0,5000),repeat=usage(10,110,5010),otherExit=usage(20,0,6000),reverse=usage(30,5000,0);
  assert.deepEqual(intendedPortals([repeat,first,otherExit,reverse]),[first,otherExit,reverse]);
  assert.equal(intendedPortals([first,usage(40,251,5000)]).length,2);
  assert.equal(intendedPortals([first,usage(40,250,5000)]).length,1);
});
test('No invented endpoint from missing/stale positions, death, or a boss-combat transition',()=>{
  assert.equal(extractPortals(crossing(1,1000,0).slice(1),options).usages.length,0);
  const old=crossing(1,1000,0);old[0].timestamp=-10000;assert.equal(extractPortals(old,options).usages.length,0);
  const death={fight:7,timestamp:999,type:'death',targetID:1};
  assert.equal(extractPortals([{...old[0],timestamp:998},death,old[1]],options).usages.length,0);
  const boss={fight:7,timestamp:500,type:'dungeonencounterstart',encounterID:3};
  assert.equal(extractPortals([boss,...crossing(1,1000,0)],options).usages.length,0);
});
