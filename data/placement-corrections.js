// Build 25647984 has two placements for these bosses. Method's encounter data
// lists only the canonical position. Preserve old route references as aliases.
export const placementAliases={
  'Level.ID.DesertDunes':{'placement-c7446169de7e6c8986cf7b0a73dd5186f8a59f47d519d9b092ce73de4558f2f5':'placement-2f08a0644a58616a92aee8c52e26e64e6160054dba296541b472deed07cee715'},
  'Level.ID.ElfMines':{'placement-22cc9463cbd41916c3fff777b3170e27368a378b4b46188fc07f2379d6f0564c':'placement-e86eb32f0f44ffc23ed2e1b8b08479485c31446efdc707b4eccf68b0efe20c8e'}
};
export function correctDungeon(dungeon){
  const aliases=placementAliases[dungeon.id];
  return aliases?{...dungeon,enemies:dungeon.enemies.filter(p=>!aliases[p.placementId])}:dungeon;
}
