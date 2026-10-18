import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapViews,mapCoordinates,worldMapCoordinates,onMap,drawingOnMap,drawingPointFromMap,mapStart,mapCampfires} from '../map-views.js';
import {campfires,campfireBuildId} from '../data/map-campfires.js';
import {mapStarts,mapStartBuildId} from '../data/map-starts.js';
import {legacyCombinedMap} from '../data/combined-maps.js';
import {placementAliases,correctDungeon} from '../data/placement-corrections.js';
import {newRoute,newPull,validateRoute,scoreRoute,effectivePositions,applyModifierPresets,toggleModifier} from '../route-model.js';
const read=n=>JSON.parse(fs.readFileSync(new URL(`../data/${n}.json`,import.meta.url)));
const raw=read('dungeons'),dungeons=raw.map(correctDungeon),enemies=new Map(read('enemies').map(e=>[e.id,e]));
const presets=read('modifier-placements');

test('World-only relic positions agree with known map positions on every single-layer dungeon',()=>{
 const single=dungeons.filter(d=>d.mapImages.length===1);assert.equal(single.length,6);
 for(const d of single){
   const view=mapViews(d)[0];
   for(const p of d.enemies.filter(p=>p.mapPosition)){
     const actual=worldMapCoordinates(p.worldPosition,p.mapImageId,view,d),expected=mapCoordinates(p,view);
     assert.ok(actual?.every((v,i)=>Math.abs(v-expected[i])<1e-6),`${d.name}: ${p.placementId}`);
   }
   const [a,b]=d.enemies,mid=Object.fromEntries(['x','y'].map(k=>[k,(a.worldPosition[k]+b.worldPosition[k])/2]));
   const expected=[0,1].map(i=>(mapCoordinates(a,view)[i]+mapCoordinates(b,view)[i])/2);
   assert.ok(worldMapCoordinates(mid,view.id,view,d).every((v,i)=>Math.abs(v-expected[i])<1e-6));
 }
});

test('World-only overview coordinates stay unchanged and invalid layer calibration fails explicitly',()=>{
 for(const d of dungeons.filter(d=>d.mapImages.length>1))for(const p of d.enemies.filter(p=>p.mapPosition)){
   const view=mapViews(d)[0];
   assert.deepEqual(worldMapCoordinates(p.worldPosition,p.mapImageId,view,d),mapCoordinates({...p,placementId:undefined},view));
 }
 const d=dungeons.find(d=>d.name==="Cithrel's Fall"),view=mapViews(d)[0],p=d.enemies[0];
 assert.equal(worldMapCoordinates(p.worldPosition,'unknown',view,d),null);
 assert.equal(worldMapCoordinates({x:NaN,y:0},view.id,view,d),null);
 assert.equal(worldMapCoordinates(p.worldPosition,view.id,view,{...d,enemies:[p]}),null);
 const bad=structuredClone(d);bad.enemies[0].mapPosition.x+=0.1;
 assert.equal(worldMapCoordinates(p.worldPosition,view.id,view,bad),null);
});

test('Dragging an arrow on any overview maps back to its original layer',()=>{
  let checked=0;
  for(const dungeon of dungeons)for(const source of dungeon.mapImages)for(const view of mapViews(dungeon)){
    const drawing={mapId:source.id,kind:'line',points:[[source.width*.2,source.height*.3],[source.width*.7,source.height*.6]]};
    const projected=drawingOnMap(drawing,view,dungeon);if(!projected)continue;
    const moved=[projected.points[1][0]+25,projected.points[1][1]-40];
    const restored=drawingPointFromMap(moved,drawing,view,dungeon);
    const edited=drawingOnMap({...drawing,points:[drawing.points[0],restored]},view,dungeon);
    assert.deepEqual(edited.points[0],projected.points[0]);
    assert.ok(edited.points[1].every((v,i)=>Math.abs(v-moved[i])<1e-6));
    assert.equal(drawing.mapId,source.id);checked++;
  }
  assert.ok(checked>30);
});

