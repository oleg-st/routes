// Brogg retreats from the bridge at 70% and is engaged again at the summit.
// Sheepi snapshot: Stormwatch/d16, mm1761 (bridge), mm1841 / pk721 (summit).
// The summit marker is projected from Sheepi's map onto the existing upper
// layer; its world coordinates are approximate, not an extracted spawn anchor.
export const stormwatchBoss={
  dungeonID:'Level.ID.NightPatrol',enemyID:'np-bosshellcaller',
  bridge:'placement-755e1e9b97bdfc209e5bc55fbc698f30b8e74e84643855dc3bcbe570007bda61',
  final:'placement-custom-stormwatch-brogg-final',
};
// Sheepi Silken Hollow/d5 has Vexira as mm613 / pk293. The base package
// omits both her catalogue entry and placement. World spawn and the full-map
// marker are corroborated by Method's SH_BossSpider_C_1-0 reference.
export const silkenBoss={
  dungeonID:'Level.ID.SpiderForest',enemyID:'sh-bossspider',gameID:92,
  placementID:'placement-custom-silken-vexira',packID:'pack-custom-silken-vexira',
  worldPosition:{x:46598.22,y:-7388.671,z:-10595.042},
  fullMapPoint:[3257.1428571428573,271.2365388960006],
};
export function restoreBossCatalog(enemies){
  if(enemies.some(e=>e.id===silkenBoss.enemyID))return enemies;
  return [...enemies,{id:silkenBoss.enemyID,gameId:silkenBoss.gameID,name:'Vexira, Mother of Nightmares',
    dungeonScore:0,isBoss:true,canBeControlled:false,images:[{
      // Game portrait from Method's T_NPC_SH_BossSpider.png catalogue asset.
      id:silkenBoss.enemyID,type:'portrait',size:'200',path:'images/enemies/sh-bossspider-portrait-200.avif',
      sha256:'59b296e14b30b75b2a1427fe6a16e3194ef9de5338e47248ea303d0ac9e2f343',width:64,height:64,
      sourcePath:'images/enemies/sh-bossspider-portrait-200.png',sourceSha256:'e118f530fc199368b833a6ac3fe981ea141c64441b0f0e673a8b3688fa57ab20',
    }]}];
}
export function restoreBossEncounters(dungeon){
  if(dungeon.id===silkenBoss.dungeonID){
    if(dungeon.enemies.some(p=>p.id===silkenBoss.enemyID))return dungeon;
    // Inverse of the authored lair source transform in the full-map recipe.
    const [x,y]=silkenBoss.fullMapPoint;
    return {...dungeon,enemies:[...dungeon.enemies,{
      id:silkenBoss.enemyID,placementId:silkenBoss.placementID,packId:silkenBoss.packID,
      worldPosition:{...silkenBoss.worldPosition},
      mapPosition:{x:(x-2256.868836291914)/(1.9193786982248484*1024),y:(y+151.40285996055184)/(1.9193786982248484*512)},
      mapImageId:`${dungeon.id}:T_Map_SF_Lair`,groupId:null,patrolPath:null,mapPatrolPath:null,
    }]};
  }
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
