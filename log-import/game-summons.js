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
  const waves=new Map(),fixedDeathCandidates=new Map();
  for(const row of rows){
    const possible=unique.filter(t=>eligible(row,t.rule)&&row.key!==t.sourceKey&&row.firstTime>=t.time&&row.firstTime-t.time<=t.rule.windowMs&&
      (!t.rule.maxDistance||(fresh(row.firstPosition)&&Math.abs(row.firstPosition.t-row.firstTime)<=3000&&
        Number.isFinite(t.position?.x)&&Number.isFinite(t.position?.y)&&
        Math.hypot(row.firstPosition.x-t.position.x,row.firstPosition.y-t.position.y)<=t.rule.maxDistance))&&
      (t.rule.trigger!=='death'||row.firstPosition.t>=t.time&&row.firstPosition.t-t.time<=t.rule.windowMs&&
        Math.abs(row.firstPosition.t-row.firstTime)<=1000));
    // Fixed-size death waves can overlap. Keep every eligible child in the
    // joint count instead of dropping ambiguous children before counting.
    if(possible.length&&possible.every(t=>t.rule.trigger==='death'&&
      Number.isInteger(t.rule.minCount)&&t.rule.minCount>0&&t.rule.minCount===t.rule.maxCount)){
      fixedDeathCandidates.set(row,possible);continue;
    }
    // Repeated casts of one parent are fine. Two plausible casters are not.
    if(new Set(possible.map(t=>t.sourceKey)).size!==1)continue;
    const trigger=possible.toSorted((a,b)=>b.time-a.time)[0];
    if(!waves.has(trigger))waves.set(trigger,[]);waves.get(trigger).push(row);
  }
  return [...classifyFixedDeathWaves(fixedDeathCandidates),...[...waves].flatMap(([t,members])=>{
    if(t.rule.trigger==='death'&&(members.length<t.rule.minCount||members.length>t.rule.maxCount))return [];
    return members.map(row=>({key:row.key,classification:'probable-summon',exclude:true,
      basis:`game-data-${t.rule.trigger}-spawn`,rule:t.rule.id,sourceID:t.sourceID,sourceKey:t.sourceKey,
      abilityGameID:t.rule.abilityGameID,time:t.time,delayMs:row.firstTime-t.time}));
  })];
}

function classifyFixedDeathWaves(candidates){
  const byTrigger=new Map();
  for(const [row,triggers]of candidates)for(const t of triggers){
    if(!byTrigger.has(t))byTrigger.set(t,[]);
    byTrigger.get(t).push(row);
  }
  const visited=new Set(),result=[];
  for(const start of candidates.keys()){
    if(visited.has(start))continue;
    const members=new Set([start]),triggers=new Set();
    for(const row of members){
      visited.add(row);
      for(const t of candidates.get(row)){
        triggers.add(t);
        for(const child of byTrigger.get(t))members.add(child);
      }
    }
    // Different mechanics or repeated death records for one parent do not
    // establish independent waves. Require all expected children, with a
    // feasible assignment to the individual corpses' count and geometry.
    const ts=[...triggers];
    if(new Set(ts.map(t=>t.rule.id)).size!==1||new Set(ts.map(t=>t.sourceKey)).size!==ts.length)continue;
    const slots=ts.flatMap(t=>Array.from({length:t.rule.minCount},()=>t));
    if(slots.length!==members.size)continue;
    const assigned=new Map();
    const place=(row,seen)=>{
      for(let i=0;i<slots.length;i++){
        if(seen.has(i)||!candidates.get(row).includes(slots[i]))continue;
        seen.add(i);
        if(!assigned.has(i)||place(assigned.get(i),seen)){assigned.set(i,row);return true;}
      }
      return false;
    };
    if(![...members].every(row=>place(row,new Set())))continue;
    for(const row of members){
      const possible=candidates.get(row),t=possible[0];
      result.push({key:row.key,classification:'probable-summon',exclude:true,
        basis:'game-data-death-spawn',rule:t.rule.id,abilityGameID:t.rule.abilityGameID,
        ...(possible.length===1?{sourceID:t.sourceID,sourceKey:t.sourceKey,time:t.time,delayMs:row.firstTime-t.time}:
          {sources:possible.map(p=>({sourceID:p.sourceID,sourceKey:p.sourceKey,time:p.time,delayMs:row.firstTime-p.time}))})});
    }
  }
  return result;
}