test('Campfires project to their floor and both overviews without leaking across floors',()=>{
  assert.equal(campfireBuildId,read('manifest').buildId);
  assert.equal(Object.keys(campfires).length,dungeons.length);
  for(const dungeon of dungeons){
    const fires=campfires[dungeon.id],views=mapViews(dungeon);
    assert.ok(fires.length>0);
    for(const view of views){
      const result=mapCampfires(dungeon,view);
      assert.equal(result.length,view.sources?fires.length:fires.filter(p=>p.mapPosition&&p.mapImageId===view.id).length);
      assert.equal(new Set(result.map(p=>p.id)).size,result.length);
      for(const {point} of result){assert.ok(point.every(Number.isFinite));assert.ok(point[0]>=0&&point[0]<=view.width&&point[1]>=0&&point[1]<=view.height,`${dungeon.name} ${view.name}`);}
    }
    if(views[0].sources)assert.deepEqual(mapCampfires(dungeon,views[0]),mapCampfires(dungeon,views[1]));
  }
  const regath=dungeons.find(d=>d.id.endsWith('MoorCastle'));
  const chamberFire=campfires[regath.id].find(p=>p.mapImageId.endsWith('Chamber_01'));
  assert.ok(chamberFire.worldPosition);
  assert.ok(mapCampfires(regath,regath.mapImages.find(m=>m.id===chamberFire.mapImageId)).some(p=>p.id===chamberFire.id));
  assert.ok(mapCampfires(regath,mapViews(regath)[0]).some(p=>p.id===chamberFire.id));
});
test('Dungeon starts appear only on the entrance layer and full map, within image bounds',()=>{
  assert.equal(mapStartBuildId,read('manifest').buildId);
  assert.equal(Object.keys(mapStarts).length,dungeons.length);
  for(const d of dungeons){
    const start=mapStarts[d.id];
    assert.ok(d.mapImages.some(m=>m.id===start.mapImageId));
    for(const view of mapViews(d)){
      const point=mapStart(d,view);
      if(!view.sources&&view.id!==start.mapImageId){assert.equal(point,null);continue;}
      assert.ok(point?.every(Number.isFinite),d.name);
      assert.ok(point[0]>=0&&point[0]<=view.width&&point[1]>=0&&point[1]<=view.height,d.name);
    }
  }
  const sands=dungeons.find(d=>d.id.endsWith('DesertDunes'));
  const point=mapStart(sands,mapViews(sands)[0]);
  assert.deepEqual(point,mapCoordinates(mapStarts[sands.id],mapViews(sands)[0]));
  assert.deepEqual(mapStarts[sands.id].worldPosition,{x:-19960.4785,y:-47085.725,z:3056.746875});
  assert.equal(mapStart({id:'unknown'},mapViews(sands)[0]),null);
});
test('All nine multi-layer dungeons have a full view with every mapped enemy exactly once',()=>{
  let count=0;
  for(const d of dungeons){
    const views=mapViews(d),v=views[0];
    if(d.mapImages.length===1){assert.deepEqual(views,d.mapImages);continue;}
    count++;assert.ok(v.sources);assert.equal(views.length,d.mapImages.length+2);
    assert.equal(new Set(views.map(m=>m.id)).size,views.length);
    const ps=d.enemies.filter(p=>onMap(p,v));assert.equal(ps.length,d.enemies.filter(p=>p.mapPosition).length);
    for(const p of ps){const xy=mapCoordinates(p,v);assert.ok(xy.every(Number.isFinite),p.placementId);assert.ok(xy[0]>=0&&xy[0]<=v.width&&xy[1]>=0&&xy[1]<=v.height,`${d.name}: ${p.placementId}`);}
    for(const p of ps)for(const [i,pt]of (p.mapPatrolPath||[]).entries())if(onMap(pt,v))assert.ok(mapCoordinates({...pt,worldPosition:p.patrolPath[i]},v).every(Number.isFinite));
    const r=newRoute(d,'test');applyModifierPresets(r,d,presets);
    for(const kind of ['ghorn','witch'])if(r.modifiers[kind].packId){toggleModifier(r,kind,d);for(const p of effectivePositions(r,d).filter(p=>onMap(p,v)))assert.ok(mapCoordinates(p,v).every(Number.isFinite));toggleModifier(r,kind,d);}
  }
  assert.equal(count,9);
});
test('Game Sands uses world positions; original layers and saved annotations remain stable',()=>{
  const d=dungeons.find(d=>d.id.endsWith('DesertDunes')),views=mapViews(d),p=d.enemies.find(p=>p.id==='ub-bossarchbishop');
  const [x,y]=mapCoordinates(p,views[0]);assert.deepEqual([x,y],mapCoordinates({...p,placementId:undefined},views[0]));
  const rawPoint=mapCoordinates({...p,placementId:undefined},views[0]);assert.ok(Math.abs(rawPoint[0]-5099.662221818181)<.0001);assert.ok(Math.abs(rawPoint[1]-570.0224814545459)<.0001);
  const layer=views.find(m=>m.id===p.mapImageId),point=mapCoordinates(p,layer);
  assert.deepEqual(point,[p.mapPosition.x*layer.width,p.mapPosition.y*layer.height]);
  const drawing={id:'old',mapId:layer.id,kind:'note',points:[point],text:'Keep me'};
  assert.deepEqual(drawingOnMap(drawing,layer,d),drawing);
  const projected=drawingOnMap(drawing,views[0],d);assert.ok(Math.abs(projected.points[0][0]-rawPoint[0])<.0001);assert.ok(Math.abs(projected.points[0][1]-rawPoint[1])<.0001);
  assert.deepEqual(drawing.points,[point]);
  const route=newRoute(d,'test');route.drawings=[drawing,{...drawing,id:'full',mapId:views[0].id,points:[[x,y]]}];
  const imported=validateRoute(JSON.parse(JSON.stringify(route)),dungeons,enemies);assert.equal(imported.drawings.length,2);assert.deepEqual(imported.drawings.map(d=>d.points),route.drawings.map(d=>d.points));
});
test('Game Wraithtide captain follows world coordinates rather than a frozen marker override',()=>{
  const d=dungeons.find(d=>d.id.endsWith('PirateRaid')),p=d.enemies.find(p=>p.id==='pr-bosspiratecaptain');
  assert.deepEqual(mapCoordinates(p,mapViews(d)[0]),mapCoordinates({...p,placementId:undefined},mapViews(d)[0]));
  assert.notDeepEqual(mapCoordinates({...p,worldPosition:{...p.worldPosition,y:p.worldPosition.y+1000}},mapViews(d)[0]),mapCoordinates(p,mapViews(d)[0]));
});

