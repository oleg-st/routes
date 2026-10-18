import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {separateMarkerCenters} from '../map-geometry.js';
import {enemyMarkerRadius} from '../data/enemy-marker-sizes.js';
import {markerAnchor} from '../data/marker-anchors.js';
import {mapViews,mapCoordinates} from '../map-views.js';

test('Sinnari portrait uses its centered overview anchor without changing source coordinates',()=>{
  const boss={placementId:'placement-2f08a0644a58616a92aee8c52e26e64e6160054dba296541b472deed07cee715',worldPosition:{x:17150.752,y:18276.22,z:3470.7163}};
  const original=structuredClone(boss),full={id:'Level.ID.DesertDunes:Full'};
  const point=markerAnchor(boss,full);
  assert.ok(Math.abs(point[0]-5146.222222222221)<1e-6);
  assert.ok(Math.abs(point[1]-524.6797770358662)<1e-6);
  assert.deepEqual(markerAnchor(boss,{id:'Level.ID.DesertDunes:Combined-v4',referenceId:'Level.ID.DesertDunes'}),point);
  assert.equal(markerAnchor(boss,{id:'Level.ID.DesertDunes:T_Map_DesertDunes_End'}),null);
  assert.equal(markerAnchor(boss,{id:'Level.ID.UrrakMarkets:Full'}),null);
  assert.equal(markerAnchor({placementId:'other'},full),null);
  assert.deepEqual(boss,original);
});

test('Game Vexira keeps her portrait inside the lair on both overviews without moving game coordinates',()=>{
  const dungeon=JSON.parse(fs.readFileSync(new URL('../data/dungeons.json',import.meta.url))).find(d=>d.id==='Level.ID.SpiderForest');
  const boss=dungeon.enemies.find(p=>p.placementId==='placement-custom-silken-vexira');
  assert.ok(boss.gameGuid);
  const original=structuredClone(boss),views=mapViews(dungeon);
  for(const view of views.filter(v=>v.sources)){
    const worldPoint=mapCoordinates(boss,view),point=markerAnchor(boss,view);
    assert.deepEqual(point,[3257.1428571428573,271.2365388960006]);
    assert.ok(worldPoint[1]>600,'The game spawn projection reproduces the below-lair regression');
    assert.deepEqual(mapCoordinates(boss,view),worldPoint,'Display anchors must not alter log/world projection');
    for(const mob of dungeon.enemies.filter(p=>p!==boss))assert.equal(markerAnchor(mob,view),null);
  }
  for(const view of dungeon.mapImages)assert.equal(markerAnchor(boss,view),null);
  assert.equal(markerAnchor(boss,{id:'Level.ID.DesertDunes:Full'}),null);
  assert.deepEqual(boss,original);
});

test('small overlaps stay in place and deeper overlaps stop at 25% of the smaller diameter',()=>{
  const slight=[{id:'a',point:[0,0],radius:10},{id:'b',point:[16,0],radius:10}];
  const unchanged=separateMarkerCenters(slight,0,.25);
  for(const marker of slight)assert.deepEqual(unchanged.get(marker.id),marker.point);
  for(const radii of [[10,10],[10,30]]){
    const markers=[{id:'a',point:[0,0],radius:radii[0]},{id:'b',point:[5,0],radius:radii[1]}];
    const result=separateMarkerCenters(markers,0,.25),a=result.get('a'),b=result.get('b');
    const depth=radii[0]+radii[1]-Math.hypot(a[0]-b[0],a[1]-b[1]);
    assert.ok(Math.abs(depth/(2*Math.min(...radii))-.25)<1e-8);
  }
});

test('marker radius grows continuously across zoom levels, including the former 1.5 threshold',()=>{
  for(const portraits of [true,false])for(const size of [4,6,12]){
    const base=enemyMarkerRadius(size,1,portraits);
    assert.equal(base,size+(portraits?3:0));
    const zooms=[.4,.7,1,1.4999,1.5,1.5001,2,4,8,12,16,24];
    const radii=zooms.map(zoom=>enemyMarkerRadius(size,zoom,portraits));
    for(let i=1;i<radii.length;i++){
      assert.ok(radii[i]>radii[i-1]);
      assert.ok(radii[i]/radii[i-1]<zooms[i]/zooms[i-1],'icons grow more slowly than map geometry');
    }
    assert.ok(radii.at(-1)/radii[9]>1.4,'icons keep growing between zoom 12 and 24');
    assert.ok(Math.abs(radii[5]-radii[3])/base<.001,'no sudden size jump at zoom 1.5');
  }
});

