// Stable route identities for Brogg's bridge and summit encounters.
// Positions and the retreat at 80% HP come from the installed-game export.
export const stormwatchBoss={
  dungeonID:'Level.ID.NightPatrol',enemyID:'np-bosshellcaller',
  bridge:'placement-755e1e9b97bdfc209e5bc55fbc698f30b8e74e84643855dc3bcbe570007bda61',
  final:'placement-custom-stormwatch-brogg-final',
};
// These encounter actors are never damage targets: Vaerith has a permanent
// immunity effect, and Akari is a friendly NPC in the inactive Everdawn Grove.
export const nonCombatBossIds=new Set(['em-bossvaerith','mf-bossunicorn']);
export function bossEncounterLabel(placement){
  if(placement.placementId===stormwatchBoss.bridge)return 'Bridge';
  if(placement.placementId===stormwatchBoss.final)return 'Final';
  return null;
}
