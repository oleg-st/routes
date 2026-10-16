import test from 'node:test';
import assert from 'node:assert/strict';
import {solveCompletePacks} from '../log-import/pack-solver.js';
import {minimumAssignment} from '../log-import/assignment.js';

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
