// IDs corroborated by Fellowship-overlay's dungeon.rs and dungeon catalogs.
// FL represents the observed Victory Rush effect 44 as abilityGameID 1000044.
export const MODIFIER_IDS=Object.freeze({empoweredAffix:12,victoryRush:1000044,shadowlordNPC:274,ghornNPC:280,witchNPC:281});
// Empowered placements are fixed. Unknown status is not a normal classification.
export function createEmpoweredConstraint({active,confirmedInstances=[],empoweredPlacements=[],healthEvidence=[]}){
  const placements=new Set(empoweredPlacements),states=new Map(healthEvidence.filter(r=>typeof r.empoweredCandidate==='boolean').map(r=>[r.key,r.empoweredCandidate]));
  for(const row of confirmedInstances)states.set(row.key,true);
  return (key,placementID)=>!active||!states.has(key)||states.get(key)===placements.has(placementID);
}
export function modifierEvidence(fight,actors,events){
  const actorById=new Map(actors.map(a=>[a.id,a]));
  const empoweredActive=fight.modifiers?.includes(MODIFIER_IDS.empoweredAffix)??null;
  const confirmed=new Map(),seen=new Map();
  for(const e of events){
    if(e.fight!==fight.id)continue;
    for(const side of ['source','target','attacker']){
      const actor=actorById.get(e[`${side}ID`]);
      if(actor?.type==='NPC'){
        const set=seen.get(actor.gameID)||new Set();set.add(actor.id);seen.set(actor.gameID,set);
      }
    }
    if(!empoweredActive||e.abilityGameID!==MODIFIER_IDS.victoryRush||!['applybuff','refreshbuff'].includes(e.type))continue;
    const source=actorById.get(e.sourceID),target=actorById.get(e.targetID);
    if(source?.type!=='NPC'||target?.type!=='Player')continue;
    // Do not invent instance 1 for a multi-instance actor with missing identity.
    if(!Number.isInteger(e.sourceInstance))continue;
    const key=`${e.sourceID}:${e.sourceInstance}`;
    const evidence=confirmed.get(key)||{key,gameID:source.gameID,eventTimes:[],targetPlayers:[]};
    if(!evidence.eventTimes.includes(e.timestamp))evidence.eventTimes.push(e.timestamp);
    if(!evidence.targetPlayers.includes(e.targetID))evidence.targetPlayers.push(e.targetID);
    confirmed.set(key,evidence);
  }
  const npc=gameID=>({active:seen.has(gameID)?true:null,gameID,observedActorIDs:[...(seen.get(gameID)||[])],
    basis:seen.has(gameID)?'observed-npc':'not-observed-does-not-prove-affix-absent'});
  return {rawIDs:[...(fight.modifiers||[])],empowered:{active:empoweredActive,basis:'metadata-affix-12',
    confirmedInstances:[...confirmed.values()],note:'No Victory Rush does not mean normal: a Chicken target can disappear before death.'},
    shadowlord:npc(MODIFIER_IDS.shadowlordNPC),ghorn:npc(MODIFIER_IDS.ghornNPC),witch:npc(MODIFIER_IDS.witchNPC)};
}
