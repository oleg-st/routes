import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newRoute,validateRoute,encodeRoute,decodeRoute} from '../route-model.js';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {routeMapping} from '../data/route-mapping.js';

const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name+'.json',import.meta.url)));
const base=correctDungeon(read('dungeons')[0]);
const enemies=new Map(read('enemies').map(e=>[e.id,e]));

test('old builds cannot enter JSON, compact routes or CRDT even with surviving placement IDs',async()=>{
  const oldDungeon={...base,routeBuildId:'old'},current={...base,routeBuildId:'new'};
  const old=newRoute(oldDungeon,'old');old.pulls[0].enemies=[base.enemies[0].placementId];
  assert.throws(()=>validateRoute(old,[current],enemies),/another game build/);
  assert.throws(()=>validateRoute({...old,buildId:undefined},[current],enemies),/another game build/);
  await assert.rejects(encodeRoute(old,current),/another game build/);
  const encoded=await encodeRoute(old,oldDungeon);
  await assert.rejects(decodeRoute(encoded,[current],enemies),/another game build/);
  const doc=createRouteDocument(old,{dungeon:oldDungeon,enemies});
  try{assert.throws(()=>restoreRouteDocument(doc.exportSnapshot(),{dungeon:current,enemies}),/another game build/);}
  finally{doc.dispose();}
  const route=newRoute(current,'new');
  assert.equal((await decodeRoute(await encodeRoute(route,current),[current],enemies)).buildId,'new');
});

test('historical route fixtures are rejected and the public dictionary contains only this build',async()=>{
  const dungeons=read('dungeons'),build=read('manifest').buildId;
  assert.equal(routeMapping.buildId,build);
  assert.deepEqual(Object.keys(routeMapping.dungeons).sort(),dungeons.map(d=>d.id).sort());
  for(const d of dungeons){
    assert.equal(d.routeBuildId,build);assert.equal(d.retiredPlacementIds,undefined);
    assert.equal(routeMapping.dungeons[d.id].legacy,undefined);
  }
  const old=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-routes.json',import.meta.url)));
  for(const fixture of old)await assert.rejects(decodeRoute(fixture.text,dungeons,enemies),/another game build|not available/);
});
