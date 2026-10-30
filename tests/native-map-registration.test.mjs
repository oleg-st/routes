import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {recipes} from '../scripts/combined-maps/index.mjs';
import {mapViews,mapCoordinates,worldMapCoordinates,drawingPointFromMap} from '../map-views.js';
import {fullMaps} from '../data/full-maps.js';
import {registeredMap} from '../scripts/register-map-coordinates.mjs';

const dungeons=JSON.parse(fs.readFileSync(new URL('../data/dungeons.json',import.meta.url)));
const presets=JSON.parse(fs.readFileSync(new URL('../data/modifier-placements.json',import.meta.url))).dungeons;
const close=(a,b,label)=>assert.ok(a?.every((v,i)=>Math.abs(v-b[i])<1e-6),`${label}: ${a} != ${b}`);
function inside([x,y],polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [ax,ay]=polygon[i],[bx,by]=polygon[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)result=!result;
  }
  return result;
}
function expectedPoint(point,map,view,recipe){
  const c=map.gameFrame.calibration,w=point.worldPosition;
  const uv=[(w.y-c.ox)/c.sx,(w.x-c.oy)/c.sy];
  if(!view.sources)return uv.map((v,i)=>v*(i?map.height:map.width));
  const index=recipe.layers.findIndex(l=>map.id.endsWith(':'+l.suffix)),layer=recipe.layers[index];
  // Independently use the crop's actual SVG mask, not runtime displayRegions.
  for(const overlay of recipe.overlays||[]){
    if(overlay.source!==index||!overlay.maskPolygon)continue;
    const p=[(uv[0]*1024-overlay.crop[0])/overlay.crop[2],(uv[1]*512-overlay.crop[1])/overlay.crop[3]];
    if(inside(p,overlay.maskPolygon))return p.map((v,i)=>overlay.at[i]+v*overlay.size[i]);
  }
  const t=layer.artworkTransform;
  if(t)return [t.x+uv[0]*1024*t.scale,t.y+uv[1]*512*t.scale];
  const tile=view.artworkSources?.[map.id]??mapViews(dungeons.find(d=>d.mapImages.includes(map)))[0].artworkSources[map.id];
  return [tile.x+uv[0]*tile.width,tile.y+uv[1]*tile.height];
}

for(const dungeon of dungeons)test(`${dungeon.name}: native actors, patrols and modifier spawns agree with our artwork`,()=>{
  const recipe=recipes.find(r=>dungeon.id==='Level.ID.'+r.key),views=mapViews(dungeon);
  const modifiers=Object.values(presets[dungeon.id]||{}).flatMap(value=>{
    const candidates=Array.isArray(value)?value:[value];
    return candidates.filter(p=>p?.worldPosition&&p?.mapImageId);
  });
  const points=[...dungeon.enemies.flatMap(p=>[p,...(p.mapPatrolPath||[]).map((pt,i)=>({...pt,worldPosition:p.patrolPath[i]}))]),...modifiers];
  for(const point of points){
    const map=dungeon.mapImages.find(m=>m.id===point.mapImageId),c=map.gameFrame.calibration,w=point.worldPosition;
    close([point.mapPosition.x,point.mapPosition.y],[(w.y-c.ox)/c.sx,(w.x-c.oy)/c.sy],'stored game projection');
    for(const view of views.filter(v=>v.sources||v.id===map.id)){
      const expected=expectedPoint(point,map,view,recipe),label=`${point.placementId||'patrol'} on ${view.id}`;
      // Legacy untouched textures have 4-decimal serialization in artworkSources.
      const tolerance=recipe?.layers.find(l=>map.id.endsWith(':'+l.suffix))?.artworkTransform?1e-6:1e-3;
      for(const actual of [mapCoordinates(point,view),worldMapCoordinates(w,map.id,view,dungeon)]){
        assert.ok(actual?.every((v,i)=>Math.abs(v-expected[i])<tolerance),`${label}: ${actual} != ${expected}`);
      }
      if(view.sources){
        const native=[point.mapPosition.x*map.width,point.mapPosition.y*map.height];
        const projected=drawingPointFromMap(native,{mapId:view.id},map,dungeon);
        close(projected,mapCoordinates(point,view),'native drawing and actor projection');
      }
    }
  }
  if(fullMaps[dungeon.id])assert.deepEqual(registeredMap(fullMaps[dungeon.id],dungeon,recipe),fullMaps[dungeon.id]);
});
