import {gameServiceRules as rules} from './data/game-service-rules.js';
import {healthAffixRules} from './data/game-difficulty.js';
export function modifierAvailable(dungeonId,kind){
 return rules.modifierAvailabilityByDungeon[dungeonId]?.[kind]===true;
}
export function restrictRouteModifiers(route){
 if(route.shadow===true&&!modifierAvailable(route.dungeonId,'shadow'))route.shadow=false;
 for(const kind of ['empowered','ghorn','witch'])if(route.modifiers?.[kind]?.active===true&&!modifierAvailable(route.dungeonId,kind))route.modifiers[kind].active=false;
 return route;
}
// CRAICharacter::GetKillScore returns zero for excluded actors and CeilToInt
// of the current KillScore attribute otherwise (after effect multiplication).
export function gameKillScore(enemy,empowered=false){
 const base=enemy?.dungeonScore;if(!Number.isFinite(base))return null;
 if(enemy.countsTowardsDungeonScore===false)return 0;
 return Math.ceil(Math.fround(Math.fround(base)*Math.fround(empowered?rules.empoweredScoreMultiplier:1)));
}
export function difficultyHealthScale(difficulty=0){
 if(!Number.isInteger(difficulty))throw new Error('Difficulty must be an integer');
 const values=rules.difficultyHealthScales;
 return values[Math.min(values.length-1,Math.max(0,difficulty))];
}
export function enemyHealth(enemy,{empowered=false,stoneskin=false,ultimatum=false,difficulty=0}={}){
 const base=enemy?.baseHealth;if(!Number.isFinite(base))return null;
 const ordinary=base*difficultyHealthScale(difficulty)*(ultimatum?healthAffixRules.ultimatumMultiplier:1);
 const capped=rules.modifierDifficultyCap>0?Math.min(difficulty,rules.modifierDifficultyCap):difficulty;
 // Empowered and Stone Skin independently add capped base HP (AddFinal).
 // Stone Skin also carries the game's flat post-calculation bonus.
 return ordinary+(empowered?base*difficultyHealthScale(capped)*rules.empoweredHealthBonus:0)+(stoneskin?base*difficultyHealthScale(capped)*healthAffixRules.stoneSkinBonus+healthAffixRules.stoneSkinFlatBonus:0);
}
export function shadowTarget(dungeon){
 const lords=rules.shadowLordsByDungeon[dungeon.id]??dungeon.shadowLords;
 if(!Number.isInteger(lords)||lords<=0)throw new Error('Missing game Shadow Lord configuration for '+dungeon.id);
 return Math.ceil(lords*rules.shadowOrbsPerLord);
}
export function orbCount(score,dungeon){
 if(!Number.isFinite(score)||!Number.isFinite(dungeon.requiredScore)||dungeon.requiredScore<=0)return 0;
 const completion=Math.floor(Math.max(0,score)/dungeon.requiredScore*100+.5);
 if(!Number.isSafeInteger(completion))throw new RangeError('Shadow score exceeds supported precision');
 const step=Math.fround(1/shadowTarget(dungeon));
 // Blueprint stores a float32 step in a double accumulator, and compares
 // Round(percent*100). Binary search reproduces those thresholds without a
 // proportional approximation. Totals are potential orbs before ability end.
 let lo=0,hi=Math.ceil((completion+1)/(step*100))+1;
 while(lo+1<hi){const mid=Math.floor((lo+hi)/2);if(Math.floor(mid*step*100+.5)<=completion)lo=mid;else hi=mid;}
 return lo;
}
export const shadowOrbsPerLord=rules.shadowOrbsPerLord;
