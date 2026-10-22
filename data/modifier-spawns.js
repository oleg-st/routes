import {modifierPositions} from './game-modifier-positions.js';

export function modifierPlacementIds(dungeonId,kind){
  const kinds=kind?[kind]:['ghorn','witch'];
  return [...new Set(kinds.flatMap(k=>['modifier:'+k,...(modifierPositions[dungeonId]?.[k]?.spawns??[]).map(p=>p.placementId)]))];
}
export function nativeModifierSpawns(dungeonId,kind,members){
  const preset=modifierPositions[dungeonId]?.[kind];
  return preset&&preset.replacedEnemies.length===members.size&&preset.replacedEnemies.every(id=>members.has(id))?preset.spawns??[]:[];
}
