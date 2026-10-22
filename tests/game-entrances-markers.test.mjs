import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {playerStartCenter} from '../scripts/game-service-model.mjs';
import {mapStarts} from '../data/map-starts.js';
import {enemyMarkerTier,enemyMarkerScale} from '../data/enemy-marker-sizes.js';
import {gameServiceRules as rules} from '../data/game-service-rules.js';

test('Every dungeon entrance records its game spawn group and centroid',()=>{
 const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
 assert.equal(Object.keys(mapStarts).length,dungeons.length);
 for(const d of dungeons){
  const start=mapStarts[d.id];assert.equal(start.spawnPoints.length,4,d.name);
  assert.equal(start.sources.length,start.spawnPoints.length);
  assert.equal(new Set(start.sources).size,start.sources.length);
  for(const k of ['x','y','z'])assert.equal(start.worldPosition[k],start.spawnPoints.reduce((s,p)=>s+p[k],0)/start.spawnPoints.length);
  assert.ok(d.mapImages.some(m=>m.id===start.mapImageId));
 }
});

test('Entrance extraction refuses missing coordinates, attachments and unhandled streamed transforms',()=>{
 const point=(x,y,z)=>({source:'game/Test/Test.umap',ref:'actor-'+x,rootComponent:{properties:{RelativeLocation:{X:x,Y:y,Z:z}}}});
 assert.deepEqual(playerStartCenter([point(1,2,3),point(3,4,5)],'Test').worldPosition,{x:2,y:3,z:4});
 assert.throws(()=>playerStartCenter([],'Test'),/No PlayerStart/);
 assert.throws(()=>playerStartCenter([point(1,2,undefined)],'Test'),/coordinates/);
 const attached=point(1,2,3);attached.rootComponent.properties.AttachParent={};
 assert.throws(()=>playerStartCenter([attached],'Test'),/Attached/);
 assert.throws(()=>playerStartCenter([point(1,2,3)],'Other'),/streamed/);
});

test('Marker sizes follow effective Polymorph thresholds with independent boss styling',()=>{
 assert.deepEqual(rules.markerHealthThresholds,{medium:2,large:3.5});
 assert.equal(rules.polymorphLargeThresholdOverride,undefined);
 const enemy=m=>({baseHealth:rules.markerDefaultBaseHealth*m});
 assert.equal(enemyMarkerTier(enemy(1.999)),'small');
 assert.equal(enemyMarkerTier(enemy(2)),'medium');
 assert.equal(enemyMarkerTier(enemy(3.299)),'medium');
 assert.equal(enemyMarkerTier(enemy(3.3)),'medium');
 assert.equal(enemyMarkerTier(enemy(3.5)),'large');
 assert.equal(enemyMarkerScale({...enemy(.5),isBoss:true}),3);
 assert.equal(enemyMarkerTier({...enemy(2),id:'new-mob',name:'Renamed',dungeonScore:500}),'medium');
 assert.equal(enemyMarkerTier(undefined),'small');
 for(const e of JSON.parse(fs.readFileSync('data/enemies.json'))){
  assert.ok(Number.isFinite(e.baseHealth)&&e.baseHealth>0,e.id);
  if(['dm-wintergiant','dm-winterwitch'].includes(e.id))assert.equal(enemyMarkerTier(e),'large');
 }
});
