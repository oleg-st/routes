import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {correctDungeon} from '../data/placement-corrections.js';
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
    for(const p of definition.packs)assert.ok(dictionary.packs.some(q=>q.id===p.id&&JSON.stringify(q.members.map(i=>dictionary.placements[i]).sort())===JSON.stringify(p.members)));
  }
});



test('Every game patrol member has a matching projected path',()=>{
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
  assert.equal(checked,388);
});

test('Current game model has 628 packs and keeps Dormant actors separate',()=>{
  assert.equal(Object.values(customDungeons).reduce((n,d)=>n+d.packs.length,0),628);
  assert.equal(Object.values(gameDungeons).reduce((n,d)=>n+d.enemies.length,0),1546);
  const dormant=Object.values(gameDungeons).flatMap(d=>d.enemies.filter(p=>p.dormant));
  assert.equal(dormant.length,31);
  for(const d of Object.values(gameDungeons))for(const p of d.enemies.filter(p=>p.dormant))assert.equal(d.enemies.filter(q=>q.packId===p.packId).length,1);
});















test('Pack references preserve old members after splits, partial selections, and appended compositions',async()=>{
  const d=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets'),custom=variants[1].find(c=>c.id===d.id),r=newRoute(d,d.routeBuildId??'test');
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
  const d=variants[0].find(d=>d.id==='Level.ID.UrrakMarkets'),custom=variants[1].find(c=>c.id===d.id),r=newRoute(d,d.routeBuildId??'test');
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