test('adjacent boss portraits separate without moving their encounter center or source placements',()=>{
  const markers=[{id:'a',point:[0,0],radius:40},{id:'b',point:[10,0],radius:40}];
  const original=structuredClone(markers),result=separateMarkerCenters(markers,6);
  assert.deepEqual(result.get('a'),[-38,0]);
  assert.deepEqual(result.get('b'),[48,0]);
  assert.deepEqual(markers,original);
});

test('coincident bosses remain finite and isolated bosses stay at their source position',()=>{
  const result=separateMarkerCenters([
    {id:'a',point:[0,0],radius:40},{id:'b',point:[0,0],radius:40},
    {id:'c',point:[0,0],radius:40},{id:'isolated',point:[1000,1000],radius:40},
  ],6);
  assert.deepEqual(result.get('isolated'),[1000,1000]);
  const near=['a','b','c'].map(id=>result.get(id));
  for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++)
    assert.ok(Math.hypot(near[i][0]-near[j][0],near[i][1]-near[j][1])>=85.999);
  assert.ok(Math.abs(near.reduce((sum,p)=>sum+p[0],0))<1e-8);
});

test('mixed-size packs separate consistently regardless of input order',()=>{
  const markers=Array.from({length:12},(_,i)=>({id:`mob-${i}`,point:[i%4*14,Math.floor(i/4)*14],radius:[9,12,15][i%3]}));
  const original=structuredClone(markers),result=separateMarkerCenters(markers,5);
  assert.deepEqual(result,separateMarkerCenters([...markers].reverse(),5));
  assert.deepEqual(markers,original);
  for(let i=0;i<markers.length;i++)for(let j=i+1;j<markers.length;j++){
    const a=result.get(markers[i].id),b=result.get(markers[j].id);
    assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])>=markers[i].radius+markers[j].radius+5-.01);
  }
});

test('dense overviews respect displacement limits and zooming in restores source positions',()=>{
  const markers=Array.from({length:25},(_,i)=>({id:`mob-${i}`,point:[i%5*4,Math.floor(i/5)*4],radius:10,maxDisplacement:20}));
  const result=separateMarkerCenters(markers,5);
  for(const marker of markers){
    const point=result.get(marker.id);
    assert.ok(Math.hypot(point[0]-marker.point[0],point[1]-marker.point[1])<=20.00001);
  }
  const zoomed=markers.map(marker=>({...marker,radius:1}));
  const detail=separateMarkerCenters(zoomed,.5);
  for(const marker of zoomed)assert.deepEqual(detail.get(marker.id),marker.point);
  assert.deepEqual(result,separateMarkerCenters(markers,5),'returning to the same zoom restores the same layout');
});

test('a bounded solve returns every dense marker deterministically without changing source positions',()=>{
  const markers=Array.from({length:1000},(_,i)=>({id:`mob-${i}`,point:[i%20,Math.floor(i/20)],radius:10,maxDisplacement:40}));
  const original=structuredClone(markers),options={maxChecks:5000,tolerance:.02};
  const result=separateMarkerCenters(markers,0,.25,options);
  assert.equal(result.size,markers.length);
  assert.deepEqual(result,separateMarkerCenters([...markers].reverse(),0,.25,options));
  assert.deepEqual(markers,original);
  for(const marker of markers){
    const [x,y]=result.get(marker.id);
    assert.ok(Number.isFinite(x)&&Number.isFinite(y));
    assert.ok(Math.hypot(x-marker.point[0],y-marker.point[1])<=40.00001);
  }
  const untouched=separateMarkerCenters(markers,0,.25,{maxChecks:0});
  for(const marker of markers)assert.deepEqual(untouched.get(marker.id),marker.point);
});
