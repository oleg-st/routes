import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSeasonDungeons,availableDifficultyLevels} from '../scripts/game-difficulty-source.mjs';

test('active rotation excludes enabled historical maps and ignores old ranked rows', () => {
  const dungeon=(name,casual)=>({id:'Level.ID.'+name,info:{AvailableForCasual:casual,IsEnabledInGame:true}});
  const registry={playable:[dungeon('Adventure',true),dungeon('Capstone',false),dungeon('Retired',false)]};
  const league={Type:'Enum::Eternal',MinimumDifficulty:21,MaximumDifficulty:52};
  const levels={1:{Level1:'Level.ID.Retired'},21:{Level1:'Level.ID.Adventure'},23:{Level1:'Level.ID.Capstone'},53:{Level1:'Level.ID.Retired'}};
  const tables={DT_GameFinderLeagues:{rows:{Eternal:league}},DT_DifficultyToLevel:{rows:levels}};
  assert.deepEqual(selectSeasonDungeons(registry,tables).map(d=>d.id),['Level.ID.Adventure','Level.ID.Capstone']);
  assert.deepEqual(availableDifficultyLevels(levels,league,registry.playable[1]),[23]);
  assert.throws(()=>selectSeasonDungeons({playable:registry.playable.slice(0,1)},tables),/missing dungeon/);
});
