import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {encodeRoute,decodeRoute} from '../route-model.js';
import {newRoute,newPull,applyModifierPresets,validateRoute} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {mapViews} from '../map-views.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url)));
const dungeons=read('dungeons').map(correctDungeon),enemies=new Map(read('enemies').map(e=>[e.id,e]));
const presets=read('modifier-placements');
const content=route=>JSON.parse(JSON.stringify(route,(key,value)=>key==='id'?undefined:value));
const pack=payload=>'R1.'+deflateRawSync(JSON.stringify(payload)).toString('base64url');
const unpack=text=>JSON.parse(inflateRawSync(Buffer.from(text.slice(3),'base64url')));

test('Compact routes preserve all content in every dungeon, with exact coordinates and Unicode',async()=>{
  let oldSize=0,newSize=0;
  for(const dungeon of dungeons){
    const route=newRoute(dungeon,'25647984','Маршрут 🐉 #?&%');
    applyModifierPresets(route,dungeon,presets);
    route.shadow=true;
    for(const modifier of Object.values(route.modifiers))if(modifier.packId||modifier.enemies?.length)modifier.active=true;
    route.pulls=Array.from({length:12},(_,i)=>newPull(i));
    dungeon.enemies.forEach((enemy,i)=>route.pulls[i%12].enemies.push(enemy.placementId));
    for(const kind of ['ghorn','witch'])if(route.modifiers[kind].packId)route.pulls[0].enemies.push(`modifier:${kind}`);
    route.pulls[0].name='Pull 1';route.pulls[0].customName=true;
    route.pulls[1].name='Босс';route.pulls[1].customName=true;route.pulls[1].color='#abcdef';
    route.pulls[2].note='Строка 1\nСтрока 2 <keep> #?&%';
    route.excluded=dungeon.enemies.filter(e=>!enemies.get(e.id)?.isBoss).slice(0,3).map(e=>e.placementId);
    route.drawings=['line','portal','invis','note'].map((kind,i)=>({
      id:`drawing-${i}`,mapId:mapViews(dungeon)[0].id,kind,color:'#bc78f5',text:kind==='note'?'Заметка 🐉':'',
      ...(kind==='line'?{width:5}:{}),points:kind==='note'?[[1.123456789,2.987654321]]:[[1.123456789,2.987654321],[300.123456,400.987654]],
    }));
    const encoded=await encodeRoute(route,dungeon),decoded=await decodeRoute(encoded,dungeons,enemies);
    assert.match(encoded,/^R1\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(content(decoded),content(validateRoute(route,dungeons,enemies)));
    assert.notEqual(decoded.id,route.id);
    assert.notEqual(decoded.pulls[0].id,route.pulls[0].id);
    assert.equal(await encodeRoute(decoded,dungeon),encoded);
    oldSize+=JSON.stringify(route).length;newSize+=encoded.length;
    // Array order in public data must not affect placement/pack indexes.
    const reordered={...dungeon,enemies:[...dungeon.enemies].reverse()};
    assert.deepEqual(content(await decodeRoute(encoded,[reordered],enemies)),content(decoded));
  }
  assert.ok(newSize<oldSize*.15,`${oldSize} → ${newSize}`);
  console.log(`Full routes: ${oldSize} → ${newSize} characters (${(100*(1-newSize/oldSize)).toFixed(1)}% smaller)`);
});

test('Minimal/empty routes and both Share forms round-trip',async()=>{
  const dungeon=dungeons[0],route=newRoute(dungeon,'25647984');
  for(const pulls of [route.pulls,[]]){
    route.pulls=pulls;
    const text=await encodeRoute(route,dungeon);
    assert.ok(text.length<150);
    for(const input of [text,` \n${text}\n `,`#route=${text}`,`https://example.com/#route=${text}`,`file:///C:/planner/local.html#route=${text}`]){
      assert.deepEqual(content(await decodeRoute(input,dungeons,enemies)),content(route));
    }
  }
});

test('Invalid data, duplicate placements, changed datasets and decompression bombs are rejected',async()=>{
  const dungeon=dungeons[0],route=newRoute(dungeon,'25647984');
  route.pulls[0].enemies=[dungeon.enemies[0].placementId];
  const text=await encodeRoute(route,dungeon);
  for(const input of ['',JSON.stringify(route),`#route=${encodeURIComponent(JSON.stringify(route))}`,'R1.','R1.a','R1.***',text.slice(0,-8),'#route=%ZZ','https://example.com/']){
    await assert.rejects(decodeRoute(input,dungeons,enemies));
  }
  const changed={...dungeon,enemies:dungeon.enemies.slice(1)};
  await assert.rejects(decodeRoute(text,[changed],enemies),/different enemy dataset/);
  for(const edit of [p=>p[4][0][0].push(p[4][0][0][0]),p=>p[4][0][0].push(-1),p=>p[4][0][0].push(999999),p=>p[4][0][0].push('0'),p=>p[4]=null,p=>p[8]=2]){
    const payload=unpack(text);edit(payload);await assert.rejects(decodeRoute(pack(payload),dungeons,enemies));
  }
  const bomb='R1.'+deflateRawSync(Buffer.alloc(3_000_001,32)).toString('base64url');
  await assert.rejects(decodeRoute(bomb,dungeons,enemies),/too large/);
});

test('R2 preserves marker labels and multi-vertex geometry while creating independent IDs',async()=>{
  const dungeon=dungeons[0],route=newRoute(dungeon,'25647984'),mapId=mapViews(dungeon)[0].id;
  route.drawings=[{id:'path',mapId,kind:'line',color:'#abcdef',width:5,text:'',points:[[10,20],[30,70],[90,40]],pointIds:['a','b','c']},
    {id:'note',mapId,kind:'note',color:'#aabbcc',text:'Заметка 🐉 '.repeat(100),points:[[20,30]]}];
  route.markers=[{id:'marker',mapId,position:[12.345678,45.6789],color:'#bbaa11',icon:'star',label:'Встречаемся здесь 🐉'}];
  const encoded=await encodeRoute(route,dungeon);assert.match(encoded,/^R2\./);
  for(const input of [encoded,'#route='+encoded,'https://example.com/planner/#route='+encoded]){
    const copy=await decodeRoute(input,dungeons,enemies);
    assert.deepEqual(copy.drawings[0].points,route.drawings[0].points);assert.equal(copy.drawings[1].text,route.drawings[1].text);
    assert.deepEqual(content(copy.markers),content(route.markers));assert.notEqual(copy.markers[0].id,'marker');assert.notEqual(copy.drawings[0].id,'path');
    assert.equal(await encodeRoute(copy,dungeon),encoded);
  }
  const corrupt=unpack(encoded);corrupt[9][0][1]=[NaN,0];
  await assert.rejects(decodeRoute('R2.'+pack(corrupt).slice(3),dungeons,enemies),/marker position/);
});
