import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveIdentity,actorGuids,projectGamePoint} from '../scripts/game-source-identity.mjs';
import {requiresPlayerContact} from '../log-import/activation.js';
import {correctImportPacks} from '../log-import/pack-corrections.js';
test('Moved game actors retain route identities when export indexes change',()=>{
  const guid='12345678-12345678-12345678-12345678',registry={[guid]:{placementId:'legacy-route-id'}};
  const raw=index=>[{Package:'/Game/new-map',Objects:[{Index:index,Object:{ActorInstanceGuid:{ActorGuid:guid}}}]}];
  assert.equal(resolveIdentity(registry,actorGuids(raw(1)).get('/Game/new-map.1')).placementId,'legacy-route-id');
  assert.equal(resolveIdentity(registry,actorGuids(raw(99)).get('/Game/new-map.99')).placementId,'legacy-route-id');
  const frame={calibration:{sx:100,sy:-100,ox:0,oy:0}};
  assert.deepEqual(projectGamePoint({x:100,y:200,z:0},frame),{x:2,y:-1});
  assert.deepEqual(projectGamePoint({x:300,y:400,z:100},frame),{x:4,y:-3});
  assert.throws(()=>projectGamePoint({x:1,y:2},{}),/calibration/);
  assert.throws(()=>resolveIdentity(registry,null),/GUID/);
});
test('New actor GUIDs get new stable IDs rather than borrowing a nearby retired actor',()=>{
  const registry={old:{placementId:'old-route-id'}};
  const a=resolveIdentity(registry,'abcd-1234');
  assert.equal(a.placementId,'placement-game-abcd-1234');
  assert.equal(resolveIdentity(registry,'abcd-1234'),a);
  assert.equal(registry.old.placementId,'old-route-id');
});
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
