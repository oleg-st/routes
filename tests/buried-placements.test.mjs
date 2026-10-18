import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {correctDungeon,placementName} from '../data/placement-corrections.js';
import {newRoute,encodeRoute,decodeRoute,scoreRoute} from '../route-model.js';
const urrakControls=JSON.parse(fs.readFileSync('tests/fixtures/urrak-pack-controls.json'));
const raw=JSON.parse(fs.readFileSync('data/dungeons.json'));
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const dungeons=raw.map(correctDungeon);
const dormantDungeons=raw.filter(d=>d.enemies.some(p=>p.dormant));

test('Game Dormant placements stay independent and preserve spawn identity',()=>{
  for(const d of dormantDungeons){
    const id=d.id,ids=d.enemies.filter(p=>p.dormant).map(p=>p.placementId);
    const before=raw.find(d=>d.id===id),after=dungeons.find(d=>d.id===id);
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(after.enemies.length,before.enemies.length);
    assert.deepEqual(after.enemies.map(p=>p.placementId),before.enemies.map(p=>p.placementId));
    for(const pid of ids){
      const original=before.enemies.find(p=>p.placementId===pid),p=after.enemies.find(p=>p.placementId===pid);
      assert.equal(original?.dormant,true);
      assert.equal(p.burried,true);
      assert.equal(after.enemies.filter(q=>q.packId===p.packId).length,1);
      assert.deepEqual(p.worldPosition,original.worldPosition);
      assert.equal(placementName(p,enemies.get(p.id)),enemies.get(p.id).name+' (burried)');
    }
    for(const p of after.enemies){const original=before.enemies.find(q=>q.placementId===p.placementId);assert.equal(p.id,original.id);assert.deepEqual(p.worldPosition,original.worldPosition);}
    assert.deepEqual(correctDungeon(after),after,'Correction is idempotent');
    assert.ok(before.enemies.every(p=>!p.buried),'Raw catalog was not mutated');
  }
});

test('Original Urrak G48 selects as two Mancatchers and three independent flowers',()=>{
  const before=raw.find(d=>d.id==='Level.ID.UrrakMarkets'),after=correctDungeon(before);
  const ids=new Set(urrakControls.slice(2).flat()),members=after.enemies.filter(p=>ids.has(p.placementId));
  const packs=[...Map.groupBy(members,p=>p.packId).values()];
  assert.deepEqual(packs.map(ps=>ps.length).sort(),[1,1,1,2]);
  assert.ok(packs.find(ps=>ps.length===2).every(p=>enemies.get(p.id).name==='Mancatcher'));
});

test('Both data variants round-trip without changing members or score',async()=>{
  for(const {id} of dormantDungeons){
    const before=raw.find(d=>d.id===id),after=correctDungeon(before),r=newRoute(before,'25647984');
    r.pulls[0].enemies=before.enemies.filter(p=>p.id==='dr-slaughtervine').map(p=>p.placementId);
    const score=scoreRoute(r,before,enemies,null);
    assert.deepEqual((await decodeRoute(await encodeRoute(r,before),dungeons,enemies)).pulls[0].enemies,r.pulls[0].enemies);
    const restored=await decodeRoute(await encodeRoute(r,after),dungeons,enemies);
    assert.deepEqual(restored.pulls[0].enemies,r.pulls[0].enemies);
    assert.deepEqual(scoreRoute(restored,after,enemies,null),score);
  }
});
