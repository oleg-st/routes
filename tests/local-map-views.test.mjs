import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapViews} from '../local-map-views.js';
import {mapViews as baseMapViews,mapCoordinates,drawingOnMap,mapCampfires,mapStart} from '../map-views.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {newRoute,validateRoute} from '../route-model.js';

const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json','utf8')).map(correctDungeon);
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json','utf8')).map(enemy=>[enemy.id,enemy]));
test('Active local retouched backgrounds preserve coordinates and portable route IDs',()=>{
  let count=0;
  for(const dungeon of dungeons){
    const base=baseMapViews(dungeon),views=mapViews(dungeon);
    if(base[0].kind!=='combined'){assert.deepEqual(views,base);continue;}
    count++;
    const [ours,retouched,reference]=views;
    assert.deepEqual(views.map(view=>view.name).slice(0,3),['Full map','Full map · Retouched','Referenced']);
    assert.deepEqual(views.slice(2),base.slice(1));
    assert.equal(ours.path,base[0].path);
    assert.equal(retouched.id,ours.id);
    assert.equal(retouched.width,ours.width);assert.equal(retouched.height,ours.height);
    assert.ok(fs.existsSync(retouched.path),retouched.path);
    const encoded=fs.readFileSync(retouched.path);
    assert.equal(encoded.toString('ascii',4,8),'ftyp');
    assert.ok(encoded.subarray(8,40).includes(Buffer.from('avif')));
    for(const enemy of dungeon.enemies.filter(enemy=>enemy.mapPosition))assert.deepEqual(mapCoordinates(enemy,retouched),mapCoordinates(enemy,ours));
    assert.deepEqual(mapCampfires(dungeon,retouched),mapCampfires(dungeon,ours));
    assert.deepEqual(mapStart(dungeon,retouched),mapStart(dungeon,ours));
    const route=newRoute(dungeon,dungeon.routeBuildId??'test');
    route.drawings=[{id:'retouch-note',mapId:retouched.id,kind:'note',points:[[100,100]],color:'#abcdef',text:'Portable'}];
    const imported=validateRoute(route,dungeons,enemies);
    assert.deepEqual(drawingOnMap(imported.drawings[0],base[0],dungeon).points,[[100,100]]);
    assert.deepEqual(drawingOnMap(imported.drawings[0],reference,dungeon).points,[[100,100]]);
  }
  assert.equal(count,5);
});
