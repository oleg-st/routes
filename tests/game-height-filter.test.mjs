import test from 'node:test';
import assert from 'node:assert/strict';
import {filterLowHeightOutliers} from '../scripts/game-height-filter.mjs';
const mob=(id,z)=>({id,worldPosition:{x:0,y:0,z}});
const main=(n,min,span)=>Array.from({length:n},(_,i)=>mob('main-'+i,min+span*i/(n-1)));

test('A strongly isolated low mob is removed independent of its identity and absolute datum',()=>{
  const input=[mob('any-id',-23164.309),...main(178,1711.1033,3050.3857)];
  const result=filterLowHeightOutliers(input);
  assert.deepEqual(result.excluded.map(m=>m.id),['any-id']);
  assert.equal(result.active.length,178);
  assert.ok(Math.abs(result.evidence.gap-24875.4123)<1e-6);
  assert.equal(input.length,179);
  const shifted=input.map(m=>({...m,worldPosition:{...m.worldPosition,z:m.worldPosition.z+50000}})).reverse();
  assert.deepEqual(filterLowHeightOutliers(shifted).excluded.map(m=>m.id),['any-id']);
});
test('Ordinary negative heights, isolated lower bosses and populated lower floors survive',()=>{
  assert.equal(filterLowHeightOutliers([mob('regath-boss',-8682.45),...main(210,-110.25788,3469.42318)]).excluded.length,0);
  assert.equal(filterLowHeightOutliers([mob('vexira',-10595.042),...main(161,-5886.2534,10886.2534)]).excluded.length,0);
  assert.equal(filterLowHeightOutliers(main(200,-30000,6000)).excluded.length,0);
  assert.equal(filterLowHeightOutliers([...main(10,-25000,100),...main(190,0,1000)]).excluded.length,0);
});
test('Small lower clusters require a large relative gap and sufficient main population',()=>{
  assert.equal(filterLowHeightOutliers([mob('low-a',-25000),mob('low-b',-24900),...main(298,0,3000)]).excluded.length,2);
  assert.equal(filterLowHeightOutliers([mob('lower-floor',-15000),...main(199,0,10000)]).excluded.length,0);
  assert.equal(filterLowHeightOutliers([mob('low',-30000),...main(19,0,100)]).excluded.length,0);
  assert.equal(filterLowHeightOutliers([]).excluded.length,0);
  assert.throws(()=>filterLowHeightOutliers([mob('missing',NaN)]),/finite world Z/);
});
