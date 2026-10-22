import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patrolColumns} from '../scripts/game-patrol-columns.mjs';

test('stripped cooked patrol reconstructs sparse column-major formation', () => {
  const followers = ['a', 'b', 'c', 'd', 'e'].map(ObjectPath => ({ObjectPath}));
  const p = {FollowerCharacters: followers, PositionIndices: [1, 2, 3, 7, 8],
    LongestColumnLength: 400, PatrolPaths: [{}, {}, {}]};
  assert.deepEqual(patrolColumns(p, {Spacing: 200}).map(c => c.Characters.map(r => r?.ObjectPath ?? null)),
    [[null, 'a', 'b'], ['c', null, null], [null, 'd', 'e']]);
  assert.throws(() => patrolColumns({...p, PositionIndices: [1, 2, 3, 7, 9]}, {Spacing: 200}), /outside formation/);
  assert.throws(() => patrolColumns({...p, PositionIndices: [1, 2, 3, 7, 7]}, {Spacing: 200}), /Duplicate/);
});

test('one-row stripped patrol and serialized editor columns', () => {
  const p = {FollowerCharacters: [{ObjectPath: 'a'}, {ObjectPath: 'b'}], PositionIndices: [0, 1], PatrolPaths: [{}, {}]};
  assert.deepEqual(patrolColumns(p, {Spacing: 300}).map(c => c.Characters.length), [1, 1]);
  const columns = [{Characters: [null, {ObjectPath: 'c'}]}];
  assert.equal(patrolColumns({Columns: columns}, {}), columns);
});
