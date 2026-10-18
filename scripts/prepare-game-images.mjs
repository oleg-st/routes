import fs from 'node:fs';
import {compressImages,hashFile} from './avif-assets.mjs';
const jobs=JSON.parse(fs.readFileSync('tmp/game-catalog-migration/image-jobs.json'));
await compressImages(jobs);
for(const name of ['enemies','dungeons','heroes']){
 const file='data/'+name+'.json',data=JSON.parse(fs.readFileSync(file));
 function visit(v){if(!v||typeof v!=='object')return;if(v.path&&v.sourcePath?.startsWith('private/game-data/'))v.sha256=hashFile(v.path);for(const child of Object.values(v))visit(child);}
 visit(data);fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}
