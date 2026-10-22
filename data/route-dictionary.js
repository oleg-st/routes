import {routeMapping} from './route-mapping.js';

export const routeDictionary=id=>routeMapping.dungeons[id];
export function replacementMembers(dungeon,id,members){
  return members??dungeon.enemies.filter(p=>p.packId===id).map(p=>p.placementId);
}
// Non-negative tokens refer to permanent pack compositions. Negative tokens
// refer to individual placements (-index-1), including partial pack selections.
// Match contiguous members so import also preserves the user's selection order.
export function encodeMembers(dictionary,ids){
  const indexes=ids.map(id=>{const i=dictionary.placements.indexOf(id);if(i<0)throw new Error('Unknown route placement.');return i;});
  const byFirst=new Map();
  dictionary.packs.forEach((p,index)=>{const first=p.members[0];if(!byFirst.has(first))byFirst.set(first,[]);byFirst.get(first).push({index,members:p.members});});
  for(const candidates of byFirst.values())candidates.sort((a,b)=>b.members.length-a.members.length||a.index-b.index);
  const encoded=[];
  for(let i=0;i<indexes.length;){
    const pack=byFirst.get(indexes[i])?.find(p=>p.members.every((member,j)=>indexes[i+j]===member));
    if(pack){encoded.push(pack.index);i+=pack.members.length;}else encoded.push(-indexes[i++]-1);
  }
  return encoded;
}
export function decodeMembers(dictionary,tokens){
  if(tokens==null)return [];
  if(!Array.isArray(tokens)||tokens.length>dictionary.placements.length)throw new Error('Invalid route members.');
  const result=[];
  for(const token of tokens){
    if(!Number.isSafeInteger(token))throw new Error('Invalid route member reference.');
    const indexes=token<0?[-token-1]:dictionary.packs[token]?.members;
    if(!indexes)throw new Error('Unknown pack mapping. Update the planner to import this route.');
    for(const index of indexes){const id=dictionary.placements[index];if(!id)throw new Error('Unknown placement mapping.');result.push(id);}
    if(result.length>dictionary.placements.length)throw new Error('Too many route members.');
  }
  return result;
}
