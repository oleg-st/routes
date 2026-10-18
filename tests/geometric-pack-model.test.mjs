import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {correctDungeon} from '../data/placement-corrections.js';
import {inferGeometricPacks,pathCovered} from '../scripts/geometric-pack-model.mjs';
import {sharedPatrolMotionBounds} from '../scripts/shared-patrol-motion.mjs';
const point=(x,y=0,z=0)=>({x,y,z});
const mob=(id,x,extra={})=>({id,position:point(x),path:[],inactive:false,radius:1000,...extra});
const signature=r=>r.groups.map(g=>g.toSorted().join(',')).sort();
test('Geometric packs follow 3D chains and ignore arbitrary source pack labels',()=>{
  const mobs=[mob('a',0),mob('b',800),mob('c',1600),mob('high',0,{position:point(0,0,1500)})];
  assert.deepEqual(signature(inferGeometricPacks(mobs)),['a,b,c','high']);
  assert.deepEqual(signature(inferGeometricPacks(mobs.map((p,i)=>({...p,packId:'pack-'+i})))),signature(inferGeometricPacks(mobs)));
});
test('The emitting radius produces a one-way pull, not a mutual pack',()=>{
  const result=inferGeometricPacks([mob('lookout',0,{radius:2000}),mob('ordinary',1500)]);
  assert.deepEqual(signature(result),['lookout','ordinary']);
  assert.deepEqual(result.oneWayLinks,[{a:'lookout',b:'ordinary'}]);
});
test('Inactive mobs cannot bridge active groups and are still represented',()=>{
  const result=inferGeometricPacks([mob('a',0),mob('buried',800,{inactive:true}),mob('b',1600)]);
  assert.deepEqual(signature(result),['a','b','buried']);
});
test('A departing patrol separates even when it is close at spawn',()=>{
  const mobs=[mob('fixed',0),mob('patrol',500,{path:[point(500),point(2500)]})];
  assert.deepEqual(signature(inferGeometricPacks(mobs,{persistent:false})),['fixed,patrol']);
  assert.deepEqual(signature(inferGeometricPacks(mobs)),['fixed','patrol']);
});
test('Shared-path formation is an explicit hypothesis with an independent-phase alternative',()=>{
  const path=[point(0),point(5000)],mobs=[mob('a',0,{path}),mob('b',100,{path})];
  assert.deepEqual(signature(inferGeometricPacks(mobs)),['a,b']);
  assert.deepEqual(signature(inferGeometricPacks(mobs,{synchronizeSharedPaths:false})),['a','b']);
});

test('Equal travel along a bend can separate nearby mobs without independent phases',()=>{
  const path=[point(0),point(2000),point(2000,2000)];
  const mobs=[mob('a',1400,{path}),mob('b',2000,{position:point(2000,600),path})];
  const motion=sharedPatrolMotionBounds(path,mobs[0].position,mobs[1].position);
  assert.equal(motion.alongPathSeparation,1200);
  assert.equal(motion.maxDistance,1200);
  assert.deepEqual(signature(inferGeometricPacks(mobs)),['a,b']);
  const split=inferGeometricPacks(mobs,{sharedPathArcOffsets:true});
  assert.deepEqual(signature(split),['a','b']);
  assert.equal(split.assumptions[0].type,'shared-path-fixed-arc-offsets');
  assert.deepEqual(signature(inferGeometricPacks(mobs.map(m=>({...m,radius:1200})),{sharedPathArcOffsets:true})),['a,b']);
});

test('Shared-path travel preserves straight formations and the vertical constraint',()=>{
  const path=[point(0),point(0),point(5000)];
  const mobs=[mob('a',100,{path}),mob('b',200,{position:point(200,100,300),path})];
  const motion=sharedPatrolMotionBounds(path,mobs[0].position,mobs[1].position);
  assert.ok(Math.abs(motion.maxDistance-Math.sqrt(110000))<1e-8);
  assert.deepEqual(signature(inferGeometricPacks(mobs,{sharedPathArcOffsets:true})),['a,b']);
  assert.deepEqual(signature(inferGeometricPacks(mobs,{sharedPathArcOffsets:true,verticalLimit:250})),['a','b']);
  assert.equal(sharedPatrolMotionBounds([point(0),point(0)],point(0),point(1)),null);
  assert.equal(sharedPatrolMotionBounds([point(0),{x:1}],point(0),point(1)),null);
});

test('Observed together Urrak plaza patrol and compact Sands patrols stay together',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../data/dungeons.json',import.meta.url),'utf8'));
  // User observations on 2026-10-18: the Urrak plaza circuit and the compact
  // Sands patrols move together. These IDs select controls, never model inputs.
  const cases=[
    ['UrrakMarkets','G21','placement-f9aabb886c5c3ef5d4bc4bb7b22725e25dd1f75e4a34cf3bd3451974e23873d9',3],
    ['DesertDunes','G16','placement-735293bb508989aea4a1e634b148440efc096d92e3bb54e4ac1440fb2e6565b6',5],
    ['DesertDunes','G31','placement-7ed3f8936b741cdf0ef0854ede6f8d8790d6f0435506fa435017a7a3e1616a98',2],
    ['DesertDunes','G43','placement-3a84285bc8073601c0e1797ca571c7bd0146ee33ec7d2188b18734fea54429c5',3],
    ['DesertDunes','G44','placement-fec185fbbb9761ce91cb41666d1affe3defde8d72471db07b27e047ca54be471',4],
  ];
  for(const [dungeon,label,anchor,size]of cases){
    const d=correctDungeon(raw.find(d=>d.id==='Level.ID.'+dungeon),'custom');
    const first=d.enemies.find(p=>p.placementId===anchor);
    assert.ok(first,`${dungeon} ${label}: anchor exists`);
    const members=d.enemies.filter(p=>p.packId===first.packId);
    assert.equal(members.length,size,`${dungeon} ${label}: expected control membership`);
    assert.ok(members.every(p=>p.patrolPath?.length>1));
    // Production members carry distinct column paths; synchronization is covered
    // by game-patrol-model.test.mjs, not the retired shared-path approximation.
    assert.ok(members.every(p=>p.gameGuid));
  }
});
test('Continuous coverage finds gaps between path vertices and obeys the vertical cap',()=>{
  const path=[point(0),point(1000)];
  assert.equal(pathCovered(path,[{point:point(0),radius:400},{point:point(1000),radius:400}]),false);
  assert.equal(pathCovered(path,[{point:point(0),radius:500},{point:point(1000),radius:500}]),true);
  assert.equal(pathCovered(path,[{point:point(500,0,300),radius:1000}],250),false);
});
test('A connected stationary group covers a patrol through changing nearest members',()=>{
  const mobs=[mob('left',0),mob('right',800),mob('patrol',-900,{path:[point(-900),point(1700)]})];
  assert.deepEqual(signature(inferGeometricPacks(mobs)),['left,patrol,right']);
});
test('Incomplete paths cannot create persistent links',()=>{
  const mobs=[mob('a',0),mob('b',100,{path:[point(100),{x:200,y:0}]})];
  assert.deepEqual(signature(inferGeometricPacks(mobs)),['a','b']);
  assert.deepEqual(inferGeometricPacks(mobs).invalid,['b']);
});
