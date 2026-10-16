import {stormwatchBoss} from '../data/boss-encounters.js';

const activeTypes=new Set(['damage','cast','begincast','death','applydebuff','refreshdebuff']);
// Encounter identity belongs to the location, not the actor/instance ID or
// attempt number. Brogg may retain an instance after retreating, or receive a
// new one after a wipe. Keep the first engagement of each location separately.
export function encounterIdentity({fight,actors,events},dungeon){
  const ordinary=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`;
  if(dungeon.id!==stormwatchBoss.dungeonID)return {key:ordinary,placements:new Map()};
  const placements=[stormwatchBoss.bridge,stormwatchBoss.final].map(id=>dungeon.enemies.find(p=>p.placementId===id));
  if(placements.some(p=>!p))return {key:ordinary,placements:new Map()};
  const bossIDs=new Set(actors.filter(a=>a.type==='NPC'&&a.gameID===133).map(a=>a.id));
  const playerIDs=new Set(actors.filter(a=>a.type==='Player').map(a=>a.id));
  const scoped=events.filter(e=>e.fight===fight.id).toSorted((a,b)=>a.timestamp-b.timestamp);
  const starts=[...new Set([fight.startTime,...fight.dungeonPulls.map(p=>p.startTime),
    ...scoped.filter(e=>['dungeonencounterstart','dungeonencounterend'].includes(e.type)).map(e=>e.timestamp)])].sort((a,b)=>a-b);
  const windows=starts.map(start=>({start,events:[]}));
  let index=0;
  for(const e of scoped){
    while(index+1<windows.length&&windows[index+1].start<=e.timestamp)index++;
    windows[index].events.push(e);
  }
  const separation=Math.hypot(placements[0].worldPosition.x-placements[1].worldPosition.x,placements[0].worldPosition.y-placements[1].worldPosition.y);
  const locate=resource=>{
    if(!Number.isFinite(resource?.x)||!Number.isFinite(resource?.y))return null;
    const nearest=placements.map(p=>({p,distance:Math.hypot(resource.y-p.worldPosition.x,resource.x-p.worldPosition.y)})).sort((a,b)=>a.distance-b.distance)[0];
    // The restored summit position is approximate. Require a clear location,
    // but do not require an exact spawn match or infer phases from HP/attempts.
    return nearest.distance<separation/3?nearest.p:null;
  };
  const keys=new WeakMap(),phaseTimes=new Map(),activeEncounters=new Set();
  let current=placements[0],hasBoundary=false;
  for(const window of windows){
    const boundaries=window.events.filter(e=>e.timestamp===window.start);
    for(const e of boundaries.filter(e=>e.type==='dungeonencounterend')){activeEncounters.delete(e.encounterID);hasBoundary=true;}
    for(const e of boundaries.filter(e=>e.type==='dungeonencounterstart')){activeEncounters.add(e.encounterID);hasBoundary=true;}
    // Retreating can leave damage, debuffs and resource samples in the log
    // after Brogg has reached the summit. These are not a new engagement.
    // Exclude his observations until the next explicit encounter start; keep
    // the existing position fallback when the log has no boundary evidence.
    if(hasBoundary&&!activeEncounters.size){
      for(const e of window.events)keys.set(e,null);
      continue;
    }
    const combat=window.events.filter(e=>!e.positionOnly&&activeTypes.has(e.type)&&['source','target','attacker'].some(side=>bossIDs.has(e[side+'ID'])));
    const findPosition=ids=>combat.flatMap(e=>['source','target','attacker'].filter(side=>ids.has(e[side+'ID'])).map(side=>locate(e[side+'Resources']))).find(Boolean);
    // Look through the attempt for boss coordinates before using a player's
    // position; ranged players can be far from the boss at the opening cast.
    current=findPosition(bossIDs)??findPosition(playerIDs)??current;
    if(combat.length&&!phaseTimes.has(current.placementId))phaseTimes.set(current.placementId,combat[0].timestamp);
    for(const e of window.events)keys.set(e,`encounter:${current.placementId}`);
  }
  // Some reports put both encounters into one API segment. The encounter
  // boundaries above still establish separate first engagements for the route.
  const pulls=fight.dungeonPulls.flatMap(p=>{
    const times=[...phaseTimes.values()].filter(t=>t>=p.startTime&&t<=p.endTime).sort((a,b)=>a-b);
    const cuts=[p.startTime,...times.slice(1)];
    return cuts.map((startTime,i)=>({...p,id:i?`${p.id}-encounter-${i}`:p.id,startTime,endTime:cuts[i+1]??p.endTime}));
  });
  return {
    key:(e,side)=>bossIDs.has(e[side+'ID'])&&keys.has(e)?keys.get(e):ordinary(e,side),
    placements:new Map(placements.map(p=>[`encounter:${p.placementId}`,p.placementId])),
    pulls,
  };
}
