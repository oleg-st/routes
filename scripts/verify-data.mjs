import fs from 'node:fs';
import crypto from 'node:crypto';
import {fullMaps,fullMapBuildId} from '../data/full-maps.js';
import {combinedLayouts,combinedBuildId} from '../data/combined-layouts.js';
import {campfireBuildId} from '../data/map-campfires.js';
import {recipes} from './combined-maps/index.mjs';
import {usedImages} from './image-assets.mjs';
import {gameDungeons} from '../data/game-dungeons.js';
import {customDungeons} from '../data/custom-dungeons.js';
const read=n=>JSON.parse(fs.readFileSync(`data/${n}.json`,'utf8'));
const dungeons=read('dungeons'),enemies=read('enemies'),ids=new Set(enemies.map(e=>e.id));
const publicOnly=process.argv.includes('--public');
if(fullMapBuildId!==read('manifest').buildId)throw new Error('Full map calibration does not match the data build.');
if(campfireBuildId!==read('manifest').buildId)throw new Error('Campfire coordinates do not match the data build. Run node private/scripts/prepare-campfires.mjs.');
if(combinedBuildId!==read('manifest').buildId)throw new Error('Combined maps do not match the data build. Rebuild with npm run maps.');
for(const d of dungeons.filter(d=>d.mapImages.length>1)){
  const combined=combinedLayouts[d.id];
  if(!combined)throw new Error(`Missing Combined map: ${d.id}`);
  if(combined.referenceId&&crypto.createHash('sha256').update(JSON.stringify(fullMaps[combined.referenceId])).digest('hex')!==combined.referenceSha256)throw new Error(`Combined coordinate reference changed: ${d.id}. Rebuild with npm run maps.`);
  const recipe=recipes.find(r=>d.id===`Level.ID.${r.key}`);
  if(!recipe||crypto.createHash('sha256').update(JSON.stringify(recipe)).digest('hex')!==combined.recipeSha256)throw new Error(`Combined recipe changed: ${d.id}. Rebuild with npm run maps.`);
  for(const patch of [...recipe.layers.flatMap(layer=>layer.artworkRepairs||[]),...(recipe.canvasRepairs||[])]){
    if(fs.existsSync(patch.path)&&crypto.createHash('sha256').update(fs.readFileSync(patch.path)).digest('hex')!==patch.sha256)throw new Error(`Combined artwork repair changed: ${patch.path}`);
  }
  const bytes=fs.readFileSync(combined.path);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==combined.sha256)throw new Error(`Combined image has changed: ${combined.path}`);
  for(const source of d.mapImages)if(combined.sources[source.id]?.sha256!==source.sha256||combined.sources[source.id]?.sourceSha256!==source.sourceSha256)throw new Error(`Combined source has changed: ${source.path}`);
}
for(const map of publicOnly?[]:Object.values(fullMaps)){
  // Referenced JPEGs are optional private assets; verify them when available.
  if(!fs.existsSync(map.path))continue;
  const hash=crypto.createHash('sha256').update(fs.readFileSync(map.path)).digest('hex');
  if(hash!==map.sha256)throw new Error(`Full map differs from reference: ${map.path}`);
}
let maps=0,placements=0,unmapped=0;
for(const d of dungeons){
  const game=gameDungeons[d.id];
  if(!game)throw new Error('Missing game dataset: '+d.id);
  const owners=new Map();
  for(const pack of customDungeons[d.id].packs)for(const id of pack.members){
    if(owners.has(id))throw new Error('Duplicate game pack member: '+id);owners.set(id,pack.id);
  }
  if(owners.size!==game.enemies.length)throw new Error('Game pack coverage differs: '+d.id);
  for(const p of game.enemies){
    if(!ids.has(p.id)||owners.get(p.placementId)!==p.packId)throw new Error('Invalid game placement: '+p.placementId);
    if(!d.mapImages.some(m=>m.id===p.mapImageId)||![...Object.values(p.worldPosition),...Object.values(p.mapPosition)].every(Number.isFinite))throw new Error('Invalid game map projection: '+p.placementId);
  }
  const mapIds=new Set(d.mapImages.map(m=>m.id)),positionIds=new Set();
  for(const map of d.mapImages){
    if(publicOnly)continue;
    if(!fs.existsSync(map.path)){
      if(map.path.startsWith('private/'))continue;
      throw new Error(`Missing map: ${map.path}`);
    }
    const hash=crypto.createHash('sha256').update(fs.readFileSync(map.path)).digest('hex');
    if(hash!==map.sha256)throw new Error(`Compressed map hash differs: ${map.path}`);maps++;
  }
  for(const p of d.enemies){
    if(!ids.has(p.id))throw new Error(`Unknown enemy: ${p.id}`);
    if(positionIds.has(p.placementId))throw new Error(`Duplicate placement: ${p.placementId}`);positionIds.add(p.placementId);
    if(!p.mapPosition||!p.mapImageId)unmapped++;
    else if(!mapIds.has(p.mapImageId))throw new Error(`Unknown map: ${p.mapImageId}`);
    placements++;
  }
}
for(const image of usedImages()){
  if(!image.endsWith('.avif'))throw new Error(`Runtime image is not AVIF: ${image}`);
  if(!fs.existsSync(image))throw new Error(`Missing image: ${image}. Run npm run images.`);
}
for(const file of fs.readdirSync('images',{recursive:true,withFileTypes:true}))if(file.isFile()&&!file.name.endsWith('.avif'))throw new Error(`Non-AVIF file in images/: ${file.name}`);
console.log(`${publicOnly?'Public build: ':''}${dungeons.length} dungeons, ${maps} verified private map hashes, ${placements} placements, ${unmapped} placement without map coordinates (reported in UI).`);