test('Combined projects original layers, patrols and modifier members in its chosen frame',()=>{
  for(const d of dungeons.filter(d=>d.mapImages.length>1)){
    const views=mapViews(d),combined=views.find(v=>v.kind==='combined');
    assert.equal(views[0],combined);assert.equal(combined.name,'Full map');assert.equal(views[1].name,'Referenced');
    assert.equal(combined.referenceId,d.id);
    assert.deepEqual(new Set(Object.keys(combined.sources)),new Set(d.mapImages.map(m=>m.id)));
    for(const map of d.mapImages){
      const tile=combined.sources[map.id];assert.equal(tile.path,map.path);
      assert.ok(Math.abs(tile.width/tile.height-map.width/map.height)<.000001);
      // Source coordinates still project linearly even though artwork is now
      // masked and its decorative borders can fall outside the canvas.
      const drawing={id:'corners',mapId:map.id,kind:'line',points:[[0,0],[map.width,map.height]]};
      const expected=drawingOnMap(drawing,views[1],d)?.points||[[tile.x,tile.y],[tile.x+tile.width,tile.y+tile.height]];
      assert.deepEqual(drawingOnMap(drawing,combined,d).points,expected);
    }
    const project=p=>{
      const tile=combined.sources[p.mapImageId];
      assert.deepEqual(mapCoordinates(p,combined),combined.referenceId?mapCoordinates(p,views[1]):combined.placements?.[p.placementId]||[tile.x+p.mapPosition.x*tile.width,tile.y+p.mapPosition.y*tile.height]);
      const [x,y]=mapCoordinates(p,combined);
      assert.ok(x>=0&&x<=combined.width&&y>=0&&y<=combined.height,`${d.name}: point outside Combined`);
    };
    for(const p of d.enemies.filter(p=>onMap(p,combined))){
      project(p);
      for(const point of p.mapPatrolPath||[])if(onMap(point,combined))project(point);
    }
    const route=newRoute(d,'test');applyModifierPresets(route,d,presets);
    for(const kind of ['ghorn','witch'])if(route.modifiers[kind].packId){
      toggleModifier(route,kind,d);
      for(const p of effectivePositions(route,d).filter(p=>p.modifier&&onMap(p,combined))){
        const preset=presets.dungeons[d.id][p.modifier];
        assert.deepEqual(mapCoordinates(p,combined),mapCoordinates(preset,combined),'Native presets use the spawner point, including on stitched maps');
      }
      toggleModifier(route,kind,d);
    }
  }
});

