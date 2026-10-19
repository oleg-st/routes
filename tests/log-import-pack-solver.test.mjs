import test from 'node:test';
import assert from 'node:assert/strict';
import {solveCompletePacks} from '../log-import/pack-solver.js';
import {minimumAssignment,hasCompatibleAssignment,hasRequiredAssignment} from '../log-import/assignment.js';

test('Whole packs cannot contribute only their matching members', () => {
  const packs = [{id:'a',counts:{husk:2,reaver:1}},{id:'b',counts:{husk:2}}];
  assert.deepEqual(solveCompletePacks(packs,{husk:2}).solutions.map(s=>s.packIDs),[['b']]);
  assert.equal(solveCompletePacks(packs,{husk:2},{requiredIDs:['a']}).solutions.length,0);
});
test('Transformation consumes exactly one original member of a complete pack', () => {
  const result=solveCompletePacks([{id:'a',counts:{husk:2,sentinel:1}}],{husk:2},{wildcards:1});
  assert.deepEqual(result.solutions,[{packIDs:['a'],wildcardTypes:{sentinel:1}}]);
  assert.equal(result.exhaustive,true);
});
test('Enumeration limits do not mislabel a truncated candidate set as exhaustive', () => {
  const packs=[{id:'a',counts:{husk:1}},{id:'b',counts:{husk:1}}];
  assert.equal(solveCompletePacks(packs,{husk:1},{maxSolutions:1}).exhaustive,false);
  assert.equal(solveCompletePacks(packs,{husk:1},{maxSolutions:2}).exhaustive,true);
  assert.equal(solveCompletePacks(packs,{husk:1},{maxNodes:1}).exhaustive,false);
});

test('Optional death-skip observations do not relax whole packs needed by retained observations',()=>{
  const packs=[{id:'ordinary',counts:{kill:1,untouched:2}},{id:'complete',counts:{kill:1}},{id:'skipped',counts:{survivor:4}}];
  const options={optionalTarget:{survivor:1}};
  assert.deepEqual(solveCompletePacks(packs,{kill:1},options).solutions.map(s=>s.packIDs),[['complete']]);
  assert.deepEqual(solveCompletePacks(packs,{kill:1},{...options,requiredIDs:['ordinary']}).solutions,[]);
});

test('Optional observations can fill whole packs, with joint assignment checked at every complete selection',()=>{
  const packs=[{id:'a',counts:{mob:1}},{id:'b',counts:{mob:1}},{id:'c',counts:{mob:1}}];
  const all=solveCompletePacks(packs,{mob:1},{optionalTarget:{mob:1}});
  assert.equal(all.exhaustive,true);assert.equal(all.solutions.length,6);
  assert.equal(new Set(all.solutions.map(s=>s.packIDs.join('|'))).size,6,'exclude branches must not duplicate an earlier selection');
  const checked=solveCompletePacks(packs,{mob:1},{optionalTarget:{mob:1},canComplete:ids=>ids.includes('b')});
  assert.deepEqual(checked.solutions,all.solutions.filter(s=>s.packIDs.includes('b')));
});

test('Pruning unavailable future packs preserves every optional-observation solution',()=>{
  const packs=[{id:'a',counts:{mob:1}},{id:'b',counts:{mob:1}},{id:'c',counts:{mob:1}}];
  const expected=solveCompletePacks(packs,{mob:1},{optionalTarget:{mob:1}}).solutions.filter(s=>s.packIDs.includes('b'));
  const result=solveCompletePacks(packs,{mob:1},{optionalTarget:{mob:1},canComplete:ids=>ids.includes('b'),
    canContinue:(ids,remaining)=>[...ids,...remaining].includes('b')});
  assert.equal(result.exhaustive,true);assert.deepEqual(result.solutions,expected);
});

