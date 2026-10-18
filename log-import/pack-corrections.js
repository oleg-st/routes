export function correctImportPacks(packs,{catalog}){
  const byPlacement=new Map();
  // Game data distinguishes initial Dormant from an unburrow animation. Only
  // Dormant is evidence for player-contact activation and a separate pull.
  for(const pack of packs)for(const p of pack.placements)if(p.gameGuid?p.dormant===true:p.burried===true||p.buried===true){
    byPlacement.set(p.placementId,{suffix:p.placementId,label:'buried',activation:'player-contact'});
  }
  if(!packs.some(pack=>pack.placements.some(p=>byPlacement.has(p.placementId))))return packs;
  return packs.flatMap(pack=>{
    if(!pack.placements.some(p=>byPlacement.has(p.placementId)))return [pack];
    return [...Map.groupBy(pack.placements,p=>byPlacement.get(p.placementId)??null)].map(([rule,members])=>{
      const id=rule?`${pack.id}:${rule.suffix}`:pack.id;
      const placements=members.map(p=>({...p,packId:id,...(rule?.activation?{activation:rule.activation}:{})}));
      return {...pack,id,sourcePackId:pack.id,number:rule?`${pack.number} (${rule.label})`:pack.number,placements,
        counts:Object.fromEntries([...Map.groupBy(placements,p=>catalog.get(p.id).gameId)].map(([type,ps])=>[type,ps.length]))};
    });
  });
}
