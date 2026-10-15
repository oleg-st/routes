import {validateRoute, applyModifierPresets} from '../route-model.js';
import {createRouteDocument} from './route-document.js';
import {assertPlayer, role} from './route-schema.js';

// Only the creating client migrates JSON. Joining/reloading CRDT clients restore binary history.
export function migrateRoute(value, {dungeons, enemies, presets, role: participantRole = 'player'}) {
  assertPlayer(role(participantRole));
  const route = validateRoute(value, dungeons, enemies);
  const dungeon = dungeons.find(item => item.id === route.dungeonId);
  if (presets) applyModifierPresets(route, dungeon, presets);
  return createRouteDocument(route, {dungeon, enemies, role: participantRole});
}
