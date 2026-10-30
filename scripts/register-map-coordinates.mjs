// Register extracted game coordinates to the transforms used to draw our
// textures. Actor samples and third-party placements are never calibration inputs.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {fullMaps,fullMapBuildId} from '../data/full-maps.js';
import {recipes} from './combined-maps/index.mjs';

export function registeredMap(reference,dungeon,recipe){
  const result=structuredClone(reference);
  result.nativeProjection=true;
  for(const map of dungeon.mapImages){
    const source=result.sources[map.id],layer=recipe.layers.find(l=>map.id.endsWith(':'+l.suffix));
    const c=map.gameFrame?.calibration;
    if(!source||!layer||!c)throw Error('Missing native map registration: '+map.id);
    if(layer.artWarp)throw Error('Register the artwork warp before projecting coordinates: '+map.id);
    if(Math.abs(c.sx+2*c.sy)>1e-6)throw Error('Nonuniform native map: '+map.id);
    const art=layer.artworkTransform??layer.coordinateTransform;
    if(art){
      source.factor=art.scale*1024/c.sx;
      source.left=c.ox;source.bottom=c.oy;
      source.x=art.x;source.y=result.height-art.y;
    }else if(JSON.stringify(source.calibration)!==JSON.stringify(c)){
      throw Error('Review the unregistered texture before changing its native frame: '+map.id);
    }
    source.calibration=structuredClone(c);
    source.bounds=structuredClone(map.gameFrame.bounds);
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const check=process.argv.includes('--check'),dungeons=JSON.parse(fs.readFileSync('data/dungeons.json','utf8'));
  const updated={...fullMaps};
  for(const d of dungeons.filter(d=>fullMaps[d.id])){
    const recipe=recipes.find(r=>d.id==='Level.ID.'+r.key);
    updated[d.id]=registeredMap(fullMaps[d.id],d,recipe);
    if(check&&JSON.stringify(updated[d.id])!==JSON.stringify(fullMaps[d.id]))throw Error('Map registration is stale: '+d.name);
  }
  if(!check)fs.writeFileSync('data/full-maps.js',`// Native game-map frames registered to our texture composition by scripts/register-map-coordinates.mjs.\n// displayRegions place separately cropped playable areas in the same canvas.\nexport const fullMapBuildId=${JSON.stringify(fullMapBuildId)};\nexport const fullMaps=${JSON.stringify(updated)};\n`);
  console.log(`Native map registration ${check?'verified':'updated'}: ${Object.keys(updated).length} overviews.`);
}
