import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// The selection overlay filters service objects and out-of-map actors. Read
// types from the exact extraction it reviewed, never a previous planner build.
export function activeCatalogIds({root,overlay,steamBuild,dungeonKeys}){
  assert.equal(overlay.steamBuild,steamBuild,'Catalog and actor exports use different game builds');
  assert.deepEqual(Object.keys(overlay.activeActorKeys).sort(),[...dungeonKeys].sort(),'Actor selection does not cover the current dungeon registry');
  const ids=new Set();
  for(const key of dungeonKeys){
    assert.match(key,/^[a-zA-Z0-9_-]+$/,'Invalid dungeon key');
    const bytes=fs.readFileSync(path.join(root,key,'extracted.json'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),overlay.sourceHashes[key],'Regenerate actor selection overlay: '+key);
    const data=JSON.parse(bytes);
    assert.equal(data.steamBuild,steamBuild,'Catalog and actor exports use different game builds: '+key);
    const actors=new Map(data.mobs.map(m=>[m.actorKey,m]));
    for(const actorKey of overlay.activeActorKeys[key]){
      const mob=actors.get(actorKey);
      assert.ok(mob?.enemyId,'Selected actor has no exported enemy type: '+actorKey);
      ids.add(mob.enemyId);
    }
  }
  return ids;
}

export const npcCatalogId=n=>n.blueprint.replace(/^BP_(?:NPC_)?/,'').replaceAll('_','-').toLowerCase();
export function selectCatalogNpcs(npcs,activeIds){
  const selected=npcs.filter(n=>activeIds.has(npcCatalogId(n))||['DM_WinterGiant','DM_WinterWitch'].includes(n.characterId)&&!n.blueprint.endsWith('Friendly'));
  const available=new Set(selected.map(npcCatalogId));
  for(const id of activeIds)assert.ok(available.has(id),'Missing active enemy in game NPC export: '+id);
  return selected;
}
