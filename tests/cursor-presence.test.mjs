import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCursorPresence,validCursor,projectCursor} from '../collaboration/cursor-presence.js';
import {mapViews} from '../map-views.js';
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
test('Cursor updates coalesce to 20 per second, heartbeat, retain idle positions and remove departed peers without stale replay',()=>{
  let clock=0;const sent=[],changes=[],presence=createCursorPresence({now:()=>clock,intervalMs:0,send:p=>sent.push(p),onChange:p=>changes.push(p)});
  for(clock=0;clock<1000;clock++)presence.set({mapId:'map',x:clock,y:1});assert.equal(sent.length,20);clock=1000;presence.tick();assert.equal(sent.at(-1).x,999);
  clock=2000;presence.tick();assert.equal(sent.at(-1).x,999);presence.set(null);clock=2050;presence.tick();assert.equal(sent.at(-1).visible,false);
  assert.equal(presence.receive('peer',{sequence:4,visible:true,mapId:'map',x:1,y:2}),true);assert.equal(presence.receive('peer',{sequence:3,visible:false}),false);
  clock+=60000;presence.tick();assert.equal(presence.values().length,1);assert.equal(presence.values()[0].x,1);assert.equal(presence.receive('peer',{sequence:4,visible:true}),false);
  presence.remove('peer');assert.equal(presence.values().length,0);
  presence.dispose();const count=sent.length;clock+=2000;presence.tick();assert.equal(sent.length,count);
});
test('Cursor validation rejects unknown maps, non-finite and out-of-map coordinates',()=>{
  const dungeon=dungeons[0],map=mapViews(dungeon)[0],cursor={sequence:1,visible:true,mapId:map.id,x:1,y:2};validCursor(cursor,dungeon);
  for(const patch of [{mapId:'foreign'},{x:NaN},{y:Infinity},{x:-1},{x:map.width+1},{sequence:-1}])assert.throws(()=>validCursor({...cursor,...patch},dungeon));
});
test('Cursor projection follows map coordinates and never projects between unrelated floors',()=>{
  for(const dungeon of dungeons){const views=mapViews(dungeon),overview=views.find(v=>v.sources),layers=views.filter(v=>!v.sources);
    for(const layer of layers){const cursor={visible:true,mapId:layer.id,x:layer.width/2,y:layer.height/2};assert.deepEqual(projectCursor(cursor,layer,dungeon),[cursor.x,cursor.y]);
      if(overview){const xy=projectCursor(cursor,overview,dungeon);if(xy){const back=projectCursor({visible:true,mapId:overview.id,x:xy[0],y:xy[1]},layer,dungeon);assert.ok(Math.abs(back[0]-cursor.x)<1e-5&&Math.abs(back[1]-cursor.y)<1e-5);}}
      for(const other of layers)if(other.id!==layer.id)assert.equal(projectCursor(cursor,other,dungeon),null);
    }
  }
});
