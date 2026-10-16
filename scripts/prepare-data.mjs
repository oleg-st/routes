import fs from 'node:fs';
import path from 'node:path';
import {restoreBossEncounters,restoreBossCatalog} from '../data/boss-encounters.js';
const root = 'node_modules/@crockery/fellowship-data';
fs.mkdirSync('data',{recursive:true});
for (const file of ['dungeons','enemies','abilities']) {
  fs.copyFileSync(path.join(root,'data',file+'.json'), 'data/'+file+'.json');
}
fs.writeFileSync('data/enemies.json',JSON.stringify(restoreBossCatalog(JSON.parse(fs.readFileSync('data/enemies.json','utf8'))),null,2)+'\n');
const heroes=JSON.parse(fs.readFileSync(path.join(root,'data/heroes.json'),'utf8')).filter(h=>h.isLive&&h.name).map(({id,name,role,classColor,images})=>({id,name,role,classColor,images:images.filter(image=>image.size==='200'&&!image.variant).slice(0,1)}));
fs.writeFileSync('data/heroes.json',JSON.stringify(heroes,null,2)+'\n');
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json','utf8')).map(restoreBossEncounters);
for(const dungeon of dungeons)if(dungeon.mapImages.length>1)for(const map of dungeon.mapImages)map.path='private/'+map.path;
fs.writeFileSync('data/dungeons.json',JSON.stringify(dungeons,null,2)+'\n');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
fs.writeFileSync('data/manifest.json',JSON.stringify({...manifest,packageVersion:pkg.version},null,2));
fs.copyFileSync(path.join(root,'LICENSE'),'data/LICENSE-fellowship-data.txt');
console.log('Local game data prepared. Images remain in images/.');
