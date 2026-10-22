import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {mapViews,worldMapImage,worldMapCoordinates} from '../map-views.js';
import {compactPublicData} from '../scripts/compact-public-data.mjs';

const layer=(suffix,z)=>({id:'Level.ID.Future:'+suffix,name:suffix,path:'images/'+suffix+'.avif',width:2048,height:1024,
  gameFrame:{bounds:[{x:0,y:0,z},{x:100,y:200,z:z+50}],calibration:{sx:200,sy:-100,ox:0,oy:100}}});
test('New single and stacked maps project world-only log points without Full or enemy samples',()=>{
  const a=layer('a',0),b=layer('b',100),d={id:'Level.ID.Future',mapImages:[a,b],enemies:[]};
  const world={x:25,y:100,z:125};
  assert.equal(worldMapImage(world,d).id,b.id);
  assert.equal(worldMapImage({x:25,y:100},d),null,'Overlapping floors need height or a name');
  assert.equal(worldMapImage(world,d,'a').id,b.id,'Current bounds override an incorrect floor name');
  assert.deepEqual(worldMapCoordinates(world,b.id,b,d),[1024,768]);
  const combined={kind:'combined',width:8000,height:5000,sources:{[b.id]:{x:400,y:200,width:4096,height:2048}}};
  assert.deepEqual(worldMapCoordinates(world,b.id,combined,d),[2448,1736]);
  assert.equal(worldMapCoordinates(world,'unknown',combined,d),null);
  const single={...d,mapImages:[a]};assert.deepEqual(mapViews(single),[a]);
  assert.deepEqual(worldMapCoordinates(world,a.id,a,single),[1024,768]);
});
test('Site compaction preserves native floor bounds and calibration',t=>{
  const parent=path.resolve('tmp/new-map-tests');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'case-'));fs.mkdirSync(path.join(root,'data'));
  t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const map=layer('a',0);
  for(const [name,value]of Object.entries({dungeons:[{id:'Level.ID.Future',name:'Future',mapImages:[map],enemies:[]}],enemies:[],abilities:[]}))
    fs.writeFileSync(path.join(root,'data',name+'.json'),JSON.stringify(value));
  compactPublicData(root);
  const [d]=JSON.parse(fs.readFileSync(path.join(root,'data/dungeons.json')));
  assert.deepEqual(d.mapImages[0].gameFrame,map.gameFrame);
  assert.deepEqual(worldMapCoordinates({x:25,y:100},map.id,d.mapImages[0],d),[1024,768]);
});
