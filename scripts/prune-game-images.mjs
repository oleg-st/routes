import fs from 'node:fs';
import {usedImages} from './image-assets.mjs';
import {prunePublicImages} from './avif-assets.mjs';

// Keep authoring catalog portraits too; inactive recipe inputs live in private/.
const keep=new Set(usedImages({includeLayers:true}).filter(p=>p.startsWith('images/')));
for(const name of ['enemies','heroes'])for(const row of JSON.parse(fs.readFileSync(`data/${name}.json`)))
  for(const image of row.images??[])if(image.path.startsWith('images/'))keep.add(image.path);
prunePublicImages([...keep]);
