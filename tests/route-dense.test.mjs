import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {binaryIO} from '../route-binary.js';
import {denseRouteCandidates,decodeDenseRoute} from '../route-dense.js';
import {routeCodebooks} from '../data/route-codebooks.js';
import {routeDictionary} from '../data/route-dictionary.js';
import {decodeRoute,encodeRoute} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url)));
const dungeons=read('dungeons').map(correctDungeon),enemies=new Map(read('enemies').map(e=>[e.id,e]));
const frame=(bytes,mode=0)=>'R5.'+Buffer.concat([Buffer.from([mode]),bytes]).toString('base64url');
const json=payload=>'R3.'+deflateRawSync(JSON.stringify(payload)).toString('base64url');
const content=r=>JSON.parse(JSON.stringify(r,(k,v)=>k==='id'?undefined:v));

test('Frozen codebook IDs, names, groups and modifier defaults never change',()=>{
  assert.equal(createHash('sha256').update(JSON.stringify(routeCodebooks[0])).digest('hex'),
    '10ddad2a4938379c83f7e19620f5e6038094bf5dd2b23db41a9092db6df7058c');
});

test('Every R5 membership mode preserves seeded partial packs, permutations, empty pulls and arbitrary metadata',async()=>{
  let seed=52719;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(const dungeon of dungeons){
    const dictionary=routeDictionary(dungeon.id),book=routeCodebooks[0].dungeons.find(d=>d.id===dungeon.id.slice(9));
    for(let trial=0;trial<8;trial++){
      const count=trial+1,pulls=Array.from({length:count},()=>[[]]);
      const members=dungeon.enemies.map(e=>dictionary.placements.indexOf(e.placementId));
      for(let i=members.length-1;i>0;i--){const j=random(i+1);[members[i],members[j]]=[members[j],members[i]];}
      for(const id of members)if(random(3))pulls[random(count)][0].push(-id-1);
      pulls[0].push('Не по шаблону 🐉','#ABCDEF','Log segment-01.',1);
      if(count>1)pulls[1].push(null,null,'Log segment-99.');
      const drawings=[
        [book.maps[0],2,[[1.25,-3.5],[99999.999,-99999.999]],'#abc123','текст',null],
        [book.maps.at(-1),0,[[100,20],[-12.75,13.01],[0,0]],null,'',5],
      ];
      const payload=[book.id,routeCodebooks[0].build,'m1','Любое имя · #007',pulls,drawings,null,book.mods,null,[]];
      const expected=await decodeRoute(json(payload),dungeons,enemies);
      const variants=denseRouteCandidates(payload,dictionary);assert.equal(variants.length,5);
      for(const bytes of variants){
        assert.deepEqual(content(await decodeRoute(frame(bytes),dungeons,enemies)),content(expected));
        assert.deepEqual(content(await decodeRoute(frame(deflateRawSync(bytes),1),dungeons,enemies)),content(expected));
      }
      const shortest=await encodeRoute(expected,dungeon);
      assert.ok(shortest.length<=json(payload).length);
      assert.equal(await encodeRoute(await decodeRoute(shortest,dungeons,enemies),dungeon),shortest);
    }
  }
});

test('R5 rejects every byte truncation, trailing bytes, unknown flags/books, allocation counts and inflate bombs',async()=>{
  const fixture=fs.readFileSync(new URL('fixtures/compact-route-current-r5.txt',import.meta.url),'utf8').trim();
  const payload=decodeDenseRoute(Buffer.from(fixture.slice(3),'base64url').subarray(1));
  for(const bytes of denseRouteCandidates(payload,routeDictionary('Level.ID.'+payload[0]))){
    for(let length=0;length<bytes.length;length++)await assert.rejects(decodeRoute(frame(bytes.subarray(0,length)),dungeons,enemies));
    await assert.rejects(decodeRoute(frame(Buffer.concat([bytes,Buffer.from([0])])),dungeons,enemies));
    await assert.rejects(decodeRoute(frame(bytes,4),dungeons,enemies));
  }
  const unknown=new binaryIO.Writer();unknown.golomb(1000);unknown.golomb(0);
  await assert.rejects(decodeRoute(frame(unknown.bytes()),dungeons,enemies),/Unknown route codebook/);
  const excessive=new binaryIO.Writer();excessive.golomb(0);excessive.golomb(0);excessive.uint(1,2);excessive.golomb(0);excessive.golomb(10001);excessive.uint(2,2);
  await assert.rejects(decodeRoute(frame(excessive.bytes()),dungeons,enemies));
  await assert.rejects(decodeRoute(frame(deflateRawSync(Buffer.alloc(3_000_001)),1),dungeons,enemies),/too large/);
});

test('Frozen books cannot reinterpret future builds, while newly appended placements retain fallbacks',async()=>{
  const fixture=fs.readFileSync(new URL('fixtures/compact-route-current-r5.txt',import.meta.url),'utf8').trim();
  const payload=decodeDenseRoute(Buffer.from(fixture.slice(3),'base64url').subarray(1));
  const dictionary=routeDictionary('Level.ID.'+payload[0]);
  const futureBuild=structuredClone(payload);futureBuild[1]='future';
  assert.deepEqual(denseRouteCandidates(futureBuild,dictionary),[]);
  const d=dungeons.find(d=>d.id==='Level.ID.'+payload[0]);
  await assert.rejects(decodeRoute(fixture,[{...d,routeBuildId:'future'}],enemies),/another game build/);
  const future=structuredClone(payload);future[4][0][0].push(-10001);
  assert.equal(denseRouteCandidates(future,dictionary).length,2);
});
