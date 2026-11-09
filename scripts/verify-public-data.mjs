import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const privateNames=new Set(['ability-details.json','game-image-sources.json','game-map-frames.json','game-dungeons.js','custom-dungeons.js','dangerous-casts.json']);
export function verifyPublicData(root='data'){
  const files=fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile());
  for(const entry of files){
    const file=path.join(entry.parentPath??entry.path,entry.name);
    if(privateNames.has(entry.name))throw Error('Private dataset in public output: '+file);
    if(!/\.(?:json|js|html|md)$/.test(entry.name))continue;
    const text=fs.readFileSync(file,'utf8');
    if(/fellowship[\\/]Content[\\/]|(?<![a-z0-9])\/Game\/|RawDataTables[\\/]|private[\\/](?:game-data|catalog|reports|ability-details)/i.test(text))
      throw Error('Internal source reference in public output: '+file);
  }
  return files.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  console.log('Public data boundary: '+verifyPublicData(process.argv[2]??'data')+' files checked.');
