import {dungeonDifficulties,healthAffixRules} from './data/game-difficulty.js';
export const difficultyOptions=dungeonId=>dungeonDifficulties[dungeonId]??[];
export const defaultDifficulty=dungeonId=>difficultyOptions(dungeonId)[0]?.value;
export const difficultyChoice=(dungeonId,value)=>difficultyOptions(dungeonId).find(row=>row.value===value);
const healthTargets=Object.fromEntries(Object.entries(healthAffixRules.targets).map(([kind,ids])=>[kind,new Set(ids)]));
export function difficultyHealthModifiers(route,enemyId,{difficulty=route.difficulty,isBossMinion=false}={}){
 const modifiers=difficultyChoice(route.dungeonId,difficulty)?.modifiers??[];
 return {stoneskin:!isBossMinion&&modifiers.includes('stoneskin')&&healthTargets.stoneskin.has(enemyId),ultimatum:modifiers.includes('ultimatum')&&healthTargets.ultimatum.has(enemyId)};
}
export function checkDifficulty(dungeonId,value){
 if(!difficultyChoice(dungeonId,value))throw new Error('Difficulty unavailable in this dungeon.');
 return value;
}
export function applyDifficulty(route){
 if(route.difficulty===undefined)return route; // Unspecified difficulty uses manual affixes.
 const choice=difficultyChoice(route.dungeonId,route.difficulty);
 if(!choice)throw new Error('Difficulty unavailable in this dungeon.');
 route.shadow=choice.modifiers.includes('shadow');
 for(const kind of ['empowered','ghorn','witch'])if(route.modifiers?.[kind])route.modifiers[kind].active=choice.modifiers.includes(kind);
 return route;
}
export function formatHealth(value){
 if(!Number.isFinite(value))return '—';
 const magnitude=Math.abs(value);
 for(const [threshold,suffix] of [[1e12,'t'],[1e9,'b'],[1e6,'m'],[1e3,'k']])if(magnitude>=threshold-.005*(threshold/1000))return (value/threshold).toFixed(2)+suffix;
 return Math.round(value).toLocaleString('en-US');
}
