import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {correctDungeon,placementAliases} from '../data/placement-corrections.js';
import {customDungeons} from '../data/custom-dungeons.js';
import {gameDungeons} from '../data/game-dungeons.js';
import {routeMapping} from '../data/route-mapping.js';
import {encodeMembers,decodeMembers,routeDictionary} from '../data/route-dictionary.js';
import {newRoute,encodeRoute,decodeRoute,validateRoute,scoreRoute,effectivePositions} from '../route-model.js';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
const urrakControls=JSON.parse(fs.readFileSync('tests/fixtures/urrak-pack-controls.json'));
const read=p=>JSON.parse(fs.readFileSync(p));
const raw=read('data/dungeons.json'),enemies=new Map(read('data/enemies.json').map(e=>[e.id,e]));
const variants=['fellership','custom'].map(mode=>raw.map(d=>correctDungeon(d,mode)));
const unpack=s=>JSON.parse(inflateRawSync(Buffer.from(s.slice(3),'base64url')));
const pack=(p,prefix='R3.')=>prefix+deflateRawSync(JSON.stringify(p)).toString('base64url');

test('Custom covers active game placements exactly once and supports lossless source switching',()=>{
  for(const d of raw){
    const original=correctDungeon(d,'fellership'),custom=correctDungeon(d,'custom'),definition=customDungeons[d.id];
    assert.equal(new Set(definition.packs.flatMap(p=>p.members)).size,custom.enemies.length);
    assert.equal(definition.packs.flatMap(p=>p.members).length,custom.enemies.length);
    assert.deepEqual(correctDungeon(custom,'fellership'),original);
    assert.deepEqual(correctDungeon(original,'custom'),custom);
    assert.deepEqual(correctDungeon(custom),custom);
    assert.deepEqual(custom.enemies,gameDungeons[d.id].enemies);
    assert.ok(custom.enemies.every(p=>p.gameGuid));
    for(const p of original.enemies)assert.ok(custom.enemies.some(q=>q.placementId===p.placementId)||custom.retiredPlacementIds.includes(p.placementId));
    const dictionary=routeDictionary(d.id);
    for(const p of definition.packs)assert.ok(dictionary.packs.some(q=>q.id===p.id&&JSON.stringify(q.members.map(i=>dictionary.placements[i]))===JSON.stringify(p.members)));
  }
});

test('Urrak plaza patrol and neighboring stationary trio remain separate in game data',()=>{
  const custom=variants[1].find(d=>d.id==='Level.ID.UrrakMarkets');
  const ids=new Set(urrakControls.slice(0,2).flat());
  const groups=[...Map.groupBy(custom.enemies.filter(p=>ids.has(p.placementId)),p=>p.packId).values()];
  assert.deepEqual(groups.map(p=>p.length),[3,3]);
  assert.ok(groups.every(ps=>ps.every(p=>!!p.patrolPath?.length===!!ps[0].patrolPath?.length)));
});

test('Custom uses all 491 game patrol members and restores source paths on rollback',()=>{
  let checked=0;
  for(const original of variants[0]){
    const custom=variants[1].find(d=>d.id===original.id);
    for(const p of custom.enemies){
      if(p.patrolPath){
        checked++;
        assert.ok(p.patrolPath.length>1);assert.equal(p.mapPatrolPath.length,p.patrolPath.length);
      }else{
        assert.equal(p.mapPatrolPath,null);
      }
    }
    assert.deepEqual(correctDungeon(custom,'fellership'),original);
    assert.deepEqual(correctDungeon(correctDungeon(custom,'fellership'),'custom'),custom);
  }
  assert.equal(checked,491);
});

test('Game model has 1059 actor packs, an extra encounter marker, and separate Dormant actors',()=>{
  assert.equal(Object.values(customDungeons).reduce((n,d)=>n+d.packs.length,0),1060);
  assert.equal(Object.values(gameDungeons).reduce((n,d)=>n+d.enemies.length,0),3041);
  const dormant=Object.values(gameDungeons).flatMap(d=>d.enemies.filter(p=>p.dormant));
  assert.equal(dormant.length,108);
  for(const d of Object.values(gameDungeons))for(const p of d.enemies.filter(p=>p.dormant))assert.equal(d.enemies.filter(q=>q.packId===p.packId).length,1);
});

test('Wraithtide former G22 has eight fixed mobs together and a separate solo patrol',()=>{
  const source=read('tests/fixtures/wraithtide-pack-controls.json');
  const dungeon=variants[1].find(d=>d.id===source.id);
  const members=id=>source.partitions.find(p=>p.id===id).members.map(id=>dungeon.enemies.find(p=>p.placementId===id));
  assert.equal(members('pk1155').length,3);
  assert.equal(members('pk1154').length,5);
  assert.equal(members('pk1156').length,1);
  assert.ok([...members('pk1155'),...members('pk1154')].every(p=>!p.patrolPath?.length));
  assert.ok(members('pk1156')[0].patrolPath.length>1);
  assert.equal(new Set(['pk1155','pk1154','pk1156'].map(id=>members(id)[0].packId)).size,2);
  assert.equal(members('pk1155')[0].packId,members('pk1154')[0].packId);
});

