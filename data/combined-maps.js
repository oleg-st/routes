import {combinedLayouts} from './combined-layouts.js';
export function combinedMap(dungeon) {
  return combinedLayouts[dungeon.id] || null;
}
