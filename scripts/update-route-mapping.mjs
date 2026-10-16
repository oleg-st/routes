import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {placementAliases} from '../data/placement-corrections.js';
import {buriedPlacements} from '../data/buried-placements.js';
import {customDungeons} from '../data/custom-dungeons.js';

// Append only: never recycle placement or composition indexes, even after rollback.
const filename='data/route-mapping.js';
const mapping=fs.existsSync(filename)?structuredClone((await import(pathToFileURL(path.resolve(filename)))).routeMapping):{version:1,dungeons:{}};
const initial=structuredClone(mapping);
const raw=JSON.parse(fs.readFileSync('data/dungeons.json'));
const signature=members=>[...members].sort((a,b)=>a-b).join(',');
for(const d of raw){
 const entry=mapping.dungeons[d.id]??={placements:[],packs:[],legacy:[]};
 for(const id of [...new Set([...d.enemies.map(p=>p.placementId),'modifier:ghorn','modifier:witch'])].sort())if(!entry.placements.includes(id))entry.placements.push(id);
 const canonical=d.enemies.filter(p=>!placementAliases[d.id]?.[p.placementId]);
 const buried=new Set(buriedPlacements[d.id]??[]);
 const variants=[d.enemies,canonical,canonical.map(p=>buried.has(p.placementId)?{...p,packId:'pack-buried-'+p.placementId}:p)];
 function register(id,ids){
  const members=ids.map(id=>entry.placements.indexOf(id));
  if(members.some(i=>i<0))throw Error('Unknown placement in '+id);
  let index=entry.packs.findIndex(p=>p.id===id&&signature(p.members)===signature(members));
  if(index<0){index=entry.packs.length;entry.packs.push({id,members});}
  return index;
 }
 for(const ps of variants){
  const ids=[...new Set([...ps.map(p=>p.placementId),'modifier:ghorn','modifier:witch'])].sort();
  const packs=[...new Set(ps.map(p=>p.packId).filter(Boolean))].sort();
  const fingerprint=createHash('sha256').update(JSON.stringify([ids,packs])).digest().subarray(0,12).toString('base64url');
  const indexes=packs.map(id=>register(id,ps.filter(p=>p.packId===id).map(p=>p.placementId)));
  if(!entry.legacy.some(p=>p.fingerprint===fingerprint))entry.legacy.push({fingerprint,placements:ids.map(id=>entry.placements.indexOf(id)),packs:indexes});
 }
 for(const p of customDungeons[d.id]?.packs??[])register(p.id,p.members);
}
for(const [id,before]of Object.entries(initial.dungeons))for(const key of ['placements','packs','legacy']){
 if(JSON.stringify(mapping.dungeons[id][key].slice(0,before[key].length))!==JSON.stringify(before[key]))throw Error('Existing mapping was changed: '+id+' '+key);
}
const text='// Permanent route dictionaries. Only append entries with scripts/update-route-mapping.mjs.\nexport const routeMapping='+JSON.stringify(mapping)+';\n';
if(process.argv.includes('--check')){if(fs.readFileSync(filename,'utf8')!==text)throw Error('Route mapping needs appended entries. Run node scripts/update-route-mapping.mjs.');}
else fs.writeFileSync(filename,text);
console.log('Route mapping:',Object.keys(mapping.dungeons).length,'dungeons,',Object.values(mapping.dungeons).reduce((n,d)=>n+d.packs.length,0),'immutable pack entries');
