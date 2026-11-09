import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresPlayerContact} from '../log-import/activation.js';
import {correctImportPacks} from '../log-import/pack-corrections.js';
test('An unburrow animation does not impose Dormant activation or split a game pack during log import',()=>{
  const animation={id:'lasher',placementId:'a',packId:'pack',gameGuid:'a',burried:true};
  const awake={...animation,placementId:'b',gameGuid:'b',burried:false};
  const packs=[{id:'pack',placements:[animation,awake]}],catalog=new Map([['lasher',{gameId:1}]]);
  assert.equal(requiresPlayerContact(animation),false);
  assert.equal(requiresPlayerContact({...animation,dormant:true}),true);
  assert.equal(requiresPlayerContact({burried:true}),true,'Legacy flag behavior is preserved');
  assert.equal(correctImportPacks(packs,{dungeonData:'custom',catalog}),packs);
  const dormant=correctImportPacks([{...packs[0],placements:[{...animation,dormant:true},awake]}],{dungeonData:'custom',catalog});
  assert.equal(dormant.length,2);
});
