import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import recipe from '../scripts/combined-maps/wraithtide.mjs';
import {mapViews,mapCoordinates,worldMapCoordinates,drawingOnMap,drawingPointFromMap} from '../map-views.js';

const dungeon=JSON.parse(fs.readFileSync(new URL('../data/dungeons.json',import.meta.url))).find(d=>d.id==='Level.ID.PirateRaid');
const close=(actual,expected,label)=>assert.ok(actual?.every((v,i)=>Math.abs(v-expected[i])<1e-6),`${label}: ${actual} != ${expected}`);

test('Wraithtide island and interior use native game coordinates in the rendered artwork frame',()=>{
  for(const layer of recipe.layers){
    const map=dungeon.mapImages.find(m=>m.id.endsWith(':'+layer.suffix)),c=map.gameFrame.calibration,t=layer.artworkTransform;
    for(const actor of dungeon.enemies.filter(p=>p.mapImageId===map.id)){
      // The deck is deliberately cut out and displayed separately; its own
      // regression test checks that crop, including world points and drawings.
      if(layer.suffix.endsWith('JungleArea')&&actor.worldPosition.x<-22000&&actor.worldPosition.y>-13000&&actor.worldPosition.y<-8000&&actor.worldPosition.z>2600)continue;
      for(const point of [actor,...(actor.mapPatrolPath||[]).map((p,i)=>({...p,worldPosition:actor.patrolPath[i]}))]){
        if(point.mapImageId!==map.id)continue;
        const w=point.worldPosition;
        const native=[(w.y-c.ox)/c.sx*map.width,(w.x-c.oy)/c.sy*map.height];
        const expected=[t.x+native[0]/map.width*1024*t.scale,t.y+native[1]/map.height*512*t.scale];
        for(const view of mapViews(dungeon).filter(v=>v.sources)){
          close(mapCoordinates(point,view),expected,actor.placementId);
          close(worldMapCoordinates(w,map.id,view,dungeon),expected,'log position');
          const drawing={id:'native',kind:'note',mapId:map.id,points:[native]};
          close(drawingOnMap(drawing,view,dungeon).points[0],expected,'layer annotation');
          close(drawingPointFromMap(expected,drawing,view,dungeon),native,'annotation round trip');
        }
      }
    }
  }
});

test('Marrow lands inside the Saltwash arena from his game spawn, without an actor override',()=>{
  const boss=dungeon.enemies.find(p=>p.id==='pr-bossanchor');
  // Arena centre measured on our extracted 2048 x 1024 game texture.
  const layer=recipe.layers.find(l=>l.suffix.endsWith('_Lower')),t=layer.artworkTransform;
  const arena=[t.x+920/2*t.scale,t.y+268/2*t.scale];
  const view=mapViews(dungeon)[0];
  assert.ok(Math.hypot(...mapCoordinates(boss,view).map((v,i)=>v-arena[i]))<20);
  close(mapCoordinates({...boss,placementId:undefined},view),mapCoordinates(boss,view),'no override');
});
