// Published JSON stores identical patrols once. Restore the runtime shape without
// rounding coordinates or changing placement IDs used by saved routes.
export function expandDungeons(dungeons) {
  return dungeons.map(dungeon => {
    if (!dungeon.sharedPatrols) return dungeon;
    const {sharedPatrols, ...expanded} = dungeon;
    expanded.enemies = dungeon.enemies.map(({patrolIndex, ...enemy}) => {
      const [patrolPath, mapPatrolPath] = sharedPatrols[patrolIndex];
      return {...enemy, patrolPath, mapPatrolPath};
    });
    return expanded;
  });
}
