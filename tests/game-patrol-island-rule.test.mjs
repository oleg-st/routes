import test from 'node:test';
import assert from 'node:assert/strict';
import {foreignRuns,auditPatrolIslands,applyIslandCandidates} from '../scripts/game-patrol-island-rule.mjs';

function fixture(){
  const path=Array.from({length:8},(_,x)=>({x:x*100,y:0,z:x>=2&&x<=3?-1000:0}));
  const patrol={actorKey:'p',actorName:'example',resolvedSettings:{Looped:false,TargetMovementSpeed:600},columns:[
    {column:0,slots:[{actorKey:'a'}],path,baseDistanceBetweenPoints:100},
    {column:1,slots:[{actorKey:'b'}],path:path.map(p=>({...p,y:100,z:0})),baseDistanceBetweenPoints:100}]};
  const nav={components:[{unmatchedPortals:0,offMeshUncertainty:false},{unmatchedPortals:0,offMeshUncertainty:false}],
    query(p,options={}){return {point:[p.x,p.y,options.component===0?0:p.z],component:options.component??(p.z<-500?1:0),horizontalDistance:0};}};
  return {data:{patrols:[patrol]},nav};
}
test('bounded island excursion is repaired only in the cloned hypothesis',()=>{
  const {data,nav}=fixture(),saved=JSON.stringify(data),audit=auditPatrolIslands(data,nav);
  assert.equal(audit.candidates.length,1);assert.deepEqual(audit.candidates[0].indices,[2,3]);
  assert.equal(audit.candidates[0].durationAtTargetSpeed,0.5);
  assert.equal(applyIslandCandidates(data,audit.candidates,0.49).editedPoints,0);
  const corrected=applyIslandCandidates(data,audit.candidates,0.5);
  assert.equal(corrected.editedPoints,2);assert.equal(corrected.data.patrols[0].columns[0].path[2].z,0);
  assert.equal(JSON.stringify(data),saved);
});
test('loop seam is handled, open endpoints and unknown samples are not bridged',()=>{
  assert.ok(foreignRuns([1,0,0,0,1],true).some(r=>JSON.stringify(r.indices)==='[4,0]'));
  assert.equal(foreignRuns([1,1,0,0],false).length,0);
  assert.equal(foreignRuns([0,1,null,0],false).length,0);
});
test('real connected slope and horizontal excursion do not satisfy the rule',()=>{
  const {data,nav}=fixture();nav.query=(p)=>({point:[p.x,p.y,p.z],component:0,horizontalDistance:0});
  assert.equal(auditPatrolIslands(data,nav).candidates.length,0);
  const f=fixture();for(const p of f.data.patrols[0].columns[0].path)if(p.z<0)p.z=-50;
  f.nav.query=(p,o={})=>({point:[p.x,p.y,o.component===0?0:p.z],component:o.component??(p.z<0?1:0),horizontalDistance:0});
  const a=auditPatrolIslands(f.data,f.nav);assert.ok(a.candidates[0].reasons.includes('no-large-vertical-excursion'));
});
test('uncertain connectivity and missing companion column veto the repair',()=>{
  for(const flag of ['unmatchedPortals','offMeshUncertainty']){
    const {data,nav}=fixture();nav.components[1][flag]=true;
    assert.equal(applyIslandCandidates(data,auditPatrolIslands(data,nav).candidates,2).editedPoints,0);
  }
  const {data,nav}=fixture();data.patrols[0].columns.pop();
  assert.equal(applyIslandCandidates(data,auditPatrolIslands(data,nav).candidates,2).editedPoints,0);
});
test('missing nearby projection keeps original targets',()=>{
  const {data,nav}=fixture(),query=nav.query;nav.query=(p,o={})=>o.component===0?null:query(p,o);
  const audit=auditPatrolIslands(data,nav);assert.ok(audit.candidates[0].reasons.includes('no-nearby-home-surface-projection'));
  assert.equal(applyIslandCandidates(data,audit.candidates,2).editedPoints,0);
});
