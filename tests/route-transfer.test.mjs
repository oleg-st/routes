import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {encodeRoute,decodeRoute} from '../route-model.js';
import {newRoute,newPull,applyModifierPresets,validateRoute} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {mapViews} from '../map-views.js';
import {modifierAvailable} from '../game-scoring.js';
import {routeDictionary} from '../data/route-dictionary.js';
import {difficultyOptions} from '../difficulty.js';
import {hasRouteChanges} from '../route-model.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url)));
const dungeons=read('dungeons').map(correctDungeon),enemies=new Map(read('enemies').map(e=>[e.id,e]));
const presets=read('modifier-placements');
const content=route=>JSON.parse(JSON.stringify(route,(key,value)=>key==='id'?undefined:value));
const pack=(payload,prefix='R3.')=>prefix+deflateRawSync(JSON.stringify(payload)).toString('base64url');
const unpack=text=>JSON.parse(inflateRawSync(Buffer.from(text.slice(3),'base64url')));

test('Priority targets survive JSON and compact exports with and without difficulty',async()=>{
  for(const dungeon of dungeons){
    for(const difficulty of [undefined,difficultyOptions(dungeon.id)[0]?.value]){
      const route=newRoute(dungeon,dungeon.routeBuildId??'test'),saved=structuredClone(route);
      if(difficulty!==undefined)route.difficulty=difficulty;
      route.priorityTargets=dungeon.enemies.slice(0,4).map(p=>p.placementId).reverse();
      assert.ok(hasRouteChanges(route,saved));
      const validated=validateRoute(route,dungeons,enemies);
      assert.deepEqual(validated.priorityTargets,route.priorityTargets);
      const encoded=await encodeRoute(route,dungeon),copy=await decodeRoute(encoded,dungeons,enemies);
      assert.deepEqual(copy.priorityTargets,route.priorityTargets);
      assert.equal(copy.difficulty,difficulty);
      assert.equal(await encodeRoute(copy,dungeon),encoded);
      assert.ok(!hasRouteChanges({...route,priorityTargets:[...route.priorityTargets].reverse()},route));
      assert.throws(()=>validateRoute({...route,priorityTargets:['foreign']},dungeons,enemies),/Invalid priority/);
    }
  }
});

