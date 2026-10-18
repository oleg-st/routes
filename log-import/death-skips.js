import {campfires as dungeonCampfires} from '../data/map-campfires.js';

// Game build 25647984: GA_Shared_UpdateRespawnSpawnPoint (959) is blocked
// while in combat. GE_Shared_RespawnCooldown (109 -> log ID 1000109)
// identifies a respawn, unlike a player resurrection or a later HP sample.
const checkpointAbility=959,respawnEffect=1000109;
const alive=r=>Number.isFinite(r?.x)&&Number.isFinite(r?.y)&&r.maxHitPoints>0&&r.hitPoints>0&&r.hitPoints<=r.maxHitPoints;
const distance=(r,c)=>Math.hypot(r.y-c.worldPosition.x,r.x-c.worldPosition.y);

export function confirmedDeathSkips(log,rows,{key=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`,
  dungeonID,campfires=dungeonCampfires[dungeonID]??[],campfireRadius=1000}={}){
  if(!log.complete||!campfires.length)return [];
  const {fight,actors}=log,events=log.events.filter(e=>e.fight===fight.id&&!e.fake).toSorted((a,b)=>a.timestamp-b.timestamp);
  const combatEvents=events.filter(e=>!e.positionOnly);
  const players=new Set(actors.filter(a=>a.type==='Player').map(a=>a.id)),actorByID=new Map(actors.map(a=>[a.id,a]));
  const player=id=>players.has(id)?id:players.has(actorByID.get(id)?.petOwner)?actorByID.get(id).petOwner:null;
  const bosses=new Set(actors.filter(a=>a.subType==='Boss').map(a=>a.id));
  const chicken=new Set(combatEvents.filter(e=>e.type==='cast'&&e.abilityGameID===1478).map(e=>key(e,'target')));
  const byKey=new Map(rows.map(r=>[r.key,r])),lastSeen=new Map();
  for(const e of combatEvents)for(const side of ['source','target','attacker']){
    const id=key(e,side);
    if(byKey.has(id))lastSeen.set(id,Math.max(lastSeen.get(id)??-Infinity,e.timestamp));
  }
  const nearest=r=>{
    if(!Number.isFinite(r?.x)||!Number.isFinite(r?.y))return null;
    const nearby=campfires.filter(c=>distance(r,c)<=campfireRadius);
    return nearby.length===1?nearby[0]:null;
  };
  const skips=[],hostile=new Set(['damage','cast','begincast','applydebuff','refreshdebuff','death']);
  for(const pull of fight.dungeonPulls){
    if(pull.encounterID)continue;
    // API pull boundaries can precede the killing blow by a few milliseconds.
    const end=pull.endTime+1000;
    const during=combatEvents.filter(e=>e.timestamp>=pull.startTime&&e.timestamp<=end);
    const members=rows.filter(r=>r.firstTime>=pull.startTime&&r.firstTime<=pull.endTime);
    if(!members.length||members.some(r=>bosses.has(r.actorID)))continue;
    // The checkpoint/respawn sequence proves the skip without a final NPC HP
    // sample. Keep kills, Chicken targets and mobs engaged again later.
    const skippedMembers=members.filter(r=>!chicken.has(r.key)&&!r.deaths.length&&lastSeen.get(r.key)<=end);
    if(!skippedMembers.length)continue;
    const memberKeys=new Set(members.map(r=>r.key)),participants=new Set();
    // Direct hostile interactions (including pets) establish participation.
    // Passive healing/buffs do not prove that the healer entered this combat.
    for(const e of during.filter(e=>hostile.has(e.type))){
      if(memberKeys.has(key(e,'target')))for(const side of ['source','attacker']){const id=player(e[side+'ID']);if(id)participants.add(id);}
      if(memberKeys.has(key(e,'source'))||memberKeys.has(key(e,'attacker'))){const id=player(e.targetID);if(id)participants.add(id);}
    }
    if(!participants.size||participants.size>=players.size)continue;
    const deaths=new Map(during.filter(e=>e.type==='death'&&players.has(e.targetID)).map(e=>[e.targetID,e.timestamp]));
    if([...participants].some(id=>!deaths.has(id)))continue;
    // The runner may activate the checkpoint while the tank is still kiting.
    // Activation must precede respawns, not necessarily the participants' deaths.
    const activations=events.filter(e=>e.type==='cast'&&e.abilityGameID===checkpointAbility&&
      e.timestamp>=pull.startTime&&e.timestamp<=fight.endTime&&players.has(e.sourceID)&&!participants.has(e.sourceID));
    for(const activation of activations){
      const campfire=nearest(activation.sourceResources);if(!campfire)continue;
      // A bystander who also died makes this a wipe/recovery, not this skip.
      if(events.some(e=>e.type==='death'&&e.targetID===activation.sourceID&&e.timestamp>=pull.startTime&&e.timestamp<=activation.timestamp))continue;
      const respawns=[];
      for(const id of participants){
        const after=events.filter(e=>e.timestamp>deaths.get(id)&&e.timestamp<=fight.endTime);
        // The first explicit respawn must follow activation at the same fire.
        const respawn=after.find(e=>e.type==='applydebuff'&&e.abilityGameID===respawnEffect&&e.targetID===id);
        if(!respawn||respawn.timestamp<activation.timestamp||nearest(respawn.targetResources)?.id!==campfire.id)break;
        // Do not mislabel combat resurrection or an earlier return to life.
        if(after.some(e=>e.timestamp<respawn.timestamp&&(e.type==='resurrect'&&e.targetID===id||
          ['source','target'].some(side=>e[side+'ID']===id&&alive(e[side+'Resources'])))))break;
        respawns.push({playerID:id,time:respawn.timestamp});
      }
      if(respawns.length!==participants.size)continue;
      skips.push({pullID:pull.id,enemyKeys:skippedMembers.map(r=>r.key),playerIDs:[...participants],campfireID:campfire.id,
        activatedBy:activation.sourceID,activatedAt:activation.timestamp,respawns,endTime:Math.max(...respawns.map(r=>r.time))});
      break;
    }
  }
  return skips;
}

export function deathSkipRows(log,rows,options){
  return confirmedDeathSkips(log,rows,options).flatMap(s=>s.enemyKeys.map(key=>({key,pullID:s.pullID,reason:'survived-death-skip'})));
}
