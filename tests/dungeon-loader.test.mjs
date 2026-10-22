import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDungeonLoader} from '../data/dungeon-loader.js';
import {decodeRoute,encodeRoute,newRoute} from '../route-model.js';

test('Dungeon geometry loads on demand, shares concurrent requests and expands patrols once',async()=>{
  const catalogue=[{id:'a',name:'A',dataURL:'a.json'},{id:'b',name:'B',dataURL:'b.json'}];
  const calls=[],patrol=[[1,2,3]],mapPatrol=[{mapImageId:'map',mapPosition:[4,5]}];let transformations=0;
  const load=createDungeonLoader(catalogue,d=>{transformations++;return {...d,prepared:true};},async url=>{
    calls.push(url);return {ok:true,json:async()=>({id:'a',mapImages:[],enemies:[{patrolIndex:0}],sharedPatrols:[[patrol,mapPatrol]]})};
  });
  assert.deepEqual(calls,[]);
  const [first,second]=await Promise.all([load('a'),load('a')]);
  assert.equal(first,second);assert.equal(await load('a'),first);
  assert.deepEqual(calls,['a.json']);assert.equal(transformations,1);
  assert.deepEqual(first.enemies,[{patrolPath:patrol,mapPatrolPath:mapPatrol}]);
  assert.equal(catalogue[0],first);assert.equal(catalogue[1].enemies,undefined);
  await assert.rejects(load('unknown'),/not available/);assert.deepEqual(calls,['a.json']);
});

test('Failed or mismatched dungeon responses leave the catalogue intact and allow retry',async()=>{
  const entry={id:'a',name:'A',dataURL:'a.json'},catalogue=[entry];let attempt=0;
  const load=createDungeonLoader(catalogue,undefined,async()=>{
    attempt++;return {ok:attempt!==1,json:async()=>({id:attempt===2?'b':'a',enemies:[],mapImages:[]})};
  });
  await assert.rejects(load('a'),/Unable to load A/);assert.equal(catalogue[0],entry);
  await assert.rejects(load('a'),/Invalid dungeon/);assert.equal(catalogue[0],entry);
  assert.equal((await load('a')).id,'a');assert.equal(attempt,3);
});

test('Route imports load only their dungeon before decoding placement references',async()=>{
  const originals=JSON.parse(fs.readFileSync('data/dungeons.json'));
  const target=originals.find(d=>d.id==='Level.ID.TreeVillage');
  const route=newRoute(target,target.routeBuildId??'test');route.pulls[0].enemies=target.enemies.slice(0,3).map(p=>p.placementId);
  const text=await encodeRoute(route,target),catalogue=originals.map(({id,name})=>({id,name,dataURL:id})),calls=[];
  const load=createDungeonLoader(catalogue,undefined,async id=>{calls.push(id);return {ok:true,json:async()=>originals.find(d=>d.id===id)};});
  const restored=await decodeRoute(text,catalogue,undefined,load);
  assert.deepEqual(restored.pulls[0].enemies,route.pulls[0].enemies);
  assert.deepEqual(calls,[target.id]);assert.equal(catalogue.filter(d=>d.enemies).length,1);
});
