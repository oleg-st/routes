import test from 'node:test';
import assert from 'node:assert/strict';
import {firstEngagements,intendedPulls} from '../log-import/intended-pulls.js';
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