test('Compact routes preserve all content in every dungeon, with hundredth-pixel coordinates and Unicode',async()=>{
  let oldSize=0,newSize=0;
  for(const dungeon of dungeons){
    const route=newRoute(dungeon,dungeon.routeBuildId??'test','Маршрут 🐉 #?&%');
    applyModifierPresets(route,dungeon,presets);
    route.shadow=modifierAvailable(dungeon.id,'shadow');
    for(const [kind,modifier] of Object.entries(route.modifiers))if(modifierAvailable(dungeon.id,kind)&&(modifier.packId||modifier.enemies?.length))modifier.active=true;
    route.pulls=Array.from({length:12},(_,i)=>newPull(i));
    dungeon.enemies.forEach((enemy,i)=>route.pulls[i%12].enemies.push(enemy.placementId));
    for(const kind of ['ghorn','witch'])if(route.modifiers[kind].packId)route.pulls[0].enemies.push(`modifier:${kind}`);
    route.pulls[0].name='Pull 1';route.pulls[0].customName=true;
    route.pulls[1].name='Босс';route.pulls[1].customName=true;route.pulls[1].color='#abcdef';
    route.pulls[2].note='Строка 1\nСтрока 2 <keep> #?&%';
    route.excluded=dungeon.enemies.filter(e=>!enemies.get(e.id)?.isBoss).slice(0,3).map(e=>e.placementId);
    route.drawings=['line','portal','invis','note'].map((kind,i)=>({
      id:`drawing-${i}`,mapId:mapViews(dungeon)[0].id,kind,color:'#bc78f5',text:kind==='note'?'Заметка 🐉':'',
      ...(kind==='line'?{width:5}:{}),points:kind==='note'?[[1.12,2.99]]:[[1.12,2.99],[300.12,400.99]],
    }));
    const encoded=await encodeRoute(route,dungeon),decoded=await decodeRoute(encoded,dungeons,enemies);
    assert.match(encoded,/^R[34]\.[A-Za-z0-9_-]+$/);
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
  const dungeon=dungeons[0],route=newRoute(dungeon,dungeon.routeBuildId??'test');
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
  const dungeon=dungeons[0],route=newRoute(dungeon,dungeon.routeBuildId??'test');
  route.pulls[0].enemies=[dungeon.enemies[0].placementId];
  const text=await encodeRoute(route,dungeon);
  for(const input of ['',JSON.stringify(route),`#route=${encodeURIComponent(JSON.stringify(route))}`,'R1.','R1.a','R1.***',text.slice(0,-8),'#route=%ZZ','https://example.com/']){
    await assert.rejects(decodeRoute(input,dungeons,enemies));
  }
  const changed={...dungeon,enemies:dungeon.enemies.slice(1)};
  await assert.rejects(decodeRoute(text,[changed],enemies),/enemy placements from another dataset/);
  for(const edit of [p=>p[4][0][0].push(p[4][0][0][0]),p=>p[4][0][0].push(-999999),p=>p[4][0][0].push(999999),p=>p[4][0][0].push('0'),p=>p[4]=null,p=>p[8]=2]){
    const payload=unpack(text);edit(payload);await assert.rejects(decodeRoute(pack(payload,text.slice(0,3)),dungeons,enemies));
  }
  const bomb='R1.'+deflateRawSync(Buffer.alloc(3_000_001,32)).toString('base64url');
  await assert.rejects(decodeRoute(bomb,dungeons,enemies),/too large/);
});

test('Mapped format preserves marker labels and multi-vertex geometry while creating independent IDs',async()=>{
  const dungeon=dungeons[0],route=newRoute(dungeon,dungeon.routeBuildId??'test'),mapId=mapViews(dungeon)[0].id;
  route.drawings=[{id:'path',mapId,kind:'line',color:'#abcdef',width:5,text:'',points:[[10,20],[30,70],[90,40]],pointIds:['a','b','c']},
    {id:'note',mapId,kind:'note',color:'#aabbcc',text:'Заметка 🐉 '.repeat(100),points:[[20,30]]}];
  route.markers=[{id:'marker',mapId,position:[12.35,45.68],color:'#bbaa11',icon:'star',label:'Встречаемся здесь 🐉'}];
  const encoded=await encodeRoute(route,dungeon);assert.match(encoded,/^R[34]\./);
  for(const input of [encoded,'#route='+encoded,'https://example.com/planner/#route='+encoded]){
    const copy=await decodeRoute(input,dungeons,enemies);
    assert.deepEqual(copy.drawings[0].points,route.drawings[0].points);assert.equal(copy.drawings[1].text,route.drawings[1].text);
    assert.deepEqual(content(copy.markers),content(route.markers));assert.notEqual(copy.markers[0].id,'marker');assert.notEqual(copy.drawings[0].id,'path');
    assert.equal(await encodeRoute(copy,dungeon),encoded);
  }
  const corrupt=unpack(encoded);corrupt[9][0][1]=[NaN,0];
  await assert.rejects(decodeRoute(pack(corrupt,encoded.slice(0,3)),dungeons,enemies),/marker position/);
});

test('Export rounds geometry without mutating the route; old links retain exact coordinates',async()=>{
  const dungeon=dungeons[0],route=newRoute(dungeon,dungeon.routeBuildId??'test'),mapId=mapViews(dungeon)[0].id;
  route.drawings=Array.from({length:20},(_,i)=>({
    id:`line-${i}`,mapId,kind:'line',color:'#e43969',text:'',
    points:[[123.123456789+i*17.26381271,456.987654321+i*6.2736281],[234.876543219+i*12.72836129,567.123456789+i*8.12376128]],
  }));
  route.drawings.push({id:'portal',mapId,kind:'portal',color:'#e43969',text:'',points:[[-.0049,-12.345678],[99999.999,-99999.999]]});
  route.markers=[{id:'marker',mapId,position:[12.345678,-45.6789],color:'#e43969',icon:'star',label:'Точная метка 🐉'}];
  const before=structuredClone(route),encoded=await encodeRoute(route,dungeon),decoded=await decodeRoute(encoded,dungeons,enemies);
  assert.deepEqual(route,before);
  assert.deepEqual(decoded.drawings[0].points,[[123.12,456.99],[234.88,567.12]]);
  assert.deepEqual(decoded.markers[0].position,[12.35,-45.68]);
  assert.deepEqual(decoded.drawings.at(-1).points,[[0,-12.35],[99999.999,-99999.999]]);
  for(const [i,drawing] of decoded.drawings.entries())for(const [j,point] of drawing.points.entries()){
    point.forEach((n,k)=>assert.ok(Math.abs(n-route.drawings[i].points[j][k])<=.005));
  }
  assert.equal(await encodeRoute(decoded,dungeon),encoded);
  const oldPayload=unpack(encoded);
  oldPayload[5].forEach((drawing,i)=>{drawing[2]=route.drawings[i].points;});
  oldPayload[9][0][1]=route.markers[0].position;
  const oldText=pack(oldPayload),oldRoute=await decodeRoute(oldText,dungeons,enemies);
  assert.deepEqual(content(oldRoute),content(validateRoute(route,dungeons,enemies)));
  assert.ok(encoded.length<oldText.length*.8,`${oldText.length} → ${encoded.length}`);
  console.log(`Route with 20 arrows: ${oldText.length} → ${encoded.length} characters`);
});

test('Replacement members can be omitted only when the registered pack preserves their exact order',async()=>{
  const dungeon=dungeons.find(d=>modifierAvailable(d.id,'ghorn')),dictionary=routeDictionary(dungeon.id);
  const packIndex=dictionary.packs.findIndex(p=>p.members.length>=3&&dungeon.enemies.some(e=>e.packId===p.id)&&p.members.every(i=>dungeon.enemies.some(e=>e.placementId===dictionary.placements[i]&&!enemies.get(e.id)?.isBoss)));
  assert.ok(packIndex>=0);
  const registered=dictionary.packs[packIndex],members=registered.members.map(i=>dictionary.placements[i]);
  for(const selected of [members,[...members].reverse(),members.slice(0,1)]){
    const route=newRoute(dungeon,dungeon.routeBuildId??'test');
    route.modifiers.ghorn={active:true,packId:registered.id,replacedEnemies:selected};
    const encoded=await encodeRoute(route,dungeon),copy=await decodeRoute(encoded,dungeons,enemies);
    assert.deepEqual(copy.modifiers.ghorn,route.modifiers.ghorn);
    if(selected===members)assert.equal(unpack(encoded)[7][1].length,2);
    assert.equal(await encodeRoute(copy,dungeon),encoded);
  }
});

test('Current build R3 route exports smaller with lossless member deltas and loads through both Share forms',async()=>{
  const original=fs.readFileSync(new URL('fixtures/compact-route-current-r3.txt',import.meta.url),'utf8').trim();
  const route=await decodeRoute(original,dungeons,enemies),dungeon=dungeons.find(d=>d.id===route.dungeonId);
  route.drawings.forEach(d=>{d.points=d.points.map(p=>p.map(n=>Math.round(n*100)/100));});
  const before=structuredClone(route),encoded=await encodeRoute(route,dungeon);
  assert.match(encoded,/^R4\./);
  assert.ok(encoded.length<original.length,`${original.length} → ${encoded.length}`);
  assert.deepEqual(route,before);
  for(const input of [encoded,'#route='+encoded,'https://example.com/#route='+encoded]){
    const copy=await decodeRoute(input,dungeons,enemies);
    assert.deepEqual(content(copy),content(route));
    assert.equal(await encodeRoute(copy,dungeon),encoded);
  }
  // Exercise both signs and arbitrary selection order, including mixed pack tokens.
  route.pulls.forEach(p=>p.enemies.reverse());
  route.excluded.reverse();route.modifiers.empowered.enemies.reverse();route.modifiers.ghorn.replacedEnemies.reverse();
  assert.deepEqual(content(await decodeRoute(await encodeRoute(route,dungeon),dungeons,enemies)),content(route));
  const empty=newRoute(dungeon,dungeon.routeBuildId??'test');
  assert.match(await encodeRoute(empty,dungeon),/^R3\./,'Keep R3 when delta coding cannot shorten the export');
  console.log(`Real route: ${original.length} → ${encoded.length} characters`);
});

test('R4 rejects invalid deltas, duplicate members, overflow and oversized decompression',async()=>{
  const route=await decodeRoute(fs.readFileSync(new URL('fixtures/compact-route-current-r3.txt',import.meta.url),'utf8'),dungeons,enemies);
  const encoded=await encodeRoute(route,dungeons.find(d=>d.id===route.dungeonId));
  for(const deltas of [['-17'],[null],[1.5],[-17,0],[Number.MAX_SAFE_INTEGER,1],[-999999],{}]){
    const payload=unpack(encoded);payload[4][0][0]=deltas;
    await assert.rejects(decodeRoute(pack(payload,'R4.'),dungeons,enemies));
  }
  const bomb='R4.'+deflateRawSync(Buffer.alloc(3_000_001,32)).toString('base64url');
  await assert.rejects(decodeRoute(bomb,dungeons,enemies),/too large/);
});
