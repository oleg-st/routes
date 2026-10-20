import {pullColor, defaultModifiers} from '../route-model.js';
import {modifierAvailable} from '../game-scoring.js';
import {applyDifficulty,checkDifficulty} from '../difficulty.js';
import {visibleIds, rows, pointIds, members, canonical} from './route-schema.js';

export function selectRoute(doc, identity) {
  const meta = doc.getMap('meta'), colors = doc.getMap('colors');
  const pulls = visibleIds(doc, 'pulls').map((id, index) => {
    const row = rows(doc, 'pulls').get(id), customName = row.get('customName') === true;
    return {id, name: customName ? row.get('name') : `Pull ${index + 1}`, customName,
      color: colors.get(String(index)) ?? pullColor(index), enemies: [], note: row.get('note')?.toString() ?? ''};
  });
  const byId = new Map(pulls.map(pull => [pull.id, pull]));
  for (const [mobId, pullId] of doc.getMap('assignments').entries()) byId.get(pullId)?.enemies.push(mobId);
  for (const pull of pulls) pull.enemies.sort();
  const drawings = visibleIds(doc, 'drawings').map(id => {
    const row = rows(doc, 'drawings').get(id), keys = pointIds(row);
    return {id, mapId: row.get('mapId'), kind: row.get('kind'), color: row.get('color'),
      ...(row.get('kind') === 'line' ? {width: row.get('width')} : {}),
      ...(row.get('kind') === 'note' && row.get('icon') !== undefined ? {icon: row.get('icon')} : {}),
      text: row.get('text')?.toString() ?? '', pointIds: keys,
      points: keys.map(key => row.get('points').get(key).get('position'))};
  });
  // Concurrent point deletions may leave a path without enough geometry. Keep its history, hide the invalid shape.
  const visibleDrawings = drawings.filter(d => d.kind === 'line' ? d.points.length >= 2 : d.points.length === (d.kind === 'note' ? 1 : 2));
  const markers = visibleIds(doc, 'markers').map(id => {
    const row = rows(doc, 'markers').get(id);
    return {id, mapId: row.get('mapId'), position: row.get('position'), color: row.get('color'),
      icon: row.get('icon'), label: row.get('label')?.toString() ?? ''};
  });
  const modifiers = defaultModifiers();
  for (const kind of Object.keys(modifiers)) {
    const row = doc.getMap('modifiers').get(kind);
    if (!row) continue;
    modifiers[kind].active = row.get('active') === true && modifierAvailable(identity.dungeonId,kind);
    if (kind === 'empowered') modifiers[kind].enemies = members(row.get('enemies'));
    else Object.assign(modifiers[kind], row.get('replacement') ?? {packId: null});
    if (kind !== 'empowered' && !modifiers[kind].packId) modifiers[kind].active = false;
  }
  // Concurrent choices of the same replacement pack must not count it twice.
  const {ghorn, witch} = modifiers;
  if (ghorn.active && witch.active && (ghorn.packId === witch.packId ||
      ghorn.replacedEnemies?.some(key => witch.replacedEnemies?.includes(key)))) witch.active = false;
  const availableMob = key => !key.startsWith('modifier:') || Boolean(modifiers[key.slice(9)]?.packId);
  for (const pull of pulls) pull.enemies = pull.enemies.filter(availableMob);
  const route={version: 2, id: identity.routeId, buildId: identity.buildId, dungeonId: identity.dungeonId,
    ...(meta.get('difficulty')===undefined?{}:{difficulty:meta.get('difficulty')}),
    name: meta.get('name'), shadow: meta.get('shadow') === true && modifierAvailable(identity.dungeonId,'shadow'), modifiers, pulls, drawings: visibleDrawings, markers,
    excluded: members(doc.getMap('excluded')).filter(availableMob),
    priorityTargets: members(doc.getMap('priorityTargets')).filter(availableMob)};
  if(route.difficulty!==undefined)checkDifficulty(identity.dungeonId,route.difficulty);
  return meta.get('manualAffixes')===true?route:applyDifficulty(route);
}
export function canonicalRoute(doc, identity) {
  return JSON.stringify(canonical({schemaVersion: identity.schemaVersion, ...selectRoute(doc, identity)}));
}
