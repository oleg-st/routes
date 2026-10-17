import test from 'node:test';
import assert from 'node:assert/strict';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createReviewSession} from '../log-import/review-session.js';

test('More than 100 complete routes remain available through small independent review choices',async()=>{
  // Seven pulls, each with two possible single-mob packs: 128 complete routes.
  // First recorded positions are between spawns, so neither is a hard anchor.
  const enemies=[],actors=[{id:1,type:'Player'}],events=[],pulls=[],catalog=new Map();
  for(let i=0;i<7;i++){
    const x=i*20000,time=1000+i*10000,type=`mob-${i}`,gameID=900+i;
    catalog.set(type,{id:type,gameId:gameID,name:`Mob ${i}`});
    actors.push({id:i+2,type:'NPC',gameID});
    pulls.push({id:i+1,startTime:time,endTime:time+5000});
    for(const side of [-1,1])enemies.push({id:type,placementId:`${i}:${side}`,packId:`pack-${i}:${side}`,
      worldPosition:{x:x+side*100,y:0},mapPosition:{x:.5,y:.5},mapImageId:'map'});
    events.push({fight:1,timestamp:time,type:'damage',sourceID:1,targetID:i+2,targetInstance:1,
      sourceResources:{x:0,y:x,hitPoints:100,maxHitPoints:100},targetResources:{x:0,y:x,hitPoints:90,maxHitPoints:100}});
  }
  const log={complete:true,reportCode:'test',fight:{id:1,name:'Test',startTime:0,endTime:70000,dungeonPulls:pulls},actors,events};
  const dungeon={id:'test',name:'Test',enemies,mapImages:[{id:'map',width:100,height:100,path:'test.png'}]};
  const result=await matchLiveLog(log,{dungeon,catalog,presets:{},dungeonData:'custom'});
  assert.equal(result.variants.length,128);
  assert.equal(result.partial,undefined);
  const review=createReviewSession(result),initial=review.state();
  assert.equal(initial.complete,false);assert.equal(initial.remaining,128);
  for(let i=0;i<7;i++){
    const state=review.state();assert.equal(state.pullIndex,i);assert.equal(state.options.length,2);
    const option=state.options.at(-1);review.choose(option.id);
    assert.equal(review.state().remaining,state.remaining/2);
    review.back();assert.deepEqual(review.state(),state);review.choose(option.id);
  }
  const final=review.state();assert.equal(final.complete,true);assert.equal(final.remaining,1);
  assert.ok(result.variants.some(v=>JSON.stringify(v.pulls)===JSON.stringify(final.pulls)));
  assert.equal(new Set(final.pulls.flatMap(p=>p.groups.flatMap(id=>result.groups[id].enemies))).size,7);
});
