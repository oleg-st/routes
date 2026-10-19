import test from 'node:test';
import assert from 'node:assert/strict';
import {assignDeathSkipPacks} from '../log-import/death-skip-assignment.js';

test('Death-skip assignment covers whole packs even when a nearer outside position exists',()=>{
  const placements=['a','b','c'].map(placementId=>({placementId}));
  const rows=[{key:'kill',firstTime:1},{key:'skip',firstTime:2}],skippedKeys=new Set(['skip']);
  const pair=new Map([['kill|a',{allowed:true,distance:1}],['skip|b',{allowed:true,distance:10000}],['skip|c',{allowed:true,distance:0}]]);
  const result=assignDeathSkipPacks({rows,placements,selected:placements.slice(0,2),skippedKeys,pair,missingBudget:0});
  assert.deepEqual(result.assignments.map(a=>[a.key,a.placementId]),[['kill','a'],['skip','b']]);
  assert.equal(assignDeathSkipPacks({rows,placements,selected:[placements[1]],skippedKeys,pair,missingBudget:0}),null,'retained kills cannot occupy an unselected pack');
});

test('Death-skip assignment agrees with exhaustive distinct assignments and required-column coverage',()=>{
  const placements=Array.from({length:5},(_,i)=>({placementId:String(i)}));
  const rows=Array.from({length:3},(_,i)=>({key:String(i),firstTime:i})),skippedKeys=new Set(['1','2']);
  for(let seed=0;seed<30;seed++)for(const missingBudget of [0,1]){
    const selected=placements.filter((_,j)=>(seed+j)%3===0),required=new Set(selected.map(p=>p.placementId)),pair=new Map();
    for(const r of rows)for(const p of placements)pair.set(`${r.key}|${p.placementId}`,{allowed:(seed*7+Number(r.key)*3+Number(p.placementId)*5)%11<7,distance:(seed+Number(r.key)*7+Number(p.placementId)*3)%13});
    const allowed=(i,p)=>i===rows.length?required.has(p.placementId):pair.get(`${rows[i].key}|${p.placementId}`).allowed&&(skippedKeys.has(rows[i].key)||required.has(p.placementId));
    function brute(i=0,used=new Set()){
      if(i===rows.length+missingBudget)return [...required].every(id=>used.has(id));
      for(const p of placements)if(!used.has(p.placementId)&&allowed(i,p)){
        used.add(p.placementId);if(brute(i+1,used))return true;used.delete(p.placementId);
      }
      return false;
    }
    const result=assignDeathSkipPacks({rows,placements,selected,skippedKeys,pair,missingBudget});
    assert.equal(Boolean(result),brute(),`seed ${seed}, missing ${missingBudget}`);
    if(result){assert.equal(new Set(result.assignments.map(a=>a.placementId)).size,rows.length);for(const [i,a]of result.assignments.entries())assert.ok(allowed(i,placements.find(p=>p.placementId===a.placementId)));}
  }
});

test('Missing-sibling allowance is shared across NPC types and cached assignments',()=>{
  const catalog=new Map([['a',{gameId:1}],['b',{gameId:2}]]);
  const placements=['a1','a2','b1','b2'].map(placementId=>({placementId,id:placementId[0]}));
  const rows=[{key:'kill-a',gameID:1,firstTime:1},{key:'kill-b',gameID:2,firstTime:2}],pair=new Map();
  for(const r of rows)for(const p of placements)pair.set(`${r.key}|${p.placementId}`,{allowed:r.gameID===catalog.get(p.id).gameId,distance:0});
  const options={rows,placements,catalog,skippedKeys:new Set(),pair,missingBudget:1};
  assert.equal(assignDeathSkipPacks({...options,selected:placements}),null,'one allowance cannot fill two different NPC types');
  assert.ok(assignDeathSkipPacks({...options,selected:placements.slice(0,3)}));
});

test('A survivor cannot fill a killed pack from a different engagement',()=>{
  const rows=[{key:'kill',gameID:1},{key:'skip',gameID:1}],placements=[
    {placementId:'a',packId:'kept'},{placementId:'b',packId:'kept'},{placementId:'c',packId:'diversion'}];
  const pair=new Map([['kill|a',{allowed:true,distance:0}],['skip|b',{allowed:true,distance:0}],['skip|c',{allowed:true,distance:100}]]);
  const options={rows,placements,pair,skippedKeys:new Set(['skip']),missingBudget:0,
    catalog:new Map([[undefined,{gameId:1}]]),engagementByKey:new Map([['kill',0],['skip',1]])};
  assert.equal(assignDeathSkipPacks({...options,selected:placements.slice(0,2)}),null);
  options.engagementByKey.set('skip',0);
  assert.ok(assignDeathSkipPacks({...options,selected:placements.slice(0,2)}),'same-engagement partial kills remain representable');
});

