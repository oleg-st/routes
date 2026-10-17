import {matchingConfig} from './matching-config.js';
import {repeatedSummonPatterns} from './summon-patterns.js';
// Direct Fellowship Logs identity and known mechanics take precedence over
// the generic proximity and repeated-wave fallbacks below.
export const verifiedSummonRules=Object.freeze([
  {bossGameID:133,abilityGameID:631,childGameIDs:[134],windowMs:3000,id:'brogg-raiders'},
  // Chilgar's Grasping Pillar (222) releases Frozen Remnants when broken.
  // Confirmed by the user in report c4nFLaThdAxtVpYv/88. Require a nearby
  // recent pillar cast and no first position near a static Remnant spawn.
  {bossGameID:28,abilityGameID:222,childGameIDs:[155],windowMs:15000,maxDistance:3000,minSpawnDistance:1000,id:'chilgar-pillar'},
  // Silken Hollow: user-confirmed Recluse/Kidnapper summons in
  // cRPvJkZLBG7V8zaF/5. All eight appear 0.9–5.7 s after cast 1396,
  // within 3,072 units of the boss and far from their static spawns.
  {bossGameID:92,abilityGameID:1396,childGameIDs:[90,91],windowMs:8000,maxDistance:4000,minSpawnDistance:1000,id:'silken-boss-adds'},
]);
export function classifySummons({fightID,actors,rows,events,rules=verifiedSummonRules,bossAddRadius=matchingConfig.bossAddRadius}){
  const actorByID=new Map(actors.map(a=>[a.id,a])),result=new Map();
  const scoped=events.filter(e=>e.fight===fightID);
  for(const row of rows){
    const direct=scoped.find(e=>e.type==='summon'&&e.targetID===row.actorID&&
      (e.targetInstance===row.instance||e.targetInstance==null&&rows.filter(r=>r.actorID===row.actorID).length===1)&&e.timestamp<=row.firstTime);
    if(direct){result.set(row.key,{key:row.key,classification:'summon',basis:'fl-summon-event',sourceID:direct.sourceID,time:direct.timestamp});continue;}
    const owner=actorByID.get(row.actorID)?.petOwner;
    if(owner>0&&actorByID.get(owner)?.type==='NPC'){
      result.set(row.key,{key:row.key,classification:'summon',basis:'fl-npc-owner',sourceID:owner});continue;
    }
    // An exact static anchor is counterevidence to excluding a late-pulled pack.
    if(row.nearest?.[0]?.distance<2)continue;
    for(const rule of rules){
      if(!rule.childGameIDs.includes(row.gameID))continue;
      if(rule.minSpawnDistance&&!(row.nearest?.[0]?.distance>=rule.minSpawnDistance))continue;
      const cast=scoped.find(e=>e.type==='cast'&&!e.fake&&e.abilityGameID===rule.abilityGameID&&actorByID.get(e.sourceID)?.gameID===rule.bossGameID&&
        row.firstTime>=e.timestamp&&row.firstTime-e.timestamp<=rule.windowMs&&
        (!rule.maxDistance||Math.hypot(row.firstPosition?.x-e.sourceResources?.x,row.firstPosition?.y-e.sourceResources?.y)<=rule.maxDistance));
      if(cast){result.set(row.key,{key:row.key,classification:'probable-summon',basis:'verified-summon-cast-and-new-instance',rule:rule.id,
        sourceID:cast.sourceID,time:cast.timestamp,delayMs:row.firstTime-cast.timestamp});break;}
    }
  }
  // GA_FK_IceGolem_OnDeathSpawnMobs (Shatter): a complete trio appears around
  // the dying golem. Corroborated across /86, /89 and /90. Require all three,
  // actual death, fresh parent coordinates and a tight time/position window;
  // timing alone must not remove ordinary Shardlings pulled nearby.
  for(const parent of rows.filter(r=>r.gameID===160))for(const death of parent.deaths??[]){
    const position=parent.positions?.findLast(p=>p.t<=death.timestamp&&death.timestamp-p.t<=1000);
    if(!position)continue;
    const children=rows.filter(r=>r.gameID===161&&!result.has(r.key)&&!(r.nearest?.[0]?.distance<2)&&
      r.firstTime>=death.timestamp&&r.firstTime-death.timestamp<=2000&&r.firstPosition?.t-death.timestamp<=2000&&
      Math.hypot(r.firstPosition.x-position.x,r.firstPosition.y-position.y)<=400);
    if(children.length!==3)continue;
    for(const row of children)result.set(row.key,{key:row.key,classification:'probable-summon',basis:'verified-death-spawn-trio',
      rule:'golem-shatter',sourceID:parent.actorID,sourceKey:parent.key,time:death.timestamp,delayMs:row.firstTime-death.timestamp});
  }
  // Retain earlier confirmed mechanics beyond the conservative generic
  // radius (e.g. Titan's distant Wardstones). New bosses need no entry here.
  const encounterRules=[{boss:168,children:[164,165],id:'noor-ambush'},
    {boss:172,children:[241],id:'titan-wardstones'},{boss:199,children:[182],id:'vunkahr-vines'},
    // Han-Eth's Palace Response Unit includes Broods and, on Nightmare,
    // a Heart of Rot with two Echoes. One Echo in hxH8B2mjM7D34Azt/8
    // is first recorded 3,533 units from the stationary boss.
    {boss:319,children:[334,326,316],id:'han-eth-response-unit'}];
  for(const suspected of suspectLateEncounterNPCs({fightID,actors,rows,events})){
    const row=rows.find(r=>r.key===suspected.key);
    if(result.has(row.key)||!(row.nearest?.[0]?.distance>=1000))continue;
    const start=row.firstTime-suspected.delayMs;
    for(const rule of encounterRules){
      if(!rule.children.includes(row.gameID))continue;
      const parent=rows.find(r=>r.gameID===rule.boss&&r.positions?.some(p=>p.t>=start&&p.t<=row.firstTime&&p.hp>0)&&
        !(r.deaths??[]).some(d=>d.timestamp>=start&&d.timestamp<row.firstTime));
      const position=parent?.positions?.findLast(p=>p.t<=row.firstTime&&row.firstTime-p.t<=10000);
      if(!position||Math.hypot(row.firstPosition?.x-position.x,row.firstPosition?.y-position.y)>6000)continue;
      result.set(row.key,{...suspected,classification:'probable-summon',exclude:true,basis:'verified-boss-add-and-late-appearance',rule:rule.id,sourceKey:parent.key});break;
    }
  }
  for(const add of bossProximityAdds({fightID,actors,rows,events,radius:bossAddRadius}))if(!result.has(add.key))result.set(add.key,add);
  for(const summon of repeatedSummonPatterns({fightID,actors,rows,events}))if(!result.has(summon.key))result.set(summon.key,summon);
  return [...result.values()];
}