test('Required-column matching agrees with exhaustive assignments on small graphs',()=>{
  for(let seed=0;seed<50;seed++){
    const choices=Array.from({length:3},(_,i)=>Array.from({length:5},(_,j)=>j).filter(j=>(seed*7+i*3+j*5)%11<7));
    const required=Array.from({length:5},(_,j)=>j).filter(j=>(seed+j)%3===0);
    function brute(i=0,used=new Set()){
      if(i===choices.length)return required.every(j=>used.has(j));
      for(const j of choices[i])if(!used.has(j)){
        used.add(j);if(brute(i+1,used))return true;used.delete(j);
      }
      return false;
    }
    assert.equal(hasRequiredAssignment(choices,required),brute(),`seed ${seed}`);
  }
});
test('Joint assignment avoids stealing another observation\'s only nearby placement', () => {
  assert.deepEqual(minimumAssignment([[1,2],[1,100]]),{cost:3,columns:[1,0]});
  assert.deepEqual(minimumAssignment([[5,1,9],[1,5,8]]),{cost:2,columns:[1,0]});
  assert.deepEqual(minimumAssignment([]),{cost:0,columns:[]});
  assert.throws(()=>minimumAssignment([[Infinity]]));
});
test('Assignment agrees with independent exhaustive permutations on small matrices', () => {
  function brute(rows,used=new Set(),i=0){
    if(i===rows.length)return 0;
    let best=Infinity;
    for(let j=0;j<rows[i].length;j++)if(!used.has(j)){
      used.add(j);best=Math.min(best,rows[i][j]+brute(rows,used,i+1));used.delete(j);
    }
    return best;
  }
  for(let seed=1;seed<=30;seed++){
    const rows=Array.from({length:4},(_,i)=>Array.from({length:5},(_,j)=>(seed*(i+7)*(j+3)+i*i+j*j)%23));
    const result=minimumAssignment(rows);
    assert.equal(result.cost,brute(rows));assert.equal(new Set(result.columns).size,rows.length);
  }
});

test('Compatibility pruning reassigns shared observations and limits missing members across types',()=>{
 assert.equal(hasCompatibleAssignment([['a','b'],['a']]),true);
 assert.equal(hasCompatibleAssignment([['a'],['a']]),false);
 assert.equal(hasCompatibleAssignment([['a'],['a']],1),true);
 assert.equal(hasCompatibleAssignment([['a'],['a'],[],['b']],1),false);
 // Compare augmenting paths against the independent minimum-cost solver.
 for(let seed=1;seed<=40;seed++)for(const missing of [0,1,2]){
   const choices=Array.from({length:6},(_,i)=>Array.from({length:5},(_,j)=>j).filter(j=>(seed*(i+3)*(j+7)+i+j)%7<3));
   const cost=minimumAssignment(choices.map(cs=>[...Array.from({length:5},(_,j)=>cs.includes(j)?0:10),...Array(6).fill(1)])).cost;
   assert.equal(hasCompatibleAssignment(choices,missing),cost<=missing);
 }
});

test('Pack pruning preserves exhaustive valid solutions without spending the limit on impossible assignments',()=>{
 const packs=Array.from({length:12},(_,i)=>({id:String(i),counts:{mob:1}}));
 const choices=new Map(packs.map((p,i)=>[p.id,[i<6?'shared':p.id]]));
 const canSelect=ids=>hasCompatibleAssignment(ids.map(id=>choices.get(id)));
 const brute=solveCompletePacks(packs,{mob:6});
 const valid=brute.solutions.filter(s=>canSelect(s.packIDs));
 assert.ok(valid.length<brute.solutions.length);
 const pruned=solveCompletePacks(packs,{mob:6},{canSelect,maxSolutions:valid.length});
 assert.equal(pruned.exhaustive,true);assert.deepEqual(pruned.solutions,valid);
 assert.equal(solveCompletePacks(packs,{mob:6},{maxSolutions:valid.length}).exhaustive,false);
 assert.deepEqual(solveCompletePacks(packs,{mob:6},{canSelect,requiredIDs:['0','1']}).solutions,[]);
 assert.equal(solveCompletePacks(packs,{mob:6},{canSelect,maxNodes:1}).exhaustive,false);
});
