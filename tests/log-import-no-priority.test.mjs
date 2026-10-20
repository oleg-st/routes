import test from 'node:test';
import assert from 'node:assert/strict';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createReviewSession} from '../log-import/review-session.js';

test('Focused damage does not annotate or change imported route candidates',async()=>{
  const positions=[11,12,13].map((id,i)=>({id:`mob-${id}`,placementId:`pos-${id}`,packId:'pack',
    worldPosition:{x:100+i*20,y:100},mapPosition:{x:.1+i*.02,y:.1},mapImageId:'map'}));
  const dungeon={id:'test',name:'Test',enemies:positions,mapImages:[{id:'map',name:'Start',width:100,height:100}]};
  const catalog=new Map(positions.map((p,i)=>[p.id,{id:p.id,gameId:911+i,name:p.id}]));
  const actors=[{id:1,type:'Player'},{id:2,type:'Player'},...[11,12,13].map(id=>({id,type:'NPC',gameID:900+id}))];
  const events=[];
  for(let t=1000;t<4000;t+=1000)for(const player of [1,2])for(const mob of [11,12,13]){
    const p=positions.find(p=>p.placementId===`pos-${mob}`);
    events.push({fight:1,type:'damage',timestamp:t+(player-1)*30+(mob-11)*5,sourceID:player,targetID:mob,
      amount:mob===11?90:5,targetResources:{x:p.worldPosition.y,y:p.worldPosition.x,
        hitPoints:mob===11?1000*(1-t/4000):900,maxHitPoints:1000}});
  }
  for(const [targetID,timestamp]of [[11,4000],[12,14000],[13,19000]])events.push({fight:1,type:'death',timestamp,targetID});
  const log={complete:true,reportCode:'test',actors,events,fight:{id:1,name:'Test',startTime:0,endTime:24000,
    friendlyPlayers:[1,2],dungeonPulls:[{id:1,startTime:100,endTime:24000,encounterID:0}]}};
  const options={dungeon,catalog,presets:{},dungeonData:'custom'};
  const focused=await matchLiveLog(log,options);
  const balanced=structuredClone(log);
  balanced.events.filter(e=>e.type==='damage').forEach(e=>e.amount=10);
  assert.deepEqual(await matchLiveLog(balanced,options),focused);
  assert.equal(focused.variants.length,1);
  assert.doesNotMatch(JSON.stringify(focused),/priorityTargets|priorityAssignments/);
  const state=createReviewSession(focused).state();
  assert.equal(state.complete,true);
  assert.equal(state.pulls.flatMap(p=>p.groups).length,1);
  assert.doesNotMatch(JSON.stringify(state),/priorityTargets|priorityAssignments/);
});

test('Review ignores legacy priority metadata before and after route selection',()=>{
  const review=createReviewSession({groups:{first:{},a:{},b:{}},
    variants:['a','b'].map(id=>({pulls:[{groups:['first']},{groups:[id]}],
      priorityTargets:['focused-mob'],priorityAssignments:[[{id:'first',mobKeys:['11:1']}]]}))});
  assert.equal(review.state().complete,false);
  assert.doesNotMatch(JSON.stringify(review.state()),/priorityTargets|priorityAssignments/);
  const selected=review.choose('a');
  assert.equal(selected.complete,true);
  assert.deepEqual(selected.pulls.map(p=>p.groups),[['first'],['a']]);
  assert.doesNotMatch(JSON.stringify(selected),/priorityTargets|priorityAssignments/);
  review.back();
  assert.equal(review.state().complete,false);
});
