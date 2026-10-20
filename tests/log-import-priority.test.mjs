import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzePriorityTargets,createPriorityTargetAnalyzer,detectSelectedRoutePriority,MAX_PRIORITY_TARGETS_PER_PACK} from '../log-import/priority-targets.js';
import {compactRouteEvent} from '../log-import/live-api.js';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {createReviewSession} from '../log-import/review-session.js';

function scenario({delay=60000,duration=3000,mode='focus'}={}){
  const actors=[{id:1,type:'Player',subType:'A'},{id:2,type:'Player',subType:'B'},
    ...[11,12,13,99].map(id=>({id,type:'NPC',gameID:900+id}))];
  const fight={id:1,name:'Test',startTime:0,endTime:delay+duration+20000,friendlyPlayers:[1,2],
    dungeonPulls:[{id:1,startTime:100,endTime:delay+duration+20000,encounterID:0}]};
  const events=[{fight:1,type:'damage',timestamp:100,sourceID:1,targetID:99,amount:999999}];
  // All three mobs are in combat before the slightly staggered damage events.
  for(const sourceID of [11,12,13])events.push({fight:1,type:'begincast',timestamp:delay,sourceID,targetID:1});
  for(let t=0;t<duration;t+=1000)for(const player of [1,2])for(const mob of [11,12,13]){
    const amount=mode==='late'?(mob===11?(t<duration/2?1:1000):10):
      mode==='aoe'?10:mode==='one-player'&&player===2?(mob===11?0:5):mob===11?90:5;
    events.push({fight:1,type:'damage',timestamp:delay+t+(player-1)*30+(mob-11)*5,sourceID:player,targetID:mob,amount,
      targetResources:{hitPoints:mob===11?Math.max(0,1000*(1-(t+1000)/duration)):900-t/duration*100,maxHitPoints:1000}});
  }
  events.push({fight:1,type:'death',timestamp:delay+duration,sourceID:1,targetID:11},
    {fight:1,type:'death',timestamp:delay+duration+10000,targetID:12},
    {fight:1,type:'death',timestamp:delay+duration+15000,targetID:13});
  return {complete:true,reportCode:'test',fight,actors,events};
}
const group={id:'pack',mobKeys:['11:1','12:1','13:1']};
const candidates=result=>result.results.filter(r=>r.candidate);

test('A late-added pack gets its own first-hit window and a fast focused kill qualifies',()=>{
  const result=analyzePriorityTargets(scenario(),[group]);
  assert.equal(candidates(result).length,1);
  const target=candidates(result)[0];assert.equal(target.key,'11:1');
  assert.equal(target.start,60000);assert.equal(target.durationMs,3000);assert.equal(target.share,.9);
  assert.equal(target.initial.share,.9);assert.equal(target.initial.supportingPlayers,2);
});

test('Late burst cannot qualify even when it dominates total damage before death',()=>{
  const result=analyzePriorityTargets(scenario({duration:20000,mode:'late'}),[group]);
  const target=result.results.find(r=>r.key==='11:1');
  assert.ok(target.share>.9);assert.ok(target.reasons.includes('no-initial-focus'));assert.equal(target.candidate,false);
});

test('Balanced AoE and a single player focusing do not establish party focus',()=>{
  for(const mode of ['aoe','one-player'])assert.equal(candidates(analyzePriorityTargets(scenario({mode}),[group])).length,0);
});

test('Multi-mob bosses, singleton packs, incomplete matching and old logs cannot qualify',()=>{
  assert.equal(candidates(analyzePriorityTargets(scenario(),[{...group,boss:true}])).length,0);
  assert.equal(candidates(analyzePriorityTargets(scenario(),[{...group,mobKeys:['11:1']}])).length,0);
  assert.equal(candidates(analyzePriorityTargets(scenario(),[{...group,incomplete:true}])).length,0);
  const old=scenario();old.events.forEach(e=>delete e.amount);
  const result=analyzePriorityTargets(old,[group]);assert.equal(candidates(result).length,0);
  assert.ok(result.results.find(r=>r.key==='11:1').reasons.includes('missing-damage-amounts'));
  assert.equal(candidates(analyzePriorityTargets({...scenario(),complete:false},[group])).length,0);
});

test('Party-owned pet damage counts; outsider damage does not create evidence',()=>{
  const log=scenario();log.actors.push({id:3,type:'NPC',petOwner:1});
  log.events.forEach(e=>{if(e.sourceID===1)e.sourceID=3;});
  assert.equal(candidates(analyzePriorityTargets(log,[group])).length,1);
  log.events.push({fight:1,type:'damage',timestamp:61000,sourceID:99,targetID:12,amount:1e10});
  assert.equal(candidates(analyzePriorityTargets(log,[group])).length,1);
});

