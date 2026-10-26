import test from 'node:test';
import assert from 'node:assert/strict';
import {chickenReplacements} from '../log-import/chicken-replacements.js';

const cast=(timestamp,targetInstance)=>({timestamp,targetID:2,targetInstance});
const chicken=(firstTime,instance)=>({key:`3:${instance}`,gameID:278,firstTime});
const keys=result=>Object.fromEntries([...result].map(([key,rs])=>[key,rs.map(r=>r.key).sort()]));

test('Overlapping casts retain both possible replacements regardless of sample order',()=>{
  const casts=[cast(1000,1),cast(2000,2)],rows=[chicken(2500,1),chicken(2800,2)];
  const expected={'2:1':['3:1','3:2'],'2:2':['3:1','3:2']};
  assert.deepEqual(keys(chickenReplacements(casts,rows)),expected);
  assert.deepEqual(keys(chickenReplacements(casts.toReversed(),rows.toReversed())),expected);
});

test('Pairings require a complete one-to-one assignment within ten seconds',()=>{
  const casts=[cast(1000,1),cast(2000,2)];
  assert.equal(chickenReplacements(casts,[chicken(2500,1)]).size,0);
  assert.equal(chickenReplacements(casts,[chicken(2500,1),chicken(2800,2),chicken(2900,3)]).size,0);
  assert.equal(chickenReplacements([cast(1000,1)],[chicken(11000,1)]).size,0);
  assert.equal(chickenReplacements([cast(1000,1)],[chicken(999,1)]).size,0);
  assert.deepEqual(keys(chickenReplacements(casts,[chicken(1500,1),chicken(2500,2)])),{'2:1':['3:1'],'2:2':['3:2']});
  assert.deepEqual(keys(chickenReplacements([cast(1000,1)],[chicken(8700,1)])),{'2:1':['3:1']});
});

test('An incomplete batch cannot contaminate a separate complete batch',()=>{
  assert.deepEqual(keys(chickenReplacements([cast(1000,1),cast(2000,2),cast(20000,3)],
    [chicken(2500,1),chicken(21000,2)])),{'2:3':['3:2']});
});
