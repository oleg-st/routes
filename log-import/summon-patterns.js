// Infer within this run only. A nearby cast/death alone is not evidence:
// require repeated, separate waves with the same parent/ability/child types.
export function repeatedSummonPatterns({fightID,actors,rows,events}){
  const actorByID=new Map(actors.map(a=>[a.id,a])),byActor=Map.groupBy(rows,r=>r.actorID);
  const fresh=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&Number.isFinite(p?.t);
  const candidates=rows.filter(r=>actorByID.get(r.actorID)?.type==='NPC'&&actorByID.get(r.actorID)?.subType!=='Boss'&&
    fresh(r.firstPosition)&&Math.abs(r.firstPosition.t-r.firstTime)<=1000&&r.nearest?.[0]?.distance>=1000);
  const triggers=[];
  for(const e of events){
    if(e.fight!==fightID||e.type!=='cast'||e.fake||e.positionOnly||!Number.isFinite(e.abilityGameID)||actorByID.get(e.sourceID)?.type!=='NPC')continue;
    const parents=byActor.get(e.sourceID)??[];
    const parent=e.sourceInstance==null?(parents.length===1?parents[0]:undefined):parents.find(r=>r.instance===e.sourceInstance);
    const p=e.sourceResources;
    if(!parent||parent.firstTime>e.timestamp-5000||!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||!(p.hitPoints>0)||
      parent.deaths?.some(d=>d.timestamp<=e.timestamp))continue;
    triggers.push({kind:'cast',parent,ability:e.abilityGameID,time:e.timestamp,p,radius:1000,window:3000});
  }
  for(const parent of rows){
    if(actorByID.get(parent.actorID)?.type!=='NPC')continue;
    for(const death of parent.deaths??[]){
      const p=parent.positions?.findLast(p=>p.t<=death.timestamp&&death.timestamp-p.t<=1000);
      if(!fresh(p)||parent.firstTime>death.timestamp-5000)continue;
      triggers.push({kind:'death',parent,time:death.timestamp,p,radius:400,window:2000});
    }
  }
  // API pages can repeat an event. Duplicates must not create corroboration.
  const unique=[...new Map(triggers.map(t=>[`${t.kind}:${t.parent.key}:${t.ability??''}:${t.time}`,t])).values()];
  const waves=new Map();
  for(const row of candidates){
    const nearby=unique.filter(t=>row.gameID!==t.parent.gameID&&row.firstTime>=t.time&&row.firstTime-t.time<=t.window&&
      Math.hypot(row.firstPosition.x-t.p.x,row.firstPosition.y-t.p.y)<=t.radius);
    // A tight post-death wave is more specific than surrounding combat casts.
    // Two nearby deaths are still ambiguous; never select the nearest corpse.
    const deaths=nearby.filter(t=>t.kind==='death');
    const matches=deaths.length?deaths:nearby.filter(t=>!t.parent.deaths?.some(d=>d.timestamp<=row.firstTime));
    // Multiple possible casters/deaths cannot establish parentage.
    if(matches.length!==1)continue;
    const t=matches[0];
    if(!waves.has(t))waves.set(t,new Map());
    const children=waves.get(t);
    if(!children.has(row.gameID))children.set(row.gameID,[]);
    children.get(row.gameID).push(row);
  }
  const patterns=new Map();
  for(const [trigger,children]of waves)for(const [gameID,members]of children){
    if(Math.max(...members.map(r=>r.firstTime))-Math.min(...members.map(r=>r.firstTime))>1000)continue;
    const key=`${trigger.kind}:${trigger.parent.gameID}:${trigger.ability??''}:${gameID}:${members.length}`;
    if(!patterns.has(key))patterns.set(key,[]);
    patterns.get(key).push({trigger,members});
  }
  const result=[];
  for(const pattern of patterns.values()){
    const ordered=pattern.toSorted((a,b)=>a.trigger.time-b.trigger.time),kind=ordered[0].trigger.kind;
    if(ordered.length<(kind==='death'?2:3)||ordered.some((w,i)=>i&&w.trigger.time-ordered[i-1].trigger.time<5000))continue;
    const first=ordered[0].trigger;
    // Frequent attacks must not become summon abilities from a few coincidences.
    if(kind==='cast'&&ordered.length/unique.filter(t=>t.kind==='cast'&&t.parent.gameID===first.parent.gameID&&t.ability===first.ability).length<0.75)continue;
    if(kind==='death'&&(ordered[0].members.length<2||new Set(ordered.map(w=>w.trigger.parent.key)).size!==ordered.length||
      !ordered.some(w=>Math.hypot(w.trigger.p.x-ordered[0].trigger.p.x,w.trigger.p.y-ordered[0].trigger.p.y)>=1000)))continue;
    for(const {trigger:t,members}of ordered)for(const r of members)result.push({key:r.key,classification:'probable-summon',exclude:true,
      basis:`repeated-npc-${kind}-spawn`,sourceID:t.parent.actorID,sourceKey:t.parent.key,abilityGameID:t.ability,
      time:t.time,delayMs:r.firstTime-t.time,waveCount:ordered.length});
  }
  return result;
}
