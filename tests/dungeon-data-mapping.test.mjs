import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {correctDungeon,placementAliases} from '../data/placement-corrections.js';
import {customDungeons} from '../data/custom-dungeons.js';
import {routeMapping} from '../data/route-mapping.js';
import {encodeMembers,decodeMembers,routeDictionary} from '../data/route-dictionary.js';
import {newRoute,encodeRoute,decodeRoute,validateRoute,scoreRoute,effectivePositions} from '../route-model.js';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
const read=p=>JSON.parse(fs.readFileSync(p));
const raw=read('data/dungeons.json'),enemies=new Map(read('data/enemies.json').map(e=>[e.id,e]));
const variants=['fellership','custom'].map(mode=>raw.map(d=>correctDungeon(d,mode)));
const unpack=s=>JSON.parse(inflateRawSync(Buffer.from(s.slice(3),'base64url')));
const pack=(p,prefix='R3.')=>prefix+deflateRawSync(JSON.stringify(p)).toString('base64url');

test('Custom covers every existing placement exactly once, supports rollback, and keeps all spawn coordinates',()=>{
  for(const d of raw){
    const original=correctDungeon(d,'fellership'),custom=correctDungeon(d,'custom'),definition=customDungeons[d.id];
    assert.equal(new Set(definition.packs.flatMap(p=>p.members)).size,original.enemies.length);
    assert.equal(definition.packs.flatMap(p=>p.members).length,original.enemies.length);
    assert.deepEqual(correctDungeon(custom,'fellership'),original);
    assert.deepEqual(correctDungeon(original,'custom'),custom);
    assert.deepEqual(correctDungeon(custom),custom);
    assert.deepEqual(custom.enemies.map(p=>[p.id,p.placementId,p.worldPosition,p.mapPosition]),original.enemies.map(p=>[p.id,p.placementId,p.worldPosition,p.mapPosition]));
    const dictionary=routeDictionary(d.id);
    for(const p of definition.packs)assert.ok(dictionary.packs.some(q=>q.id===p.id&&JSON.stringify(q.members.map(i=>dictionary.placements[i]))===JSON.stringify(p.members)));
  }
});

test('Original Urrak G21 is six mobs in Fellership and two separate trios in Custom',()=>{
  const original=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets'),custom=variants[1].find(d=>d.id===original.id);
  const members=[...Map.groupBy(original.enemies,p=>p.packId).values()][20],ids=new Set(members.map(p=>p.placementId));
  assert.equal(members.length,6);
  const groups=[...Map.groupBy(custom.enemies.filter(p=>ids.has(p.placementId)),p=>p.packId).values()];
  assert.deepEqual(groups.map(p=>p.length),[3,3]);
  assert.ok(groups.every(ps=>ps.every(p=>!!p.patrolPath?.length===!!ps[0].patrolPath?.length)));
});

test('Permanent mapping prefixes are immutable and generator only appends missing entries',()=>{
  for(const [id,fields]of Object.entries(read('tests/fixtures/route-mapping-lock.json')))for(const [key,lock]of Object.entries(fields)){
    assert.equal(createHash('sha256').update(JSON.stringify(routeMapping.dungeons[id][key].slice(0,lock.length))).digest('hex'),lock.sha256,id+' '+key);
  }
  execFileSync(process.execPath,['scripts/update-route-mapping.mjs','--check']);
});

test('Selecting a Custom trio then switching to Fellership never exports the other half of its six-mob pack',async()=>{
  const original=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets');
  const oldPack=[...Map.groupBy(original.enemies,p=>p.packId).values()][20];
  const oldIds=new Set(oldPack.map(p=>p.placementId));
  const custom=correctDungeon(original,'custom');
  const trios=[...Map.groupBy(custom.enemies.filter(p=>oldIds.has(p.placementId)),p=>p.packId).values()];
  for(const trio of trios){
    const selected=trio.map(p=>p.placementId),d=correctDungeon(original,'custom'),r=newRoute(d,'25647984');
    assert.equal(selected.length,3);
    r.pulls[0].enemies=[...selected];
    // The UI changes the dungeon in place while retaining the route's placement IDs.
    Object.assign(d,correctDungeon(d,'fellership'));
    assert.equal(d.enemies.filter(p=>p.packId===oldPack[0].packId).length,6);
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
    assert.equal(scoreRoute(r,d,enemies,null).unknown,0);
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
  const group=[...Map.groupBy(d.enemies,p=>p.packId).values()][20];r.pulls[0].enemies=group.map(p=>p.placementId);
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
  const ps=[...Map.groupBy(d.enemies,p=>p.packId).values()][20];
  r.modifiers.ghorn={active:true,packId:ps[0].packId};r.pulls[0].enemies=['modifier:ghorn'];
  const imported=await decodeRoute(await encodeRoute(r,d),[custom],enemies);
  assert.deepEqual(imported.modifiers.ghorn.replacedEnemies,ps.map(p=>p.placementId));
  const visible=effectivePositions(imported,custom);assert.ok(ps.every(p=>!visible.some(q=>q.placementId===p.placementId)));
  const doc=createRouteDocument(imported,{dungeon:custom,enemies,role:'player'});
  const restored=restoreRouteDocument(doc.exportSnapshot(),{dungeon:d,enemies,role:'player'});
  try{assert.deepEqual(restored.snapshot().modifiers.ghorn,imported.modifiers.ghorn);}finally{doc.dispose();restored.dispose();}
  assert.throws(()=>validateRoute({...r,modifiers:{...r.modifiers,ghorn:{active:true,packId:'invented',replacedEnemies:[ps[0].placementId]}}},[custom],enemies),/replacement pack/);
});
