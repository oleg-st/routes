import assert from 'node:assert/strict';
import path from 'node:path';

// The persistent world names its loaded population. Alternate numbers are
// authoring labels, not a reliable season selector (SnowPeak uses 02 in 0.5).
export function selectedEnemyLevels(dungeonKey, packages) {
  const persistent = packages.find(p => path.basename(p.Source, '.umap') === dungeonKey);
  assert.ok(persistent, 'Missing persistent world: ' + dungeonKey);
  const names = new Set(packages.map(p => path.basename(p.Source, '.umap')));
  const selected = persistent.Objects.map(r => r.Object).filter(o => o.Type === 'LevelStreamingAlwaysLoaded')
    .map(o => o.Properties?.WorldAsset?.AssetPathName?.split('.').at(-1))
    .filter(name => name && /_Enemies(?:_Alternate_\d+)?$/.test(name));
  assert.ok(selected.length, 'No always-loaded enemy population: ' + dungeonKey);
  for (const name of selected) assert.ok(names.has(name), 'Missing loaded enemy package: ' + name);
  return [dungeonKey, ...new Set(selected)];
}
