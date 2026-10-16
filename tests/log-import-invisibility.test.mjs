import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInvisibility,createVisibilityIndex} from '../log-import/invisibility.js';
const options={fightID:5,players:[{id:1},{id:2}],complete:true};
const event=(type,t,targetID=1,extra={})=>({fight:5,type,timestamp:t,sourceID:1,targetID,abilityGameID:1002146,...extra});
test('Visibility uses individual buff intervals, preserving visible gaps and the exact removal boundary',()=>{
  const result=extractInvisibility([event('applybuff',10),event('removebuff',20),event('applybuff',30),event('removebuff',40)],options);
  const index=createVisibilityIndex(result.intervals);
  assert.deepEqual([9,10,19,20,29,30,39,40].map(t=>index.stateAt(1,t)),['visible','invisible','invisible','visible','visible','invisible','invisible','visible']);
  assert.equal(index.stateAt(2,15),'visible');
  assert.equal(createVisibilityIndex([{playerID:1,start:{time:10},end:null}]).stateAt(1,20),'unknown');
});
test('Invisibility preserves different entry/exit times and target coordinates for each player',()=>{
  const result=extractInvisibility([
    event('cast',0,-1,{abilityGameID:1486,sourceResources:{x:1,y:2}}),
    event('applybuff',10,1,{targetResources:{x:3,y:4},duration:15000}),
    event('applybuff',20,2,{targetResources:{x:5,y:6}}),
    event('removebuff',100,2,{targetResources:{x:7,y:8}}),
    event('removebuff',200,1,{targetResources:{x:9,y:10}}),
  ],options);
  assert.deepEqual(result.intervals.map(i=>[i.playerID,i.start.time,i.end.time]),[[1,10,200],[2,20,100]]);
  assert.equal(result.intervals[1].end.position.x,7);
  assert.equal(result.casts[0].position.x,1);
  assert.equal(result.usages[0].start.time,0);
  assert.equal(result.usages[0].start.position.x,1);
  assert.equal(result.usages[0].end.time,100);
  assert.equal(result.usages[0].end.playerID,2);
});
test('Temporary exits do not end the route marker; choose the earliest final exit across players',()=>{
  const result=extractInvisibility([
    event('cast',0,-1,{abilityGameID:1486}),event('applybuff',10),event('applybuff',10,2),
    event('removebuff',100),event('applybuff',1100),event('removebuff',1300,2),event('removebuff',2000),
  ],options);
  assert.equal(result.usages[0].end.time,1300);
  assert.equal(result.usages[0].end.playerID,2);
  assert.equal(result.usages[0].finalExits.find(e=>e.playerID===1).intervalCount,2);
});
test('A new activation does not turn the previous activation final exit into a temporary exit',()=>{
  const result=extractInvisibility([
    event('cast',0,-1,{abilityGameID:1486}),event('applybuff',10),event('removebuff',100),
    event('cast',1000,-1,{abilityGameID:1486}),event('applybuff',1010),event('removebuff',1100),
  ],options);
  assert.deepEqual(result.usages.map(u=>u.end.time),[100,1100]);
});
test('Different casters stay separate; incomplete streams or re-entry without removal cannot prove final exit',()=>{
  const events=[event('cast',0,-1,{abilityGameID:1486}),event('applybuff',10),event('removebuff',100),
    event('cast',500,-1,{abilityGameID:1486,sourceID:2}),event('applybuff',510,1,{sourceID:2}),event('removebuff',600,1,{sourceID:2})];
  assert.deepEqual(extractInvisibility(events,options).usages.map(u=>u.end.time),[100,600]);
  assert.equal(extractInvisibility(events,{...options,complete:false}).usages[0].end,null);
  assert.equal(extractInvisibility([...events,event('applybuff',200)],options).usages[0].end,null);
});
test('Missing boundaries and coordinates stay unknown; refresh does not reset entry',()=>{
  const result=extractInvisibility([event('applybuff',1),event('refreshbuff',2),event('removebuff',3),
    event('refreshbuff',4,2),event('removebuff',5,2),event('applybuff',6)],options);
  assert.equal(result.intervals[0].start.time,1);
  assert.equal(result.intervals[0].start.position,null);
  assert.equal(result.intervals[1].start,null);
  assert.equal(result.intervals[2].end,null);
});
test('Unrelated stealth, other fights and NPC targets do not become relic invisibility',()=>{
  assert.equal(extractInvisibility([event('applybuff',1,1,{abilityGameID:123}),event('applybuff',1,1,{fight:6}),event('applybuff',1,3)],options).status,'not-observed');
  assert.equal(extractInvisibility([event('applybuff',1,1,{abilityGameID:999,extraAbilityGameID:1486}),event('removebuff',2,1,{abilityGameID:999})],options).intervals[0].status,'complete');
});