test('Effective damage on a killing blow is not reduced by its separate overkill field',()=>{
  const log=scenario({delay:1000,duration:1000});
  log.events=log.events.filter(e=>e.type!=='damage');
  for(const sourceID of [1,2])for(const targetID of [11,12,13]){
    log.events.push({fight:1,type:'damage',timestamp:1000,sourceID,targetID,amount:targetID===11?20:10});
  }
  log.events.push(compactRouteEvent({fight:1,type:'damage',timestamp:2000,sourceID:2,targetID:11,amount:100,overkill:250}));
  const result=analyzePriorityTargets(log,[group]),target=candidates(result)[0];
  assert.equal(candidates(result).length,1);assert.equal(target.key,'11:1');
  assert.equal(target.damage,140);assert.equal(target.share,140/180);
  const withoutOverkill={...log,events:log.events.map(({overkill,...event})=>event)};
  assert.deepEqual(result,analyzePriorityTargets(withoutOverkill,[group]));
  log.events.find(e=>e.overkill===250).amount=0;
  assert.equal(candidates(analyzePriorityTargets(log,[group])).length,0,'Pure overkill adds no effective damage');
});

test('Pack members encountered only after the target dies are not alternatives or survivors',()=>{
  const log=scenario(),death=63000;
  for(const e of log.events){
    if([12,13].includes(e.sourceID)||[12,13].includes(e.targetID))e.timestamp+=10000;
  }
  // Passive samples before combat must not make the future siblings eligible.
  for(const targetID of [12,13])log.events.push({fight:1,type:'applybuff',positionOnly:true,timestamp:59000,targetID,
    targetResources:{hitPoints:1000,maxHitPoints:1000}});
  const target=analyzePriorityTargets(log,[group]).results.find(r=>r.key==='11:1');
  assert.equal(target.end,death);assert.equal(target.candidate,false);
  assert.equal(target.damage,0);assert.deepEqual(target.survivors,[]);
  assert.ok(target.reasons.includes('no-surviving-alternative'));
});

test('A future sibling cannot replace the last alternative killed during the focus',()=>{
  const log=scenario();
  for(const e of log.events)if(e.sourceID===13||e.targetID===13)e.timestamp+=10000;
  log.events.find(e=>e.type==='death'&&e.targetID===12).timestamp=62000;
  const target=analyzePriorityTargets(log,[group]).results.find(r=>r.key==='11:1');
  assert.equal(target.candidate,false);assert.deepEqual(target.survivors,[]);
  assert.ok(target.reasons.includes('no-surviving-alternative'));
});

test('An engaged sibling can establish an alternative without receiving party damage',()=>{
  const log=scenario();
  log.events=log.events.filter(e=>e.type!=='damage'||![12,13].includes(e.targetID));
  assert.deepEqual(candidates(analyzePriorityTargets(log,[group])).map(r=>r.key),['11:1']);
});

test('Solo damage before another pack member engages is excluded from focus evidence',()=>{
  const log=scenario();
  log.events.push({fight:1,type:'damage',timestamp:59000,sourceID:1,targetID:11,amount:1e9});
  const target=candidates(analyzePriorityTargets(log,[group]))[0];
  assert.equal(target.start,59000);assert.equal(target.damage,540);assert.equal(target.share,.9);
});

test('Low, missing or stale sibling HP cannot suppress an otherwise clear focus',()=>{
  for(const mode of ['low','missing','stale']){
    const log=scenario({duration:10000});
    for(const e of log.events.filter(e=>e.targetID!==11&&e.targetResources)){
      if(mode==='low')e.targetResources.hitPoints=50;
      else if(mode==='missing'||e.timestamp>65000)delete e.targetResources;
    }
    const result=analyzePriorityTargets(log,[group]);
    assert.deepEqual(candidates(result).map(r=>r.key),['11:1'],mode);
    assert.ok(candidates(result)[0].survivors.every(s=>mode==='low'?s.hp===.05:s.hp===null),mode);
  }
});

test('No surviving alternatives prevent automatic marking',()=>{
  const log=scenario();
  log.events.filter(e=>e.type==='death'&&e.targetID!==11).forEach(e=>e.timestamp=63500);
  const result=analyzePriorityTargets(log,[group]);
  assert.equal(candidates(result).length,0);
  assert.ok(result.results.find(r=>r.key==='11:1').reasons.includes('no-surviving-alternative'));
});

