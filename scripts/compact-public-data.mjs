import fs from 'node:fs';
import path from 'node:path';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]));

export function compactPublicData(destination) {
  const directory = path.join(destination, 'data');
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name + '.json'), 'utf8'));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(value) + '\n');
  const dungeons = read('dungeons');
  const enemyIds = new Set(dungeons.flatMap(dungeon => dungeon.enemies.map(enemy => enemy.id)));
  write('dungeons', dungeons.map(dungeon => {
    const compact = pick(dungeon, ['id', 'name', 'requiredScore', 'mapImages', 'retiredPlacementIds']);
    compact.mapImages = compact.mapImages.map(image => pick(image, ['id', 'name', 'path', 'width', 'height']));
    const indexes = new Map(), sharedPatrols = [];
    compact.enemies = dungeon.enemies.map(({patrolPath, mapPatrolPath, ...enemy}) => {
      const paths = [patrolPath, mapPatrolPath], key = JSON.stringify(paths);
      if (!indexes.has(key)) {indexes.set(key, sharedPatrols.length); sharedPatrols.push(paths);}
      return {...enemy, patrolIndex: indexes.get(key)};
    });
    return {...compact, sharedPatrols};
  }));
  write('enemies', read('enemies').filter(enemy => enemyIds.has(enemy.id)||['dm-wintergiant','dm-winterwitch'].includes(enemy.id)).map(enemy => {
    const compact = pick(enemy, ['id', 'gameId', 'name', 'dungeonScore', 'countsTowardsDungeonScore', 'shadowOrbEligible', 'baseHealth', 'isBoss', 'canBeControlled']);
    const image = enemy.images?.find(image => image.size === '200') || enemy.images?.[0];
    return {...compact, images: image ? [pick(image, ['path', 'size'])] : []};
  }));
  write('abilities', read('abilities').filter(ability => enemyIds.has(ability.parentId)).map(ability =>
    pick(ability, ['id', 'parentId', 'name', 'description', 'castInterruptibility', 'baseCooldownSeconds', 'liveStatus'])));
  // Remaining JSON datasets also ship without authoring whitespace.
  for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.json'))) {
    const filename = path.join(directory, file);
    fs.writeFileSync(filename, JSON.stringify(JSON.parse(fs.readFileSync(filename, 'utf8'))) + '\n');
  }
}
