import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fullMaps} from '../data/full-maps.js';
import {combinedLayouts} from '../data/combined-layouts.js';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export const publicMapPath = image => 'images/dungeons/maps/' + image.path.split('/').pop();

export function usedImages({includeReferenced = false, includeLayers = false} = {}) {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
  const dungeons = read('dungeons');
  const enemyIds = new Set(dungeons.flatMap(dungeon => dungeon.enemies.map(enemy => enemy.id)));
  const images = new Set(dungeons.filter(dungeon => !combinedLayouts[dungeon.id]).map(dungeon => publicMapPath(dungeon.mapImages[0])));
  if (includeLayers) for (const dungeon of dungeons) for (const image of dungeon.mapImages) images.add(image.path);
  if (includeReferenced) for (const map of Object.values(fullMaps)) images.add(map.path);
  for (const map of Object.values(combinedLayouts)) images.add(map.path);
  for (const enemy of read('enemies')) {
    if (!enemyIds.has(enemy.id)) continue;
    // Match app.js availableImage(): prefer 200px portraits, then the first image.
    const image = enemy.images?.find(image => image.size === '200') || enemy.images?.[0];
    if (image) images.add(image.path);
  }
  // Runtime source literals include toolbar, modifier, and relic icons.
  for (const source of ['index.html', 'app.js', 'styles.css', 'route-model.js', 'map-views.js', 'map-geometry.js']) {
    const text = fs.readFileSync(new URL(`../${source}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\bimages\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|svg|gif|avif|ico)\b/g)) images.add(match[0]);
  }
  return [...images].sort();
}