test('Focus in a late-added pack is independent of API pull boundaries',()=>{
  const log=scenario();
  // A source cast may precede the first received party damage and API segment.
  log.events.push({fight:1,type:'begincast',timestamp:59000,sourceID:11,targetID:1});
  const expected=analyzePriorityTargets(log,[group]);
  for(const boundary of [59999,61000,62000]){
    const segmented=structuredClone(log);
    segmented.fight.dungeonPulls=[{id:1,startTime:100,endTime:boundary},
      {id:2,startTime:boundary+1,endTime:segmented.fight.endTime}];
    const result=analyzePriorityTargets(segmented,[group]);
    assert.deepEqual(result,expected,`API boundary at ${boundary}`);
    assert.deepEqual(candidates(result).map(r=>r.key),['11:1']);
    assert.equal(candidates(result)[0].start,60000);
  }
});

test('The per-pack cap is a constant; independent late-added packs each get one target',()=>{
  assert.equal(MAX_PRIORITY_TARGETS_PER_PACK,1);
  const log=scenario(),other=scenario({delay:70000});
  log.fight.endTime=100000;log.fight.dungeonPulls[0].endTime=100000;
  const shift=id=>[11,12,13].includes(id)?id+10:id;
  log.actors.push(...other.actors.filter(a=>[11,12,13].includes(a.id)).map(a=>({...a,id:a.id+10})));
  log.events.push(...other.events.filter(e=>e.targetID!==99).map(e=>({...e,targetID:shift(e.targetID)})));
  const result=createPriorityTargetAnalyzer(log)([group,{id:'second',mobKeys:['21:1','22:1','23:1']}]);
  assert.deepEqual(candidates(result).map(r=>r.key),['11:1','21:1']);
  assert.ok([...Map.groupBy(candidates(result),r=>r.groupId).values()].every(rs=>rs.length<=MAX_PRIORITY_TARGETS_PER_PACK));
});

test('A later focused kill in the same pack cannot add a second priority',()=>{
  const log=scenario();
  log.events=log.events.filter(e=>e.type!=='damage'||e.targetID!==12);
  log.events.find(e=>e.type==='death'&&e.targetID===12).timestamp=68000;
  for(const t of [65000,66000,67000])for(const player of [1,2])for(const mob of [12,13]){
    log.events.push({fight:1,type:'damage',timestamp:t+player*20+mob,sourceID:player,targetID:mob,amount:mob===12?180:5,
      targetResources:{hitPoints:mob===12?200:850,maxHitPoints:1000}});
  }
  const result=analyzePriorityTargets(log,[group]);
  assert.deepEqual(candidates(result).map(r=>r.key),['11:1']);
  assert.ok(result.results.find(r=>r.key==='12:1').reasons.includes('pack-target-limit'));
});

test('Real Stormwatch G42 damage qualifies from the first hit and keeps healthy siblings',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/priority-arsonist.json',import.meta.url)));
  const result=analyzePriorityTargets(fixture.log,[fixture.group]),target=candidates(result)[0];
  assert.equal(candidates(result).length,1);assert.equal(target.key,'61:3');
  assert.ok(Math.abs(target.share-.6279647882804414)<1e-10);
  assert.ok(Math.abs(target.initial.share-.59186419101213)<1e-10);
  assert.equal(target.initial.supportingPlayers,2);assert.equal(target.sustained,1);
  assert.ok(target.survivors.every(s=>s.hp>.59));
});

test('The loader retains damage and overkill only on damage events',()=>{
  const event={fight:1,timestamp:1,type:'damage',amount:100,overkill:15,absorbed:123,mana:100};
  assert.equal(compactRouteEvent(event).amount,100);assert.equal(compactRouteEvent(event).overkill,15);
  assert.equal(compactRouteEvent(event).absorbed,undefined);
  assert.equal(compactRouteEvent({...event,type:'heal'}).amount,undefined);
});

test('A uniquely matched full route is analyzed only after matching, then projects priority to its pack',async()=>{
  const log=scenario({delay:1000}),positions=[11,12,13].map((id,i)=>({id:`mob-${id}`,placementId:`pos-${id}`,packId:'pack',
    worldPosition:{x:100+i*20,y:100},mapPosition:{x:.1+i*.02,y:.1},mapImageId:'map'}));
  const dungeon={id:'test',name:'Test',enemies:positions,mapImages:[{id:'map',name:'Start',width:100,height:100}]};
  const catalog=new Map(positions.map((p,i)=>[p.id,{id:p.id,gameId:911+i,name:p.id}]));
  log.actors=log.actors.filter(a=>a.id!==99);log.events=log.events.filter(e=>e.targetID!==99);
  for(const e of log.events)if(e.targetResources){const p=positions.find(p=>p.placementId===`pos-${e.targetID}`);e.targetResources.x=p.worldPosition.y;e.targetResources.y=p.worldPosition.x;}
  const result=await matchLiveLog(log,{dungeon,catalog,presets:{},dungeonData:'custom'});
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.priorityTargets??[]),[]);
  assert.ok(result.variants.every(v=>!Object.hasOwn(v,'priorityTargets')));
  const state=createReviewSession(result).state();
  assert.ok(state.complete);
  assert.deepEqual(detectSelectedRoutePriority(log,state),['pos-11']);
  assert.equal(result.variants.length,1);
});

