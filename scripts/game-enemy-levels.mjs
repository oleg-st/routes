import assert from 'node:assert/strict';
import path from 'node:path';

// The persistent world names its loaded population. Alternate numbers are
// authoring labels, not a reliable season selector (SnowPeak uses 02 in 0.5).
export function selectedEnemyLevels(dungeonKey, packages) {
  const persistent = packages.find(p => path.basename(p.Source, '.umap') === dungeonKey);
  assert.ok(persistent, 'Missing persistent world: ' + dungeonKey);
  const byName = new Map(packages.map(p => [path.basename(p.Source, '.umap'),p]));
  const selected = new Set([dungeonKey]);
  // Combat actors and patrols may live in Environment or other authoring levels.
  // Follow streaming references, including nested levels, rather than filenames.
  for(const name of selected){
    const pkg=byName.get(name);
    assert.ok(pkg,'Missing always-loaded package: '+name);
    for(const {Object:o} of pkg.Objects){
      if(o.Type!=='LevelStreamingAlwaysLoaded')continue;
      const loaded=o.Properties?.WorldAsset?.AssetPathName?.split('.').at(-1);
      assert.ok(loaded,'Missing always-loaded world reference: '+name);
      selected.add(loaded);
    }
  }
  return [...selected];
}
