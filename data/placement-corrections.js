import {customDungeons} from './custom-dungeons.js';
const customByDungeon=new Map(Object.entries(customDungeons).map(([id,data])=>[id,{
  packs:new Map(data.packs.flatMap(pack=>pack.members.map(member=>[member,pack.id]))),
  burried:new Set(data.burried),
}]));

export function placementName(placement,enemy){
  const name=enemy?.name||placement.id;
  return placement.burried?`${name} (burried)`:name;
}

// Build 25647984 has two placements for these bosses. Method's encounter data
// lists only the canonical position. Preserve old route references as aliases.
export const placementAliases={
  'Level.ID.DesertDunes':{'placement-c7446169de7e6c8986cf7b0a73dd5186f8a59f47d519d9b092ce73de4558f2f5':'placement-2f08a0644a58616a92aee8c52e26e64e6160054dba296541b472deed07cee715'},
  'Level.ID.ElfMines':{'placement-22cc9463cbd41916c3fff777b3170e27368a378b4b46188fc07f2379d6f0564c':'placement-e86eb32f0f44ffc23ed2e1b8b08479485c31446efdc707b4eccf68b0efe20c8e'}
};
export function correctDungeon(dungeon,mode=dungeon.dungeonData??'custom'){
  if(typeof mode!=='string')mode=dungeon.dungeonData??'custom'; // Array.map callback compatibility.
  if(!['custom','fellership'].includes(mode))throw new Error('Unknown dungeon data.');
  if(dungeon.dungeonData===mode)return dungeon;
  const aliases=placementAliases[dungeon.id],custom=mode==='custom'?customByDungeon.get(dungeon.id):null;
  return {...dungeon,dungeonData:mode,enemies:dungeon.enemies.filter(p=>!aliases?.[p.placementId]).map(p=>{
    const {buried,burried,originalPackId,...base}=p;
    const packId=originalPackId??p.packId,next=custom?.packs.get(p.placementId)??packId;
    return {...base,packId:next,...(next!==packId?{originalPackId:packId}:{}),...(custom?.burried.has(p.placementId)?{burried:true}:{})};
  })};
}
