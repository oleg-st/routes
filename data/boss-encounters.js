// Brogg retreats from the bridge at 70% and is engaged again at the summit.
// Sheepi snapshot: Stormwatch/d16, mm1761 (bridge), mm1841 / pk721 (summit).
// The summit marker is projected from Sheepi's map onto the existing upper
// layer; its world coordinates are approximate, not an extracted spawn anchor.
export const stormwatchBoss={
  dungeonID:'Level.ID.NightPatrol',enemyID:'np-bosshellcaller',
  bridge:'placement-755e1e9b97bdfc209e5bc55fbc698f30b8e74e84643855dc3bcbe570007bda61',
  final:'placement-custom-stormwatch-brogg-final',
};
export function restoreBossEncounters(dungeon){
  if(dungeon.id!==stormwatchBoss.dungeonID||dungeon.enemies.some(p=>p.placementId===stormwatchBoss.final))return dungeon;
  const bridge=dungeon.enemies.find(p=>p.placementId===stormwatchBoss.bridge);
  if(!bridge)return dungeon;
  const worldPosition={x:10192.0193,y:22697.473,z:bridge.worldPosition.z};
  return {...dungeon,enemies:[...dungeon.enemies,{
    id:bridge.id,placementId:stormwatchBoss.final,packId:'pack-custom-stormwatch-brogg-final',
    worldPosition,mapPosition:{x:(worldPosition.y+6391.41)/58000,y:(17876.5535-worldPosition.x)/29000},
    mapImageId:bridge.mapImageId,groupId:null,patrolPath:null,mapPatrolPath:null,
  }]};
}
export function bossEncounterLabel(placement){
  if(placement.placementId===stormwatchBoss.bridge)return 'Bridge';
  if(placement.placementId===stormwatchBoss.final)return 'Final';
  return null;
}
