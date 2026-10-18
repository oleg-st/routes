import test from 'node:test';
import assert from 'node:assert/strict';
import {formationMotionBounds,gameSocialInput} from '../scripts/game-patrol-model.mjs';
import {inferGeometricPacks} from '../scripts/geometric-pack-model.mjs';
function fixture(spacing=425){
  const paths=[0,120,240].map(y=>[{x:0,y,z:0},{x:10000,y,z:0},{x:10000,y:10000+y,z:0}]);
  const patrol={actorKey:'patrol',resolvedSettings:{Formation:'ECRFollowPathFormationType::Column',SpaceEquallyAlongPath:false,Spacing:spacing,Looped:false},columns:paths.map(path=>({path}))};
  const mob=(id,column,row,x)=>({id,position:{x,y:column*120,z:96},path:paths[column],heightOffset:96,patrol,membership:{column,row},radius:1000});
  return {patrol,mob};
}
test('explicit synchronized columns retain a compact formation on a long turning path',()=>{
  const {mob}=fixture(),a=mob('a',0,0,500),b=mob('b',1,1,75);
  assert.ok(formationMotionBounds(a,b).maxDistance<1000);
  assert.equal(inferGeometricPacks([a,b],{synchronizeSharedPaths:false,heightAdjustedPaths:true,synchronizedMotionBounds:formationMotionBounds,verticalLimit:600}).groups.length,1);
});
test('row spacing can separate currently close patrol members without source pack labels',()=>{
  const {mob}=fixture(1500),a=mob('a',0,0,500),b=mob('b',0,1,75);
  assert.equal(formationMotionBounds(a,b).maxDistance,1500);
  assert.equal(inferGeometricPacks([a,b],{synchronizeSharedPaths:false,synchronizedMotionBounds:formationMotionBounds,verticalLimit:600}).groups.length,2);
  assert.equal(formationMotionBounds(a,{...b,patrol:{...b.patrol}}),null);
});
test('game adapter isolates an explicit no-receive state, not blindness or an unburrow animation',()=>{
  const m=(id,receives)=>({actorKey:id,worldPosition:{x:0,y:0,z:0},patrolMemberships:[],socialAggro:{distance:1000,verticalDistance:600,propagateThreat:true,receivesPropagationInitially:receives},behavior:{noPlayerDetectionConfigured:true,unburrowAnimationIndicators:['animation']}});
  const input=gameSocialInput({mobs:[m('dormant',false),m('blind',null)],patrols:[]},['dormant','blind']);
  assert.equal(input[0].inactive,true);assert.equal(input[1].inactive,false);
});
test('a loop uses serialized sample progress and checks separation across the closing segment',()=>{
  const path=[{x:0,y:0,z:0},{x:10000,y:0,z:0},{x:10000,y:10000,z:0},{x:0,y:10000,z:0}];
  const patrol={actorKey:'loop',resolvedSettings:{Formation:'ECRFollowPathFormationType::Column',SpaceEquallyAlongPath:false,Spacing:1500,Looped:true},columns:[{path,baseDistanceBetweenPoints:10000}]};
  const a={id:'a',position:{x:0,y:0,z:96},path,heightOffset:96,patrol,membership:{column:0,row:0},radius:1000};
  const b={...a,id:'b',position:{x:0,y:500,z:96},membership:{column:0,row:1}};
  const result=formationMotionBounds(a,b);
  assert.equal(result.maxDistance,1500);assert.equal(result.sampleDistance,10000);
  assert.equal(result.maxVertical,0);
});
