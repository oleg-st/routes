import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewSession} from '../log-import/review-session.js';
import {logFixtures} from './fixtures/log-review.js';
import {bossIntervals,outsideBossCombat,deduplicateRelicUsages} from '../log-import/route-relics.js';

test('Immediate routes and choices preserve complete-route compatibility and reversible history',()=>{
  for(const fixture of logFixtures){
    const session=createReviewSession(fixture),start=session.state();
    assert.equal(start.complete,fixture.variants.length===1);
    for(let n=0;!session.state().complete&&n<20;n++){
      const before=session.state(),option=before.options[0];session.choose(option.id);
      assert.ok(session.state().remaining<before.remaining);
      session.back();assert.deepEqual(session.state(),before);session.choose(option.id);
    }
    const result=session.state();assert.equal(result.complete,true);
    assert.ok(fixture.variants.some(v=>JSON.stringify(v.pulls)===JSON.stringify(result.pulls)));
    const ids=result.pulls.flatMap(p=>p.groups.flatMap(id=>fixture.groups[id].enemies));
    assert.equal(new Set(ids).size,ids.length,'no placement reused across pulls');
  }
});

test('A unique route with an unobserved member still requires explicit acceptance',()=>{
  const fixture=logFixtures[2],session=createReviewSession({...fixture,variants:fixture.variants.slice(0,1)});
  assert.equal(session.state().complete,false);
  assert.equal(session.state().options[0].label,'Include the inferred pack member');
  assert.deepEqual(session.state().options[0].groups,['a']);
  session.choose('accept-inferred');assert.equal(session.state().complete,true);
  session.back();assert.equal(session.state().complete,false);
});

test('Stop at first divergence, permit a no-more-packs branch, then advance to next divergence',()=>{
  const groups=Object.fromEntries(['a','b','c','d'].map(id=>[id,{label:id}]));
  const fixture={groups,variants:[{pulls:[{groups:['a']},{groups:['c']}]},{pulls:[{groups:['a','b']},{groups:['c']}]},{pulls:[{groups:['a','b']},{groups:['d']}]}]};
  const s=createReviewSession(fixture);assert.equal(s.state().pulls.length,1);
  assert.ok(s.state().options.some(o=>o.id==='finish-pull'));
  s.choose('b');assert.equal(s.state().pullIndex,1);assert.equal(s.state().options.length,2);
  s.choose('d');assert.equal(s.state().complete,true);s.back();s.back();s.choose('finish-pull');
  assert.equal(s.state().complete,true);assert.deepEqual(s.state().pulls[1].groups,['c']);
  assert.throws(()=>s.choose('b'));
});

test('Invisibility skips overlapping boss combat are excluded; exact pre-boss endpoint is allowed',()=>{
  const events=[{fight:7,type:'dungeonencounterstart',encounterID:1,timestamp:100},{fight:7,type:'dungeonencounterend',encounterID:1,timestamp:200},{fight:7,type:'dungeonencounterstart',encounterID:1,timestamp:300}];
  const intervals=bossIntervals(events,7,500);assert.deepEqual(intervals,[[100,200],[300,500]]);
  const usage=(start,end)=>({start:{time:start,position:{x:0,y:0}},end:{time:end,position:{x:1,y:1}}});
  assert.equal(outsideBossCombat(usage(50,100),intervals),true);
  assert.equal(outsideBossCombat(usage(50,101),intervals),false);
  assert.equal(outsideBossCombat(usage(120,150),intervals),false);
  assert.equal(outsideBossCombat(usage(200,250),intervals),true);
  assert.equal(outsideBossCombat(usage(350,400),intervals),false);
});

test('Invisibility repeats after long waits collapse only when both endpoints are close; relic kinds stay separate',()=>{
  const use=(kind,time,x,end)=>({kind,start:{time,position:{x,y:0}},end:{time:time+100,position:{x:end,y:0}}});
  const first=use('invis',0,0,5000),repeat=use('invis',1000000,50,5100),otherExit=use('invis',2000000,50,7000),portal=use('portal',3000000,0,5000);
  assert.deepEqual(deduplicateRelicUsages([repeat,first,otherExit,portal]),[first,otherExit,portal]);
  const bossFirst=use('invis',500,0,5000),later=use('invis',5000,0,5000);
  assert.deepEqual(deduplicateRelicUsages([bossFirst,later].filter(u=>outsideBossCombat(u,[[400,700]]))),[later]);
});
