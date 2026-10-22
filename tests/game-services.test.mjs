import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {capsuleInCylinder,selectedServiceLevel} from '../scripts/game-service-model.mjs';
import {campfires} from '../data/map-campfires.js';
import {modifierPositions} from '../data/game-modifier-positions.js';
import {modifierAvailable} from '../game-scoring.js';
import {mapCoordinates,mapViews} from '../map-views.js';
import {newRoute,applyModifierPresets,toggleModifier,effectivePositions,encodeRoute,decodeRoute} from '../route-model.js';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
test('Mini-boss cylinder intersects hit volumes, including above/below and tilted capsules',()=>{
 const origin={x:0,y:0,z:0},c={position:{x:2100,y:0,z:200},radius:150,halfHeight:250};
 assert.equal(capsuleInCylinder(c,origin,2000,1000),true);
 assert.equal(capsuleInCylinder({...c,position:{x:2200,y:0,z:200}},origin,2000,1000),false);
 assert.equal(capsuleInCylinder({...c,position:{x:0,y:0,z:-300}},origin,2000,1000),false);
 assert.equal(capsuleInCylinder({...c,position:{x:0,y:0,z:1200}},origin,2000,1000),true);
 assert.equal(capsuleInCylinder({...c,position:{x:0,y:0,z:1300}},origin,2000,1000),false);
 assert.equal(capsuleInCylinder({...c,position:{x:2200,y:0,z:200},axis:{x:1,y:0,z:0}},origin,2000,1000),true);
});
test('Service layer selection excludes ordinary enemy duplicates, keeps environment POIs',()=>{
 const selected=['Dungeon','Dungeon_Enemies_Alternate_01'];
 assert.equal(selectedServiceLevel('/Dungeon_Enemies.umap',selected),false);
 assert.equal(selectedServiceLevel('/Dungeon_Enemies_Alternate_01.umap',selected),true);
 assert.equal(selectedServiceLevel('/Dungeon_Environment.umap',selected),true);
});
test('Own campfires and every remaining UI texture have game provenance',()=>{
 assert.equal(Object.values(campfires).flat().length,38);
 const dungeons=read('dungeons');
 for(const [id,list]of Object.entries(campfires))for(const fire of list){
  assert.match(fire.source,/^\//);assert.ok(Number.isFinite(fire.worldPosition.z));
  assert.ok(dungeons.find(d=>d.id===id).mapImages.some(m=>m.id===fire.mapImageId));
 }
 const sources=read('game-image-sources');
 for(const file of ['images/modifiers/empowered-minions.avif','images/modifiers/shadow-lord.avif','images/pois/bonfire.avif','images/hero-items/relic-b-crit-portal-hero-item-200.avif','images/hero-items/relic-b-expertise-groupinvisibility-hero-item-200.avif','images/relics/ga-relicpower-polymorphtargetwithsharedcharges-relic-200.avif']){
  assert.match(sources[file].source,/^private\/game-data\//);assert.match(sources[file].gameAsset,/^\/Game\//);assert.ok(fs.statSync(file).size>0);
 }
});
test('Native modifier markers survive sharing and replacements remain independently selectable',async()=>{
 const dungeons=read('dungeons'),catalog=new Map(read('enemies').map(e=>[e.id,e])),presets=read('modifier-placements');
 assert.equal(presets.source,'installed-game');
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
