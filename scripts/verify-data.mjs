import fs from 'node:fs';
import crypto from 'node:crypto';
import {fullMaps,fullMapBuildId} from '../data/full-maps.js';
import {combinedLayouts,combinedBuildId} from '../data/combined-layouts.js';
import {campfireBuildId} from '../data/map-campfires.js';
import {usedImages} from './image-assets.mjs';
import {routeMapping} from '../data/route-mapping.js';
import {verifyPublicData} from './verify-public-data.mjs';
verifyPublicData('data');
const read=n=>JSON.parse(fs.readFileSync(`data/${n}.json`,'utf8'));
const dungeons=read('dungeons'),enemies=read('enemies'),ids=new Set(enemies.map(e=>e.id));
const publicOnly=process.argv.includes('--public');
if(fullMapBuildId!==read('manifest').buildId)throw new Error('Full map calibration does not match the data build.');
if(campfireBuildId!==read('manifest').buildId)throw new Error('Campfire coordinates do not match the data build.');
if(combinedBuildId!==read('manifest').buildId)throw new Error('Combined maps do not match the data build.');
for(const d of dungeons.filter(d=>d.mapImages.length>1)){
  const combined=combinedLayouts[d.id];
  if(!combined)throw new Error(`Missing Combined map: ${d.id}`);
  if(combined.referenceId&&crypto.createHash('sha256').update(JSON.stringify(fullMaps[combined.referenceId])).digest('hex')!==combined.referenceSha256)throw new Error(`Combined coordinate reference changed: ${d.id}.`);
  const bytes=fs.readFileSync(combined.path);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==combined.sha256)throw new Error(`Combined image has changed: ${combined.path}`);
}
let placements=0,unmapped=0;
for(const d of dungeons){
  const dictionary=routeMapping.dungeons[d.id];
  if(!dictionary)throw new Error('Missing route dictionary: '+d.id);
  for(const [packId,members] of Map.groupBy(d.enemies,p=>p.packId)){
    const expected=members.map(p=>p.placementId).sort();
    if(!dictionary.packs.some(pack=>pack.id===packId&&JSON.stringify(pack.members.map(i=>dictionary.placements[i]).sort())===JSON.stringify(expected)))throw new Error('Unmapped pack: '+packId);
  }
  for(const p of d.enemies){
    if(!ids.has(p.id)||!p.packId)throw new Error('Invalid game placement: '+p.placementId);
    if(!d.mapImages.some(m=>m.id===p.mapImageId)||![...Object.values(p.worldPosition),...Object.values(p.mapPosition)].every(Number.isFinite))throw new Error('Invalid game map projection: '+p.placementId);
  }
  const mapIds=new Set(d.mapImages.map(m=>m.id)),positionIds=new Set();
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
  if(!fs.existsSync(image))throw new Error(`Missing image: ${image}.`);
}
for(const file of fs.readdirSync('images',{recursive:true,withFileTypes:true}))if(file.isFile()&&!file.name.endsWith('.avif'))throw new Error(`Non-AVIF file in images/: ${file.name}`);
console.log(`${publicOnly?'Public build: ':''}${dungeons.length} dungeons, ${placements} placements, ${unmapped} placement without map coordinates (reported in UI).`);
