import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buriedPlacements} from '../data/buried-placements.js';
import {correctDungeon,placementName} from '../data/placement-corrections.js';
import {newRoute,encodeRoute,decodeRoute,scoreRoute} from '../route-model.js';
const raw=JSON.parse(fs.readFileSync('data/dungeons.json'));
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const dungeons=raw.map(correctDungeon);

test('Buried placement corrections are unique, scoped to flowers, and preserve spawn identity',()=>{
  for(const [id,ids] of Object.entries(buriedPlacements)){
    const before=raw.find(d=>d.id===id),after=dungeons.find(d=>d.id===id);
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(ids.length,id==='Level.ID.UrrakMarkets'?25:82);
    assert.equal(after.enemies.length,before.enemies.length);
    assert.deepEqual(after.enemies.map(p=>p.placementId),before.enemies.map(p=>p.placementId));
    for(const pid of ids){
      const original=before.enemies.find(p=>p.placementId===pid),p=after.enemies.find(p=>p.placementId===pid);
      assert.equal(original?.id,'dr-slaughtervine');
      assert.equal(p.burried,true);
      assert.equal(after.enemies.filter(q=>q.packId===p.packId).length,1);
      assert.deepEqual(p.worldPosition,original.worldPosition);
      assert.equal(placementName(p,enemies.get(p.id)),'Slaughtervine (burried)');
    }
    for(const p of after.enemies){const {packId,originalPackId,burried,...rest}=p;const {packId:oldPack,...original}=before.enemies.find(q=>q.placementId===p.placementId);assert.deepEqual(rest,original);}
    assert.deepEqual(correctDungeon(after),after,'Correction is idempotent');
    assert.ok(before.enemies.every(p=>!p.buried),'Raw catalog was not mutated');
  }
});

test('Original Urrak G48 selects as two Mancatchers and three independent flowers',()=>{
  const before=raw.find(d=>d.id==='Level.ID.UrrakMarkets'),after=correctDungeon(before);
  const group=[...Map.groupBy(before.enemies,p=>p.packId)][47][1];
  const ids=new Set(group.map(p=>p.placementId)),members=after.enemies.filter(p=>ids.has(p.placementId));
  const packs=[...Map.groupBy(members,p=>p.packId).values()];
  assert.deepEqual(packs.map(ps=>ps.length).sort(),[1,1,1,2]);
  assert.ok(packs.find(ps=>ps.length===2).every(p=>enemies.get(p.id).name==='Mancatcher'));
  const mixed=[...Map.groupBy(before.enemies,p=>p.packId)][34][1];
  assert.equal(after.enemies.filter(p=>mixed.some(q=>q.placementId===p.placementId)&&p.burried).length,1,'Only one of the original G35 flowers is buried');
});

test('Both data variants round-trip without changing members or score',async()=>{
  for(const id of Object.keys(buriedPlacements)){
    const before=raw.find(d=>d.id===id),after=correctDungeon(before),r=newRoute(before,'25647984');
    r.pulls[0].enemies=before.enemies.filter(p=>p.id==='dr-slaughtervine').map(p=>p.placementId);
    const score=scoreRoute(r,before,enemies,null);
    assert.deepEqual((await decodeRoute(await encodeRoute(r,before),dungeons,enemies)).pulls[0].enemies,r.pulls[0].enemies);
    const restored=await decodeRoute(await encodeRoute(r,after),dungeons,enemies);
    assert.deepEqual(restored.pulls[0].enemies,r.pulls[0].enemies);
    assert.deepEqual(scoreRoute(restored,after,enemies,null),score);
  }
});