// User-confirmed game rule: ordinary packs do not spawn next to bosses.
// Classify only at first appearance, using fresh combat coordinates, never a
// mob's later arrival beside a boss. Near-static spawns stay ordinary enemies;
// Types absent from the map also need classification when Chicken targets them.
export function bossProximityAdds({fightID,actors,rows,events,radius=matchingConfig.bossAddRadius}){
  if(!Number.isFinite(radius)||radius<0)throw new Error('Invalid boss add radius');
  const bossIDs=new Set(actors.filter(a=>a.type==='NPC'&&a.subType==='Boss').map(a=>a.id));
  const intervals=encounterIntervals(events,fightID),hasBoundaries=events.some(e=>e.fight===fightID&&e.type.startsWith('dungeonencounter'));
  const combat=new Set(['damage','cast','begincast']);
  const bosses=rows.filter(r=>bossIDs.has(r.actorID));
  return rows.flatMap(row=>{
    const p=row.firstPosition;
    if(bossIDs.has(row.actorID)||!Number.isFinite(row.firstTime)||!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||
      !Number.isFinite(p.t)||Math.abs(p.t-row.firstTime)>3000||
      (row.nearest?.length&&!(row.nearest[0].distance>=1000)))return [];
    const encounter=intervals.find(e=>row.firstTime>=e.start-1000&&row.firstTime<e.end);
    if(hasBoundaries&&!encounter)return [];
    const witnesses=bosses.flatMap(boss=>{
      // A recorded death in this attempt rules out stale post-death samples.
      if(boss.deaths?.some(d=>d.timestamp>=(encounter?.start??-Infinity)&&d.timestamp<=row.firstTime))return [];
      const positions=(boss.positions??[]).filter(b=>b.hp>0&&combat.has(b.eventType)&&
        Math.abs(b.t-row.firstTime)<=3000&&(!encounter||b.t>=encounter.start&&b.t<encounter.end));
      positions.sort((a,b)=>Math.abs(a.t-row.firstTime)-Math.abs(b.t-row.firstTime));
      const b=positions[0];if(!b)return [];
      const distance=Math.hypot(p.x-b.x,p.y-b.y);
      return distance<=radius?[{boss,b,distance}]:[];
    }).sort((a,b)=>a.distance-b.distance);
    const witness=witnesses[0];
    return witness?[{key:row.key,classification:'probable-summon',exclude:true,basis:'first-appearance-near-active-boss',
      sourceKey:witness.boss.key,time:row.firstTime,bossSampleTime:witness.b.t,distance:witness.distance}]:[];
  });
}

function encounterIntervals(events,fightID){
  const intervals=[],active=new Map();
  for(const e of events.filter(e=>e.fight===fightID).toSorted((a,b)=>a.timestamp-b.timestamp)){
    if(e.type==='dungeonencounterstart')active.set(e.encounterID,e.timestamp);
    if(e.type==='dungeonencounterend'&&active.has(e.encounterID)){
      intervals.push({id:e.encounterID,start:active.get(e.encounterID),end:e.timestamp});active.delete(e.encounterID);
    }
  }
  for(const [id,start]of active)intervals.push({id,start,end:Infinity});
  return intervals;
}

// General overlay heuristic, retained as a diagnostic across ALL encounters.
// Never exclude these instances solely because they appeared late in a boss fight.
export function suspectLateEncounterNPCs({fightID,actors,rows,events,minimumDelayMs=12000}){
  const bosses=new Set(actors.filter(a=>a.subType==='Boss').map(a=>a.id));
  const intervals=[],active=new Map();
  for(const e of events.filter(e=>e.fight===fightID).sort((a,b)=>a.timestamp-b.timestamp)){
    if(e.type==='dungeonencounterstart')active.set(e.encounterID,e.timestamp);
    if(e.type==='dungeonencounterend'&&active.has(e.encounterID)){
      intervals.push({id:e.encounterID,start:active.get(e.encounterID),end:e.timestamp});active.delete(e.encounterID);
    }
  }
  for(const [id,start]of active)intervals.push({id,start,end:Infinity});
  return rows.filter(r=>!bosses.has(r.actorID)&&r.nearest?.length&&r.nearest[0].distance>=2).flatMap(r=>{
    const encounter=intervals.find(e=>r.firstTime>=e.start+minimumDelayMs&&r.firstTime<=e.end);
    return encounter?[{key:r.key,gameID:r.gameID,encounterID:encounter.id,delayMs:r.firstTime-encounter.start,
      classification:'suspected-only',exclude:false,basis:'overlay-late-first-observation-heuristic'}]:[];
  });
}