test('Old tiled Combined drawings migrate to the same source locations on the stitched map',()=>{
  for(const d of dungeons.filter(d=>d.mapImages.length>1)){
    const old=legacyCombinedMap(d),current=mapViews(d).find(v=>v.kind==='combined'),route=newRoute(d,'test');
    const selected=d.enemies.filter(p=>p.mapPosition).slice(0,3);
    route.drawings=selected.map((p,i)=>({id:String(i),mapId:old.id,kind:'note',color:'#abcdef',text:`Note ${i}`,points:[mapCoordinates(p,old)]}));
    const imported=validateRoute(JSON.parse(JSON.stringify(route)),dungeons,enemies);
    for(const [i,drawing] of imported.drawings.entries()){
      assert.equal(drawing.mapId,current.id);assert.equal(drawing.text,`Note ${i}`);
      const p=selected[i],t=current.sources[p.mapImageId];
      const expected=[t.x+p.mapPosition.x*t.width,t.y+p.mapPosition.y*t.height];
      assert.ok(drawing.points[0].every((v,j)=>Math.abs(v-expected[j])<.000001));
    }
  }
});

test('Saved Full map and Referenced objects share both overviews without changing route data',()=>{
  const d=dungeons.find(d=>d.id.endsWith('DesertDunes')),[combined,full]=mapViews(d);
  const route=newRoute(d,'test');route.pulls[0].enemies=d.enemies.slice(0,10).map(p=>p.placementId);
  route.drawings=[{id:'own',kind:'line',color:'#abcdef',text:'',mapId:combined.id,points:[[100,150],[200,250]]},
    {id:'reference',kind:'note',color:'#abcdef',text:'Keep',mapId:full.id,points:[[500,600]]}];
  const imported=validateRoute(JSON.parse(JSON.stringify(route)),dungeons,enemies);
  assert.deepEqual(imported.drawings.map(({id,...drawing})=>drawing),route.drawings.map(({id,...drawing})=>drawing));
  assert.deepEqual(imported.pulls,route.pulls);
  assert.deepEqual(scoreRoute(imported,d,enemies),scoreRoute(route,d,enemies));
  assert.deepEqual(drawingOnMap(imported.drawings[0],combined,d),imported.drawings[0]);
  assert.deepEqual(drawingOnMap(imported.drawings[0],full,d),imported.drawings[0]);
  assert.deepEqual(drawingOnMap(imported.drawings[1],combined,d),imported.drawings[1]);
});