test('Ambiguous priority placement does not duplicate a common pack or change route choices',async()=>{
  const log=scenario();
  log.actors=log.actors.filter(a=>a.id!==99).map(a=>a.type==='NPC'?{...a,gameID:911}:a);
  log.actors.push({id:14,type:'NPC',gameID:912});
  log.events=log.events.filter(e=>e.targetID!==99).map(e=>({...e,targetID:e.targetID===11?12:e.targetID===12?11:e.targetID}));
  for(const t of [60000,61000,62000])for(const player of [1,2])log.events.push({fight:1,type:'damage',timestamp:t+player*30,
    sourceID:player,targetID:14,amount:10,targetResources:{hitPoints:900,maxHitPoints:1000}});
  log.events.push({fight:1,type:'death',timestamp:75000,targetID:14});
  const world={11:180,12:-180,13:10,14:0};
  for(const e of log.events)if(e.targetResources){
    Object.assign(e.targetResources,{x:100,y:world[e.targetID]});
    e.sourceResources={x:100,y:0,hitPoints:100,maxHitPoints:100};
  }
  const positions=[['common-a','common','husk',0],['common-b','common','husk',100],
    ['a-husk','a','husk',200],['a-soul','a','soul',220],['b-husk','b','husk',-200],['b-soul','b','soul',-220]]
    .map(([placementId,packId,id,x])=>({placementId,packId,id,worldPosition:{x,y:100},mapPosition:{x:.5+x/1000,y:.5},mapImageId:'map'}));
  const dungeon={id:'test',name:'Test',enemies:positions,mapImages:[{id:'map',name:'Start',width:100,height:100}]};
  const catalog=new Map([['husk',{id:'husk',gameId:911,name:'Husk'}],['soul',{id:'soul',gameId:912,name:'Soul'}]]);
  const options={dungeon,catalog,presets:{},dungeonData:'custom'};
  const result=await matchLiveLog(log,options),review=createReviewSession(result);
  assert.equal(result.variants.length,2);
  assert.equal(Object.values(result.groups).filter(g=>g.enemies.includes('common-a')).length,1);
  assert.deepEqual(review.state().options.map(o=>o.label).sort(),['G2','G3']);
  assert.deepEqual(review.state().priorityTargets,[],'Unresolved spawn identity cannot mark either position');
  assert.equal(review.state().priorityAssignments,undefined,'No detection inputs until the whole route is selected');
  assert.throws(()=>detectSelectedRoutePriority(log,review.state()),/Select all route packs/);
  const legacy=structuredClone(log);legacy.events.forEach(e=>delete e.amount);
  const unmarkedResult=await matchLiveLog(legacy,options),unmarked=createReviewSession(unmarkedResult);
  assert.deepEqual(result.variants.map(v=>v.pulls),unmarkedResult.variants.map(v=>v.pulls),
    'Priority annotations cannot change matched packs, pulls or compatible routes');
  assert.deepEqual(review.state().options.map(o=>o.label),unmarked.state().options.map(o=>o.label));
  review.choose(review.state().options.find(o=>o.label==='G2').id);
  assert.ok(review.state().complete);
  const targets=detectSelectedRoutePriority(log,review.state());
  assert.equal(targets.length,1);
  assert.ok(['common-a','common-b'].includes(targets[0]));
  review.back();assert.deepEqual(review.state().priorityTargets,[]);
  review.choose(review.state().options.find(o=>o.label==='G3').id);
  assert.deepEqual(detectSelectedRoutePriority(log,review.state()),['b-husk']);
});

test('Priority waits for choices in later pulls and analyzes every selected pack in the full route',()=>{
  const log=scenario(),group={id:'focused',mobKeys:['11:1','12:1','13:1'],
    placements:{'11:1':'focused-mob','12:1':'other-a','13:1':'other-b'}};
  const review=createReviewSession({groups:{first:{enemies:['focused-mob','other-a','other-b']},a:{},b:{}},
    variants:['a','b'].map(id=>({pulls:[{groups:['first']},{groups:[id]}],priorityAssignments:[[group]]}))});
  assert.equal(review.state().pullIndex,1);
  assert.throws(()=>detectSelectedRoutePriority(log,review.state()),/Select all route packs/);
  review.choose('a');
  assert.deepEqual(detectSelectedRoutePriority(log,review.state()),['focused-mob'],
    'A choice in the last pull must retain detection inputs from the first pull');
  review.back();assert.equal(review.state().priorityAssignments,undefined);
});
