import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {campfires} from '../data/map-campfires.js';
import {modifierPositions} from '../data/game-modifier-positions.js';
import {modifierAvailable} from '../game-scoring.js';
import {mapCoordinates,mapViews} from '../map-views.js';
import {newRoute,applyModifierPresets,toggleModifier,effectivePositions,encodeRoute,decodeRoute} from '../route-model.js';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
test('Own campfires and every remaining UI texture have game provenance',()=>{
 assert.equal(Object.values(campfires).flat().length,38);
 const dungeons=read('dungeons');
 for(const [id,list]of Object.entries(campfires))for(const fire of list){
  assert.ok(!Object.hasOwn(fire,'source'));assert.ok(Number.isFinite(fire.worldPosition.z));
  assert.ok(dungeons.find(d=>d.id===id).mapImages.some(m=>m.id===fire.mapImageId));
 }
 for(const file of ['images/modifiers/empowered-minions.avif','images/modifiers/shadow-lord.avif','images/pois/bonfire.avif','images/hero-items/relic-b-crit-portal-hero-item-200.avif','images/hero-items/relic-b-expertise-groupinvisibility-hero-item-200.avif','images/relics/ga-relicpower-polymorphtargetwithsharedcharges-relic-200.avif']){
  assert.ok(fs.statSync(file).size>0);
 }
});
test('Native modifier markers survive sharing and replacements remain independently selectable',async()=>{
 const dungeons=read('dungeons'),catalog=new Map(read('enemies').map(e=>[e.id,e])),presets=read('modifier-placements');
 assert.ok(presets.buildId);
 for(const d of dungeons){
  const row=presets.dungeons[d.id];assert.ok(!row.ghorn?.replacedEnemies.some(id=>row.witch?.replacedEnemies.includes(id)));
  for(const kind of ['ghorn','witch'])if(row[kind]&&modifierAvailable(d.id,kind)){
   const route=newRoute(d,d.routeBuildId??'test');applyModifierPresets(route,d,presets);toggleModifier(route,kind);
   const copy=await decodeRoute(await encodeRoute(route,d),dungeons,catalog);
   const marker=effectivePositions(copy,d).find(p=>p.modifier===kind);
   assert.deepEqual(marker.worldPosition,modifierPositions[d.id][kind].worldPosition);
   assert.deepEqual(marker.mapPosition,modifierPositions[d.id][kind].mapPosition);
   for(const view of mapViews(d).filter(v=>v.sources?.[marker.mapImageId]||v.id===marker.mapImageId))assert.deepEqual(mapCoordinates(marker,view),mapCoordinates({...marker,mapMembers:undefined},view));
  }
 }
});