test('Objects created on either overview return to source layers and can be edited there',()=>{
  const close=(a,b)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-6),`${a} != ${b}`);
  for(const dungeon of dungeons.filter(d=>d.mapImages.length>1)){
    const overviews=mapViews(dungeon).filter(v=>v.sources);
    for(const layer of dungeon.mapImages)for(const overview of overviews)for(const kind of ['note','line','portal','invis']){
      const points=kind==='note'?[[layer.width*.5,layer.height*.5]]:[[layer.width*.4,layer.height*.4],[layer.width*.6,layer.height*.6]];
      const drawing={id:'shared',mapId:layer.id,kind,points,color:'#abcdef',text:'Shared'};
      const projected=drawingOnMap(drawing,overview,dungeon);
      if(!projected)continue; // Some corners of original artwork are outside the stitched canvas.
      const overviewDrawing={...projected,mapId:overview.id};
      const restored=drawingOnMap(overviewDrawing,layer,dungeon);
      assert.ok(restored,`${dungeon.id}: ${layer.id}`);
      restored.points.forEach((p,i)=>close(p,points[i]));
      const moved=points[0].map(v=>v+10);
      const stored=drawingPointFromMap(moved,overviewDrawing,layer,dungeon);
      const edited={...overviewDrawing,points:[stored,...overviewDrawing.points.slice(1)]};
      close(drawingOnMap(edited,layer,dungeon).points[0],moved);
      close(drawingOnMap(edited,overviews.find(v=>v!==overview),dungeon).points[0],stored);
      assert.deepEqual(drawing.points,points);
    }
  }
});

test('Layer visibility hides outside objects but keeps crossing lines and reversible off-map edits',()=>{
  const dungeon=dungeons.find(d=>d.id.endsWith('DesertDunes'));
  const overview=mapViews(dungeon)[0],layer=dungeon.mapImages[0];
  const anchor={mapId:overview.id};
  const toOverview=p=>drawingPointFromMap(p,anchor,layer,dungeon);
  const note={...anchor,kind:'note',points:[toOverview([-100,layer.height*.5])]};
  assert.equal(drawingOnMap(note,layer,dungeon),null);
  for(const kind of ['line','portal','invis']){
    const across={...anchor,kind,points:[[-100,layer.height*.5],[layer.width+100,layer.height*.5]].map(toOverview)};
    assert.ok(drawingOnMap(across,layer,dungeon));
    const outside={...across,points:[[-100,-100],[layer.width+100,-100]].map(toOverview)};
    assert.equal(drawingOnMap(outside,layer,dungeon),null);
    assert.ok(drawingPointFromMap([-500,-500],outside,layer,dungeon).every(Number.isFinite));
  }
});
test('Duplicate boss placements migrate to one encounter, including old selections and exclusions',()=>{
  for(const [id,aliases]of Object.entries(placementAliases)){
    const d=dungeons.find(d=>d.id===id),original=raw.find(d=>d.id===id),[old,current]=Object.entries(aliases)[0];
    assert.equal(d.enemies.length,original.enemies.length);assert.ok(!effectivePositions(newRoute(d,'test'),original).some(p=>p.placementId===old));
    const route=newRoute(d,'test');route.pulls[0].enemies=[old];route.pulls.push({...newPull(1),enemies:[current]});
    const imported=validateRoute(route,dungeons,enemies);assert.deepEqual(imported.pulls.flatMap(p=>p.enemies),[current]);assert.equal(scoreRoute(imported,d,enemies).bosses,1);assert.equal(scoreRoute(route,original,enemies).bosses,1);
    route.excluded=[old];assert.deepEqual(validateRoute(route,dungeons,enemies).excluded,[]);assert.equal(scoreRoute(route,original,enemies).bosses,1);
    route.pulls[1].enemies=[old];assert.throws(()=>validateRoute(route,dungeons,enemies),/multiple pulls/);
  }
});
