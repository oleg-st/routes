import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapStarts} from '../data/map-starts.js';
import {enemyMarkerTier,enemyMarkerScale} from '../data/enemy-marker-sizes.js';
import {gameServiceRules as rules} from '../data/game-service-rules.js';
test('Every dungeon entrance has a runtime position without source evidence',()=>{
 const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
 assert.equal(Object.keys(mapStarts).length,dungeons.length);
 for(const d of dungeons){
  const start=mapStarts[d.id];
  assert.ok(!('spawnPoints' in start)&&!('sources' in start));
  for(const k of ['x','y','z'])assert.ok(Number.isFinite(start.worldPosition[k]));
  assert.ok(d.mapImages.some(m=>m.id===start.mapImageId));
 }
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
