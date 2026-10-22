import assert from 'node:assert/strict';

// Some cooked levels strip editor Columns but retain the runtime follower arrays.
// PositionIndices use a column-major rectangle; LongestColumnLength is the
// distance from the first to last row (therefore rows = length / spacing + 1).
export function patrolColumns(properties, settings) {
  if (properties.Columns) return properties.Columns;
  const followers = properties.FollowerCharacters ?? [];
  if (!followers.length) return [];
  const paths = properties.PatrolPaths ?? [];
  const indices = properties.PositionIndices;
  assert.ok(paths.length > 0, 'Patrol followers have no paths');
  assert.equal(indices?.length, followers.length, 'Missing patrol position indices');
  const spacing = settings.Spacing;
  const length = properties.LongestColumnLength ?? 0;
  assert.ok(Number.isFinite(spacing) && spacing > 0 && Number.isFinite(length) && length >= 0, 'Invalid patrol formation dimensions');
  const rows = Math.round(length / spacing) + 1;
  assert.ok(Math.abs((rows - 1) * spacing - length) < 0.01, 'Patrol row count is not integral');
  const columns = paths.map(() => ({Characters: Array(rows).fill(null)}));
  const used = new Set();
  indices.forEach((index, i) => {
    assert.ok(Number.isInteger(index) && index >= 0 && index < rows * paths.length, 'Patrol position outside formation');
    assert.ok(!used.has(index), 'Duplicate patrol position');
    used.add(index);
    columns[Math.floor(index / rows)].Characters[index % rows] = followers[i];
  });
  return columns;
}
