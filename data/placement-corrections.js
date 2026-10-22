import {bossEncounterLabel} from './boss-encounters.js';

export function placementName(placement,enemy){
  const encounter=bossEncounterLabel(placement);
  const name=(enemy?.name||placement.id)+(encounter?` (${encounter})`:'');
  return placement.burried?`${name} (burried)`:name;
}

export function correctDungeon(dungeon){
  // The runtime dungeon file is now the game dataset. Old source preferences
  // cannot select a second copy or silently restore external pack definitions.
  if(dungeon.dungeonData==='custom')return dungeon;
  return {...dungeon,dungeonData:'custom'};
}