test('Xul keeps all eight sets of distinct same-label packs separate',()=>{
  const dungeon=variants[1].find(d=>d.id==='Level.ID.SandTomb');
  const owners=new Map(dungeon.enemies.map(p=>[p.placementId,p.packId]));
  const partitions=read('tests/fixtures/xul-pack-partitions.json');
  assert.equal(partitions.length,8);
  assert.equal(partitions.flat().length,27);
  for(const parts of partitions){
    const seen=new Set();
    for(const members of parts){
      assert.ok(members.every(id=>owners.has(id)));
      const packs=new Set(members.map(id=>owners.get(id)));
      for(const pack of packs){assert.ok(!seen.has(pack),'Distinct packs sharing a display label must not merge');seen.add(pack);}
    }
  }
});

test('Xul Crusher stays solo; historical four-mob selection remains a subset of the new eight-mob pack',async()=>{
  const custom=variants[1].find(d=>d.id==='Level.ID.SandTomb');
  const crusher='placement-bf6bb4aa34d50c27fc0a3fe99b96a02c24c956612a47157d8ae5b30324134e8e';
  const peer='placement-f1da8f980851b348d05292dc9621c6da402889f10c0c6c731ed4301d02b2a7a7';
  const group=id=>custom.enemies.filter(p=>p.packId===custom.enemies.find(p=>p.placementId===id).packId).map(p=>p.placementId);
  assert.deepEqual(group(crusher),[crusher]);
  const neighbors=group(peer);assert.equal(neighbors.length,8);assert.ok(!neighbors.includes(crusher));
  const dictionary=routeDictionary(custom.id);
  // This existing mapping slot was corrected in place with the data, not appended.
  const historical=decodeMembers(dictionary,[104]);assert.equal(historical.length,4);assert.ok(historical.every(id=>neighbors.includes(id)));
  for(const selected of [[crusher],neighbors,historical]){
    const r=newRoute(custom,'25647984');r.pulls[0].enemies=[...selected];
    for(const modes of variants){
      const target=modes.find(d=>d.id===custom.id),exported=await encodeRoute(r,target);
      assert.deepEqual((await decodeRoute(exported,[target],enemies)).pulls[0].enemies,selected);
      assert.deepEqual((await decodeRoute(exported,[custom],enemies)).pulls[0].enemies,selected);
    }
  }
});

test('Permanent mapping prefixes are immutable and generator only appends missing entries',()=>{
  for(const [id,fields]of Object.entries(read('tests/fixtures/route-mapping-lock.json')))for(const [key,lock]of Object.entries(fields)){
    assert.equal(createHash('sha256').update(JSON.stringify(routeMapping.dungeons[id][key].slice(0,lock.length))).digest('hex'),lock.sha256,id+' '+key);
  }
  execFileSync(process.execPath,['scripts/update-route-mapping.mjs','--check']);
});

test('Each game trio round-trips without selecting its neighboring trio; old source preferences cannot switch data',async()=>{
  const original=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets');
  const oldIds=new Set(urrakControls.slice(0,2).flat());
  const custom=correctDungeon(original,'custom');
  const trios=[...Map.groupBy(custom.enemies.filter(p=>oldIds.has(p.placementId)),p=>p.packId).values()];
  for(const trio of trios){
    const selected=trio.map(p=>p.placementId),d=correctDungeon(original,'custom'),r=newRoute(d,'25647984');
    assert.equal(selected.length,3);
    r.pulls[0].enemies=[...selected];
    // The UI changes the dungeon in place while retaining the route's placement IDs.
    Object.assign(d,correctDungeon(d,'fellership'));
    assert.equal(d.dungeonData,'custom');
    assert.equal(d.enemies.filter(p=>p.packId===trio[0].packId).length,3);
    const exported=await encodeRoute(r,d);
    for(const mode of ['fellership','custom']){
      const target=correctDungeon(original,mode);
      const imported=await decodeRoute(exported,[target],enemies);
      assert.deepEqual(imported.pulls[0].enemies,selected);
      const reimported=await decodeRoute(await encodeRoute(imported,target),[d],enemies);
      assert.deepEqual(reimported.pulls[0].enemies,selected);
    }
  }
});

