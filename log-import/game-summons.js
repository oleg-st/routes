import {gameSummonRules} from '../data/game-summon-rules.js';

// Game mechanics establish possible parent/child identities. A matching trigger
// and new instance are still required; a type alone must never remove map mobs.
export function classifyGameSummons({fightID,actors,rows,events,rules=gameSummonRules}){
  const actorsByID=new Map(actors.map(a=>[a.id,a])),byActor=Map.groupBy(rows,r=>r.actorID);
  const scoped=events.filter(e=>e.fight===fightID&&e.type==='cast'&&!e.fake&&!e.positionOnly);
  const fresh=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&Number.isFinite(p?.t);
  const eligible=(row,rule)=>rule.childGameIDs.includes(row.gameID)&&Number.isFinite(row.firstTime)&&
    !(row.nearest?.[0]?.distance<2)&&(!rule.minSpawnDistance||!row.nearest?.length||row.nearest[0].distance>=rule.minSpawnDistance);
  const triggers=[];
  for(const rule of rules){
    if(rule.trigger==='cast')for(const e of scoped){
      const actor=actorsByID.get(e.sourceID);
      if(actor?.type!=='NPC'||actor.gameID!==rule.parentGameID||e.abilityGameID!==rule.abilityGameID)continue;
      if(e.sourceResources?.hitPoints!=null&&!(e.sourceResources.hitPoints>0))continue;
      const parents=byActor.get(e.sourceID)??[];
      let matching=e.sourceInstance==null?parents:parents.filter(r=>r.instance===e.sourceInstance);
      if(matching.length>1)matching=matching.filter(r=>r.positions?.some(p=>p.t===e.timestamp&&p.x===e.sourceResources?.x&&p.y===e.sourceResources?.y));
      if(matching.length>1)continue;
      const parent=matching[0];
      if(parents.length&&!parent)continue;
      const attemptStart=actor.subType==='Boss'?Math.max(-Infinity,...events.filter(v=>v.fight===fightID&&v.type==='dungeonencounterstart'&&v.timestamp<=e.timestamp).map(v=>v.timestamp)):-Infinity;
      if(parent?.firstTime>e.timestamp||parent?.deaths?.some(d=>d.timestamp>=attemptStart&&d.timestamp<=e.timestamp))continue;
      triggers.push({rule,time:e.timestamp,sourceID:e.sourceID,sourceKey:parent?.key??`${e.sourceID}:${e.sourceInstance??1}`,
        position:e.sourceResources});
    }
    if(rule.trigger==='death')for(const parent of rows.filter(r=>r.gameID===rule.parentGameID)){
      for(const d of parent.deaths??[]){
        const position=parent.positions?.findLast(p=>p.t<=d.timestamp&&d.timestamp-p.t<=1000);
        if(!fresh(position))continue;
        triggers.push({rule,time:d.timestamp,sourceID:parent.actorID,sourceKey:parent.key,position});
      }
    }
  }
  // Duplicate pages/casts cannot inflate waves or manufacture ambiguity.
  const unique=[...new Map(triggers.map(t=>[`${t.rule.id}:${t.sourceKey}:${t.time}`,t])).values()];
  const waves=new Map();
  for(const row of rows){
    const possible=unique.filter(t=>eligible(row,t.rule)&&row.key!==t.sourceKey&&row.firstTime>=t.time&&row.firstTime-t.time<=t.rule.windowMs&&
      (!t.rule.maxDistance||(fresh(row.firstPosition)&&Math.abs(row.firstPosition.t-row.firstTime)<=3000&&
        Number.isFinite(t.position?.x)&&Number.isFinite(t.position?.y)&&
        Math.hypot(row.firstPosition.x-t.position.x,row.firstPosition.y-t.position.y)<=t.rule.maxDistance))&&
      (t.rule.trigger!=='death'||row.firstPosition.t>=t.time&&row.firstPosition.t-t.time<=t.rule.windowMs&&
        Math.abs(row.firstPosition.t-row.firstTime)<=1000));
    // Repeated casts of one parent are fine. Two plausible parents are not.
    if(new Set(possible.map(t=>t.sourceKey)).size!==1)continue;
    const trigger=possible.toSorted((a,b)=>b.time-a.time)[0];
    if(!waves.has(trigger))waves.set(trigger,[]);waves.get(trigger).push(row);
  }
  return [...waves].flatMap(([t,members])=>{
    if(t.rule.trigger==='death'&&(members.length<t.rule.minCount||members.length>t.rule.maxCount))return [];
    return members.map(row=>({key:row.key,classification:'probable-summon',exclude:true,
      basis:`game-data-${t.rule.trigger}-spawn`,rule:t.rule.id,sourceID:t.sourceID,sourceKey:t.sourceKey,
      abilityGameID:t.rule.abilityGameID,time:t.time,delayMs:row.firstTime-t.time}));
  });
}
