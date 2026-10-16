import {customDungeons} from '../data/custom-dungeons.js';
import {routeMapping} from '../data/route-mapping.js';

// Reuse the permanent dictionary instead of shipping placement hashes twice.
export function compactCustomModule(){
  const rows=Object.fromEntries(Object.entries(customDungeons).map(([id,d])=>{
    const dictionary=routeMapping.dungeons[id];
    const packs=d.packs.map(p=>{
      const index=dictionary.packs.findIndex(q=>q.id===p.id&&JSON.stringify(q.members.map(i=>dictionary.placements[i]))===JSON.stringify(p.members));
      if(index<0)throw new Error('Custom pack is missing from route mapping: '+p.id);
      return index;
    });
    return [id,[packs,d.burried.map(id=>{const i=dictionary.placements.indexOf(id);if(i<0)throw new Error('Unknown custom placement.');return i;})]];
  }));
  return `import {routeMapping} from './route-mapping.js';\nconst rows=${JSON.stringify(rows)};\nexport const customDungeons=Object.fromEntries(Object.entries(rows).map(([id,[packs,burried]])=>{const d=routeMapping.dungeons[id];return [id,{packs:packs.map(i=>({id:d.packs[i].id,members:d.packs[i].members.map(j=>d.placements[j])})),burried:burried.map(i=>d.placements[i])}];}));\n`;
}
