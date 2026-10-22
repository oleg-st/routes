import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedEnemyLevels} from '../scripts/game-enemy-levels.mjs';

test('population follows persistent-world streaming instead of alternate numbering', () => {
  const row = (Type, name) => ({Object: {Type, Properties: {WorldAsset: {AssetPathName: '/Game/' + name + '.' + name}}}});
  const packages = [{Source: '/Game/PirateRaid.umap', Objects: [
    row('LevelStreamingDynamic', 'PirateRaid_Enemies_Alternate_01'),
    row('LevelStreamingAlwaysLoaded', 'Dungeon6_Enemies_Alternate_03'),
    row('LevelStreamingAlwaysLoaded', 'PirateRaid_Lighting')]},
    {Source: '/Game/Dungeon6_Enemies_Alternate_03.umap', Objects: []},
    {Source: '/Game/PirateRaid_Lighting.umap', Objects: [row('LevelStreamingAlwaysLoaded','PirateRaid_Environment')]},
    {Source: '/Game/PirateRaid_Environment.umap', Objects: [row('LevelStreamingAlwaysLoaded','PirateRaid')]}];
  assert.deepEqual(selectedEnemyLevels('PirateRaid', packages), ['PirateRaid', 'Dungeon6_Enemies_Alternate_03','PirateRaid_Lighting','PirateRaid_Environment']);
  assert.throws(() => selectedEnemyLevels('PirateRaid', packages.slice(0, 1)), /Missing always-loaded package/);
});