test('All 45 pre-migration R1 fixtures import into both modes, including historical replacement packs',async()=>{
  for(const fixture of read('tests/fixtures/legacy-routes.json'))for(const dungeons of variants){
    const payload=unpack(fixture.text),dictionary=routeDictionary(fixture.dungeonId),legacy=dictionary.legacy.find(p=>p.fingerprint===payload[2]);
    assert.ok(legacy);
    const id=index=>dictionary.placements[legacy.placements[index]],aliases=placementAliases[fixture.dungeonId]??{},seen=new Set();
    const expected=payload[4].map(row=>row[0].map(id).map(id=>aliases[id]??id).filter(id=>{if(seen.has(id))return false;seen.add(id);return true;}));
    const r=await decodeRoute(fixture.text,dungeons,enemies),d=dungeons.find(d=>d.id===fixture.dungeonId);
    assert.deepEqual(r.pulls.map(p=>p.enemies),expected);
    const missing=new Set(r.pulls.flatMap(p=>p.enemies).filter(id=>!effectivePositions(r,d).some(p=>p.placementId===id)));
    assert.ok([...missing].every(id=>d.retiredPlacementIds.includes(id)));
    assert.equal(scoreRoute(r,d,enemies,null).unknown,missing.size);
    const copy=await decodeRoute(await encodeRoute(r,d),dungeons,enemies);
    assert.deepEqual(copy.pulls.map(p=>p.enemies),expected);
    assert.deepEqual(copy.modifiers,r.modifiers);
  }
});

test('Legacy R2 annotations survive and an unrecognized legacy fingerprint still fails',async()=>{
  const fixture=read('tests/fixtures/legacy-routes.json')[0],p=unpack(fixture.text),d=variants[1].find(d=>d.id===fixture.dungeonId);
  while(p.length<9)p.push(null);p[9]=[[d.mapImages[0].id,[.123,456.789],0,'star','старый маркер']];
  const r=await decodeRoute(pack(p,'R2.'),variants[1],enemies);assert.equal(r.markers[0].label,'старый маркер');
  p[2]='unknown-fingerprint';await assert.rejects(decodeRoute(pack(p,'R2.'),variants[1],enemies),/different enemy dataset/);
});

test('Pack references preserve old members after splits, partial selections, and appended compositions',async()=>{
  const d=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets'),custom=variants[1].find(c=>c.id===d.id),r=newRoute(d,'25647984');
  const group=[...Map.groupBy(d.enemies,p=>p.packId).values()].find(ps=>ps.length>=4);r.pulls[0].enemies=group.map(p=>p.placementId);
  const text=await encodeRoute(r,d),payload=unpack(text),dictionary=routeDictionary(d.id);
  assert.equal(payload[4][0][0].length,1,'A complete old pack is one mapping reference');
  const copy=await decodeRoute(text,[custom],enemies);assert.deepEqual(copy.pulls[0].enemies,r.pulls[0].enemies);
  const before=JSON.stringify(dictionary),n=dictionary.packs.length;
  try{
    dictionary.packs.push({id:'pack-future-example',members:[dictionary.placements.indexOf(group[0].placementId),dictionary.placements.indexOf(group[2].placementId)]});
    assert.deepEqual((await decodeRoute(text,[custom],enemies)).pulls[0].enemies,r.pulls[0].enemies);
    assert.deepEqual(decodeMembers(dictionary,[n]),[group[0].placementId,group[2].placementId]);
  }finally{dictionary.packs.length=n;}
  assert.equal(JSON.stringify(dictionary),before);
  r.pulls[0].enemies=[group[3].placementId,group[0].placementId,'modifier:ghorn'];
  assert.deepEqual(decodeMembers(dictionary,encodeMembers(dictionary,r.pulls[0].enemies)),r.pulls[0].enemies);
  r.pulls[0].enemies.pop();
  assert.deepEqual((await decodeRoute(await encodeRoute(r,custom),[d],enemies)).pulls[0].enemies,r.pulls[0].enemies);
});

test('Historical replacement members survive switching data and restoring a collaborative document',async()=>{
  const d=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets'),custom=variants[1].find(c=>c.id===d.id),r=newRoute(d,'25647984');
  const ps=[...Map.groupBy(d.enemies,p=>p.packId).values()].find(ps=>ps.length>=3&&!ps.some(p=>enemies.get(p.id).isBoss));
  r.modifiers.ghorn={active:true,packId:ps[0].packId};r.pulls[0].enemies=['modifier:ghorn'];
  const imported=await decodeRoute(await encodeRoute(r,d),[custom],enemies);
  assert.deepEqual([...imported.modifiers.ghorn.replacedEnemies].sort(),ps.map(p=>p.placementId).sort());
  const visible=effectivePositions(imported,custom);assert.ok(ps.every(p=>!visible.some(q=>q.placementId===p.placementId)));
  const doc=createRouteDocument(imported,{dungeon:custom,enemies,role:'player'});
  const restored=restoreRouteDocument(doc.exportSnapshot(),{dungeon:d,enemies,role:'player'});
  try{assert.deepEqual(restored.snapshot().modifiers.ghorn,imported.modifiers.ghorn);}finally{doc.dispose();restored.dispose();}
  assert.throws(()=>validateRoute({...r,modifiers:{...r.modifiers,ghorn:{active:true,packId:'invented',replacedEnemies:[ps[0].placementId]}}},[custom],enemies),/replacement pack/);
});
