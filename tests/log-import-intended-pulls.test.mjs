import test from 'node:test';
import assert from 'node:assert/strict';
import {firstEngagements,intendedPulls,engagementSegmentIndex} from '../log-import/intended-pulls.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
const segments=[{id:1,startTime:0,endTime:10},{id:2,startTime:20,endTime:30},{id:3,startTime:40,endTime:50}];
test('Repulls after wipes retain first placement; only newly engaged enemies create another pull',()=>{
  const pulls=intendedPulls(segments,[{identity:'survivor',time:1},{identity:'killed',time:2},{identity:'survivor',time:21},{identity:'new',time:25},{identity:'new',time:41}]);
  assert.deepEqual(pulls.map(p=>[p.id,p.enemies]),[[1,['survivor','killed']],[2,['new']]]);
});
test('Bosses use first engagement, never the final successful attempt; aliases require established identity',()=>{
  const actors=[{id:1,type:'NPC'},{id:2,type:'Player'}];
  const event=(timestamp,instance,type='damage')=>({fight:7,timestamp,type,sourceID:2,targetID:1,targetInstance:instance});
  const events=[event(1,1),event(21,1),event(25,2),event(49,1,'death')];
  assert.deepEqual([...firstEngagements(events,{fightID:7,actors})],[['1:1',1],['1:2',25]]);
  assert.deepEqual([...firstEngagements(events,{fightID:7,actors,aliases:new Map([['1:2','1:1']])})],[['1:1',1]]);
});

test('New engagements in gaps belong to the next pull; exact starts and active combat retain their segment',()=>{
  assert.deepEqual([-1,0,10,11,19,20,30,31,40,50,51].map(t=>engagementSegmentIndex(segments,t)),[0,0,0,1,1,1,1,2,2,2,2]);
  assert.equal(engagementSegmentIndex([{startTime:0,endTime:20},{startTime:20,endTime:30}],20),1);
});

test('Xul Chicken casts before pull 10 do not attach Heart of Rot to the already defeated Han-Eth',async()=>{
  // Real pull boundaries and cast times from both affected Xul reports.
  for(const [start,end,cast,nextStart,nextEnd]of [[1779123,2104117,2126058,2127069,2133082],[14003465,14333619,14354629,14355707,14362115]]){
    const pos=(id,type,x)=>({id:type,placementId:id,packId:id,worldPosition:{x,y:x},mapPosition:{x:.5,y:.5},mapImageId:'map'});
    const dungeon={id:'test',name:'Test',enemies:[pos('boss','boss',0),pos('heart','heart',10000)],mapImages:[{id:'map',width:100,height:100}]};
    const catalog=new Map([['boss',{id:'boss',gameId:319,isBoss:true}],['heart',{id:'heart',gameId:326}]]);
    const resource=x=>({x,y:x,hitPoints:100,maxHitPoints:100});
    const log={complete:true,reportCode:'example',fight:{id:2,startTime:start-1000,endTime:nextEnd,dungeonPulls:[
      {id:9,startTime:start,endTime:end,encounterID:38},{id:10,startTime:nextStart,endTime:nextEnd,encounterID:0}]},
      actors:[{id:1,type:'Player'},{id:2,type:'NPC',subType:'Boss',gameID:319},{id:3,type:'NPC',gameID:326}],events:[
        {fight:2,type:'damage',timestamp:start,sourceID:1,targetID:2,sourceResources:resource(0),targetResources:resource(0)},
        {fight:2,type:'death',timestamp:end,sourceID:1,targetID:2},
        {fight:2,type:'cast',timestamp:cast,sourceID:1,targetID:3,abilityGameID:1478,sourceResources:resource(10000),targetResources:resource(10000)},
      ]};
    const result=await matchLiveLog(log,{dungeon,catalog,presets:{},dungeonData:'custom'});
    assert.deepEqual(result.variants[0].pulls.map(p=>({id:p.id,enemies:p.groups.flatMap(id=>result.groups[id].enemies)})),[
      {id:'segment-9',enemies:['boss']},{id:'segment-10',enemies:['heart']}]);
    assert.deepEqual(Object.values(result.groups).flatMap(g=>g.excluded),['heart']);
    // An enemy actually engaged during the boss fight stays in that pull.
    log.events.at(-1).timestamp=end-1000;
    const during=await matchLiveLog(log,{dungeon,catalog,presets:{},dungeonData:'custom'});
    assert.deepEqual(during.variants[0].pulls.map(p=>p.id),['segment-9']);
  }
});