test('Cross-type death-skip conflicts try another joint assignment instead of dropping a valid route',()=>{
  const rows=[{key:'skip-a',gameID:1},{key:'kill-b-early',gameID:2},{key:'kill-b-late',gameID:2}];
  const placements=[{id:'a',placementId:'pa',packId:'p'},{id:'b',placementId:'pb',packId:'p'},{id:'b',placementId:'qb',packId:'q'}];
  const catalog=new Map([['a',{gameId:1}],['b',{gameId:2}]]),pair=new Map([
    ['skip-a|pa',{allowed:true,distance:0}],
    ['kill-b-early|pb',{allowed:true,distance:0}],['kill-b-early|qb',{allowed:true,distance:10}],
    ['kill-b-late|pb',{allowed:true,distance:10}],['kill-b-late|qb',{allowed:true,distance:0}],
  ]);
  const result=assignDeathSkipPacks({rows,placements,selected:placements,catalog,pair,skippedKeys:new Set(['skip-a']),missingBudget:0,
    engagementByKey:new Map([['skip-a',1],['kill-b-early',0],['kill-b-late',1]])});
  assert.deepEqual(result.assignments.map(a=>[a.key,a.placementId]),[['skip-a','pa'],['kill-b-early','qb'],['kill-b-late','pb']]);
  assert.equal(result.cost,20);
});

test('Engagement-constrained assignments agree with exhaustive search across types and missing members',()=>{
  const catalog=new Map([['a',{gameId:1}],['b',{gameId:2}]]);
  const placements=Array.from({length:6},(_,i)=>({placementId:String(i),id:i%2?'b':'a',packId:String(Math.floor(i/2))}));
  const rows=[{key:'ka',gameID:1},{key:'kb',gameID:2},{key:'sa',gameID:1},{key:'sb',gameID:2}];
  const skippedKeys=new Set(['sa','sb']),engagementByKey=new Map([['ka',0],['kb',1],['sa',1],['sb',0]]);
  for(let seed=0;seed<40;seed++)for(const missingBudget of [0,1]){
    const selected=placements.filter(p=>(seed+Number(p.packId))%3!==0),required=new Set(selected.map(p=>p.placementId)),pair=new Map();
    rows.forEach((r,i)=>placements.forEach((p,j)=>pair.set(`${r.key}|${p.placementId}`,{
      allowed:r.gameID===catalog.get(p.id).gameId&&(seed*7+i*3+j*5)%11<8,distance:(seed+i*7+j*3)%13,
    })));
    let best=Infinity;
    function brute(i=0,chosen=[],cost=0){
      if(i===rows.length+missingBudget){
        if(selected.some(p=>!chosen.includes(p)))return;
        const groups=Map.groupBy(chosen.slice(0,rows.length).map((p,j)=>({p,r:rows[j]})).filter(a=>required.has(a.p.placementId)),a=>a.p.packId);
        if([...new Set(selected.map(p=>p.packId))].some(pack=>!groups.get(pack)?.some(a=>!skippedKeys.has(a.r.key))))return;
        if([...groups.values()].some(as=>as.some(a=>skippedKeys.has(a.r.key))&&new Set(as.map(a=>engagementByKey.get(a.r.key))).size>1))return;
        best=Math.min(best,cost);return;
      }
      for(const p of placements){
        if(chosen.includes(p))continue;
        if(i===rows.length){if(required.has(p.placementId))brute(i+1,[...chosen,p],cost);continue;}
        const r=rows[i],e=pair.get(`${r.key}|${p.placementId}`);
        if(e.allowed&&(skippedKeys.has(r.key)||required.has(p.placementId)))brute(i+1,[...chosen,p],cost+e.distance);
      }
    }
    brute();
    const result=assignDeathSkipPacks({rows,placements,selected,catalog,pair,skippedKeys,missingBudget,engagementByKey});
    assert.equal(result?.cost??Infinity,best,`seed ${seed}, missing ${missingBudget}`);
  }
});
