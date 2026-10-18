import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {activeCatalogIds,selectCatalogNpcs,npcCatalogId} from '../scripts/game-catalog-actors.mjs';

function fixture(t){
  const parent=path.resolve('tmp');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'catalog-actors-test-'));
  t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true});});
  fs.mkdirSync(path.join(root,'Dungeon'));
  const data={steamBuild:'new-build',mobs:[
    {actorKey:'new',enemyId:'new-mob'},
    {actorKey:'service',enemyId:'trap'},
    {actorKey:'underground',enemyId:'hidden-mob'},
  ]};
  const file=path.join(root,'Dungeon/extracted.json'),bytes=JSON.stringify(data);fs.writeFileSync(file,bytes);
  const overlay={steamBuild:data.steamBuild,activeActorKeys:{Dungeon:['new']},sourceHashes:{Dungeon:createHash('sha256').update(bytes).digest('hex')}};
  return {root,overlay,steamBuild:data.steamBuild,dungeonKeys:['Dungeon'],file};
}

test('A fresh actor type enters the catalog without any previous planner files',t=>{
  const input=fixture(t),ids=activeCatalogIds(input);
  const npcs=[{blueprint:'BP_NPC_New_Mob'},{blueprint:'BP_NPC_Retired_Mob'},
    {blueprint:'BP_NPC_Trap'},{blueprint:'BP_NPC_Hidden_Mob'},
    {blueprint:'BP_DM_WinterGiant',characterId:'DM_WinterGiant'},
    {blueprint:'BP_DM_WinterGiantFriendly',characterId:'DM_WinterGiant'},
    {blueprint:'BP_DM_WinterWitch',characterId:'DM_WinterWitch'}];
  assert.deepEqual([...ids],['new-mob']);
  assert.deepEqual(selectCatalogNpcs(npcs,ids).map(npcCatalogId),['new-mob','dm-wintergiant','dm-winterwitch']);
  assert.throws(()=>selectCatalogNpcs(npcs.slice(1),ids),/Missing active enemy.*new-mob/);
});

test('Stale selection, mixed game builds and missing actors stop catalog generation',t=>{
  const input=fixture(t);
  assert.throws(()=>activeCatalogIds({...input,steamBuild:'other-build'}),/different game builds/);
  assert.throws(()=>activeCatalogIds({...input,dungeonKeys:['Dungeon','NewDungeon']}),/current dungeon registry/);
  const missing=structuredClone(input);missing.overlay.activeActorKeys.Dungeon.push('missing');
  assert.throws(()=>activeCatalogIds(missing),/no exported enemy type/);
  fs.appendFileSync(input.file,' ');
  assert.throws(()=>activeCatalogIds(input),/Regenerate actor selection overlay/);
});
