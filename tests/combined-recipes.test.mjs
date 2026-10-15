import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {recipes} from '../scripts/combined-maps/index.mjs';
import {combinedLayouts} from '../data/combined-layouts.js';
import {fullMaps} from '../data/full-maps.js';
import {legacyStitchedLayouts} from '../data/combined-legacy-layouts.js';
import {migrateCombinedDrawing} from '../data/combined-maps.js';
import {mapCoordinates} from '../map-views.js';
import {originalFor} from '../scripts/avif-assets.mjs';
const dungeons=JSON.parse(fs.readFileSync(new URL('../data/dungeons.json',import.meta.url)));

test('Every multilevel dungeon has one recipe using each original layer exactly once',()=>{
  assert.equal(new Set(recipes.map(r=>r.key)).size,recipes.length);
  assert.equal(new Set(recipes.map(r=>r.slug)).size,recipes.length);
  assert.equal(recipes.length,dungeons.filter(d=>d.mapImages.length>1).length);
  for(const recipe of recipes){
    const dungeon=dungeons.find(d=>d.id===`Level.ID.${recipe.key}`);
    assert.ok(dungeon,recipe.key);
    assert.deepEqual(recipe.layers.map(l=>`${dungeon.id}:${l.suffix}`).sort(),dungeon.mapImages.map(m=>m.id).sort());
    for(const [index,layer] of recipe.layers.entries()){
      assert.ok(layer.scale>0);
      assert.ok(layer.outline.length>=3);
      assert.ok(layer.outline.flat().every(Number.isFinite));
      if(layer.join)assert.ok(Number.isInteger(layer.join[0])&&layer.join[0]>=0&&layer.join[0]<index);
      else assert.ok(layer.at?.length===2&&layer.at.every(Number.isFinite));
    }
  }
});

test('Sands original artwork uses the Full coordinate frame and every marker and patrol matches Full',()=>{
  const d=dungeons.find(d=>d.id.endsWith('DesertDunes')),map=combinedLayouts[d.id];
  const full=fullMaps[d.id],mapped=d.enemies.filter(p=>p.mapPosition);
  assert.equal(map.referenceId,d.id);
  assert.equal(map.width,full.width);assert.equal(map.height,full.height);
  assert.deepEqual(Object.keys(map.placements).sort(),mapped.map(p=>p.placementId).sort());
  for(const p of mapped){
    assert.deepEqual(mapCoordinates(p,map),mapCoordinates(p,full));
    for(const pt of p.mapPatrolPath||[])assert.deepEqual(mapCoordinates(pt,map),mapCoordinates(pt,full));
  }
  assert.deepEqual(map.patrols,full.patrols);assert.deepEqual(map.placementPatrols,full.placementPatrols);
  for(const source of d.mapImages){assert.equal(map.sources[source.id].path,source.path);assert.equal(map.sources[source.id].sha256,source.sha256);}
});

test('Sands v2 and v3 annotations follow their terrain into v4, including overlapping source rectangles',()=>{
  const d=dungeons.find(d=>d.id.endsWith('DesertDunes')),current=combinedLayouts[d.id];
  for(const version of [2,3]){
  const old=legacyStitchedLayouts[`${d.id}:Combined-v${version}`];
  for(const [suffix,point] of [['T_Map_DesertDunes_Start',[500,350]],['T_Map_DesertDunes_End',[600,150]]]){
    const id=`${d.id}:${suffix}`,t=old.sources[id],next=current.sources[id];
    const drawing={mapId:old.id,kind:'note',text:'Keep',points:[[t.x+point[0]/1024*t.width,t.y+point[1]/512*t.height]]};
    const migrated=migrateCombinedDrawing(drawing,d);
    assert.equal(migrated.mapId,current.id);assert.equal(migrated.text,'Keep');
    const expected=[next.x+point[0]/1024*next.width,next.y+point[1]/512*next.height];
    assert.ok(migrated.points[0].every((v,i)=>Math.abs(v-expected[i])<.001));
    assert.deepEqual(migrateCombinedDrawing(migrated,d),migrated);
  }
  }
});

test('Sands End artwork aligns with Full landmarks independently of marker calibration',()=>{
  const recipe=recipes.find(r=>r.key==='DesertDunes'),layer=recipe.layers[1];
  const map=combinedLayouts['Level.ID.DesertDunes'],id=`Level.ID.DesertDunes:${layer.suffix}`;
  const art=map.artworkSources[id],coordinates=map.sources[id];
  assert.notEqual(art.width,coordinates.width,'artwork must not reuse the world-coordinate scale');
  for(const landmark of layer.landmarks){
    const actual=[art.x+landmark.source[0]*art.width/1024,art.y+landmark.source[1]*art.height/512];
    assert.ok(Math.hypot(...actual.map((v,i)=>v-landmark.full[i]))<3,landmark.name);
  }
  if(fs.existsSync('private/images-combined')){
    const svg=fs.readFileSync(originalFor(map.path),'utf8');
    assert.ok(svg.includes(`translate(${art.x} ${art.y}) scale(${Number((art.width/1024).toFixed(4))})`));
    assert.ok(!svg.includes('id="art-1"'),'the former local gate warp is no longer needed');
  }
});

