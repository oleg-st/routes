export function assertRouteBuild(route, dungeon) {
  const expected = dungeon?.routeBuildId;
  if (expected && route?.buildId !== expected)
    throw new Error('This route belongs to another game build. Enemy packs and positions have changed; create a new route.');
}
