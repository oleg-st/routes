import test from 'node:test';
import assert from 'node:assert/strict';
import {modifierEvidence,createEmpoweredConstraint} from '../log-import/modifier-evidence.js';
import {placementScore} from '../route-model.js';
const actors=[{id:1,type:'NPC',gameID:175},{id:2,type:'Player'},{id:3,type:'NPC',gameID:274}];
const buff={fight:5,type:'applybuff',sourceID:1,sourceInstance:3,targetID:2,abilityGameID:1000044,timestamp:100};
test('Victory Rush confirms the source mob only with the affix and correct event direction',()=>{
  const result=modifierEvidence({id:5,modifiers:[12]},actors,[buff,buff,{...buff,type:'removebuff'}]);
  assert.deepEqual(result.empowered.confirmedInstances,[{key:'1:3',gameID:175,eventTimes:[100],targetPlayers:[2]}]);
  assert.equal(modifierEvidence({id:5,modifiers:[]},actors,[buff]).empowered.confirmedInstances.length,0);
  assert.equal(modifierEvidence({id:5,modifiers:[12]},actors,[{...buff,sourceID:2,targetID:1}]).empowered.confirmedInstances.length,0);
});
test('Missing death effect or instance identity does not manufacture normal/empowered classification',()=>{
  const result=modifierEvidence({id:5,modifiers:[12]},actors,[{...buff,sourceInstance:undefined}]);
  assert.equal(result.empowered.active,true);assert.deepEqual(result.empowered.confirmedInstances,[]);
  assert.equal(result.ghorn.active,null);assert.equal(result.witch.active,null);
});
test('NPC evidence is scoped to the selected fight',()=>{
  assert.equal(modifierEvidence({id:5,modifiers:[]},actors,[{fight:6,sourceID:3}]).shadowlord.active,null);
  assert.equal(modifierEvidence({id:5,modifiers:[]},actors,[{fight:5,sourceID:3}]).shadowlord.active,true);
});
test('An empowered enemy transformed into Chicken contributes zero in the existing route model',()=>{
  const pos={placementId:'target'},enemy={isBoss:false,dungeonScore:3};
  const route={excluded:['target'],shadow:false,modifiers:{empowered:{active:true,enemies:['target']}}};
  assert.equal(placementScore(pos,enemy,route,null),0);
  route.excluded=[];assert.equal(placementScore(pos,enemy,route,null),9);
});

test('Fixed empowered placements constrain confirmed or health-classified actors, never unknown actors',()=>{
  const options={active:true,confirmedInstances:[{key:'confirmed'}],empoweredPlacements:['emp'],healthEvidence:[{key:'normal',empoweredCandidate:false},{key:'high-hp',empoweredCandidate:true}]};
  const compatible=createEmpoweredConstraint(options);
  assert.equal(compatible('confirmed','normal-spawn'),false);
  assert.equal(compatible('confirmed','emp'),true);
  assert.equal(compatible('high-hp','normal-spawn'),false);
  assert.equal(compatible('normal','emp'),false);
  assert.equal(compatible('unknown','emp'),true);
  assert.equal(compatible('unknown','normal-spawn'),true);
  assert.equal(createEmpoweredConstraint({...options,active:false})('normal','emp'),true);
});
