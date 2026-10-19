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