test('Rendered source transforms meet authored joins and offsets without moving route coordinates',()=>{
  const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
  for(const recipe of recipes){
    const id=`Level.ID.${recipe.key}`,map=combinedLayouts[id];
    for(const layer of recipe.layers){
      const t=map.sources[`${id}:${layer.suffix}`];
      if(recipe.referenceFrame==='Full'){
        const sourceId=`${id}:${layer.suffix}`;
        for(const [x,y] of [[0,0],[1,1],[.5,.5]]){
          const expected=fullMaps[id].sources[sourceId].calibration?mapCoordinates({mapImageId:sourceId,mapPosition:{x,y}},fullMaps[id]):[layer.coordinateTransform.x+x*1024*layer.coordinateTransform.scale,layer.coordinateTransform.y+y*512*layer.coordinateTransform.scale];
          near(t.x+x*t.width,expected[0]);near(t.y+y*t.height,expected[1]);
        }
        continue;
      }
      near(t.width,2048*layer.scale);near(t.height,1024*layer.scale);
      if(!layer.join)continue;
      const [previous,ax,ay,bx,by]=layer.join,other=recipe.layers[previous];
      const p=map.sources[`${id}:${other.suffix}`];
      near(t.x+bx*2*layer.scale,p.x+ax*2*other.scale+(layer.offset?.[0]||0)*2);
      near(t.y+by*2*layer.scale,p.y+ay*2*other.scale+(layer.offset?.[1]||0)*2);
    }
  }
});

test('Every Combined matches Full encounters and patrols without embedding Full artwork',()=>{
  for(const r of recipes){
    const id=`Level.ID.${r.key}`,d=dungeons.find(d=>d.id===id),map=combinedLayouts[id],full=fullMaps[id];
    assert.equal(map.referenceId,id);
    for(const p of d.enemies.filter(p=>p.mapPosition)){
      assert.deepEqual(mapCoordinates(p,map),mapCoordinates(p,full));
      for(const pt of p.mapPatrolPath||[])assert.deepEqual(mapCoordinates(pt,map),mapCoordinates(pt,full));
    }
    assert.deepEqual(map.patrols,full.patrols);
    assert.deepEqual(map.placementPatrols,full.placementPatrols);
    if(fs.existsSync('private/images-combined')){
      const svg=fs.readFileSync(originalFor(map.path),'utf8');
      assert.equal((svg.match(/data:image\/webp;base64,/g)||[]).length,d.mapImages.length);
      assert.ok(!svg.includes('data:image/jpeg')&&!svg.includes(full.path));
    }
    for(const l of r.layers.filter(l=>l.artworkTransform))for(const p of l.landmarks){
      const t=l.artworkTransform;
      assert.ok(Math.hypot(t.x+t.scale*p.source[0]-p.full[0],t.y+t.scale*p.source[1]-p.full[1])<10,`${r.slug} ${l.suffix} ${p.name}`);
    }
  }
});

test('All former v2 stitched drawings migrate once and retain content',()=>{
  for(const r of recipes.filter(r=>r.key!=='DesertDunes')){
    const id=`Level.ID.${r.key}`,d=dungeons.find(d=>d.id===id),old=legacyStitchedLayouts[`${id}:Combined-v2`],next=combinedLayouts[id];
    assert.ok(old);assert.notEqual(old.id,next.id);
    // Last painted terrain unambiguously owns a point inside its polygon.
    const [sid,t]=Object.entries(old.sources).at(-1),p=t.outline[0],target=next.sources[sid];
    const drawing={id:'migration-check',mapId:old.id,kind:'note',text:'Маршрут',points:[[t.x+p[0]*t.width/1024,t.y+p[1]*t.height/512]]};
    const migrated=migrateCombinedDrawing(drawing,d);
    assert.equal(migrated.mapId,next.id);assert.equal(migrated.text,drawing.text);
    assert.ok(Math.hypot(migrated.points[0][0]-(target.x+p[0]*target.width/1024),migrated.points[0][1]-(target.y+p[1]*target.height/512))<.01);
    assert.deepEqual(migrateCombinedDrawing(migrated,d),migrated);
  }
});
