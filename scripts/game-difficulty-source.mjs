import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

export const difficultyAssets=['/Game/dungeons/DT_DifficultyToLevel','/Game/MatchMaking/DT_GameFinderLeagues'];
export function selectSeasonDungeons(registry,tables){
  // Older exports predate the Casual/Adventure mode registry.
  if(!registry.playable.some(d=>Object.hasOwn(d.info,'AvailableForCasual')))return registry.playable;
  const league=Object.values(tables.DT_GameFinderLeagues.rows).find(l=>l.Type.endsWith('::Eternal'));
  assert.ok(league,'Missing Eternal league');
  const ids=new Set(Object.entries(tables.DT_DifficultyToLevel.rows)
    .filter(([level])=>Number(level)>=league.MinimumDifficulty&&Number(level)<=league.MaximumDifficulty)
    .flatMap(([,row])=>Object.values(row).filter(v=>typeof v==='string'&&v.startsWith('Level.ID.'))));
  for(const d of registry.playable)if(d.info.AvailableForCasual)ids.add(d.id);
  for(const id of ids)assert.ok(registry.playable.some(d=>d.id===id),'Rotation references missing dungeon: '+id);
  assert.ok(ids.size,'Empty active dungeon rotation');
  return registry.playable.filter(d=>ids.has(d.id));
}
export function availableDifficultyLevels(levels,league,dungeon){
  assert.ok(league&&Number.isInteger(league.MinimumDifficulty)&&Number.isInteger(league.MaximumDifficulty),'Review difficulty league bounds');
  return Object.entries(levels).filter(([level,row])=>Number(level)>=league.MinimumDifficulty&&Number(level)<=Math.min(dungeon.info.MaximumDifficulty??Infinity,league.MaximumDifficulty)&&Object.values(row).includes(dungeon.id)).map(([level])=>Number(level)).sort((a,b)=>a-b);
}
export function readDifficultyTables(root='private/game-data/all-dungeons'){
  const status=JSON.parse(fs.readFileSync(path.join(root,'difficulty-assets.txt.status.json')));
  const tables={};
  for(const asset of difficultyAssets){
    const result=status.find(r=>r.Source.toLowerCase().replace(/^fellowship\/Content\//i,'/Game/').replace(/\.uasset$/i,'')===asset.toLowerCase());
    assert.ok(result?.Output&&!result.Error&&!result.Diagnostics?.length,'Incomplete difficulty export: '+asset);
    const file=path.join(root,'dependencies',result.Output),pkg=JSON.parse(fs.readFileSync(file));
    const name=asset.split('/').at(-1),table=pkg.Objects.find(o=>o.Name===name);
    assert.ok(table?.Rows,'Missing difficulty table: '+name);
    tables[name]={file,rows:table.Rows};
  }
  return tables;
}
export function exportDifficultyTables(){
  const root='private/game-data/all-dungeons',assets=path.join(root,'difficulty-assets.txt');
  fs.writeFileSync(assets,difficultyAssets.join('\n')+'\n');
  const r=spawnSync('dotnet',['private/game-data/extractor/bin/Debug/net10.0/Extractor.dll','--assets',assets],{stdio:'inherit',windowsHide:true});
  if(r.error)throw r.error;
  assert.equal(r.status,0,'Difficulty export failed');
  return readDifficultyTables(root);
}
