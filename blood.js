import {bloodRules} from './data/game-blood.js';
export {bloodRules};
export function placementBloodDrop(position,route){
  if(route.dungeonId!==bloodRules.dungeonId||!position||position.modifier||route.excluded?.includes(position.placementId))return null;
  return bloodRules.drops[position.id]??null;
}
export function positionsBlood(positions,route){
  const seen=new Set();
  return positions.reduce((total,p)=>{
    if(!p||seen.has(p.placementId))return total;
    seen.add(p.placementId);return total+(placementBloodDrop(p,route)?.blood??0);
  },0);
}
