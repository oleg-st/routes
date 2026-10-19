import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {matchLiveLog} from '../log-import/live-matcher.js';
import {newRoute,scoreRoute} from '../route-model.js';

// The private diagnostic export is deliberately not published with the tests.
// Synthetic assignment tests cover the invariant when the export is absent.
const file='private/logs/route-import-KDvzJny1w6YW8BaH-1.json';
test('KDvzJny1w6YW8BaH/1 keeps whole packs and 270 points without scoring death-skip survivors',{
  skip:!fs.existsSync(file),
},async()=>{
  const saved=JSON.parse(fs.readFileSync(file));
  const options={...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e]))};
  const result=await matchLiveLog(saved.log,options);
  assert.equal(result.partial,undefined);
  assert.equal(result.deathSkips.length,11);
  assert.ok(result.variants.length>0);
  const {dungeon,catalog}=options,byID=new Map(dungeon.enemies.map(p=>[p.placementId,p]));
  const packs=Map.groupBy(dungeon.enemies,p=>p.packId);
  for(const group of Object.values(result.groups)){
    const pack=packs.get(byID.get(group.enemies[0]).packId);
    assert.deepEqual(group.enemies.toSorted(),pack.map(p=>p.placementId).sort());
  }
  for(const variant of result.variants){
    const route=newRoute(dungeon,'test');
    route.shadow=result.shadow;
    route.pulls=variant.pulls.map(p=>({enemies:p.groups.flatMap(id=>result.groups[id].enemies)}));
    route.excluded=variant.pulls.flatMap(p=>p.groups.flatMap(id=>result.groups[id].excluded));
    const score=scoreRoute(route,dungeon,catalog);
    assert.equal(score.score,270);
    assert.equal(score.count,105);
    assert.equal(score.percent,270/265*100);
  }
});
