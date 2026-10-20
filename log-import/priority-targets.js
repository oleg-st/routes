// Groups must come from a matched pack, not from a whole API dungeon pull.
export const MAX_PRIORITY_TARGETS_PER_PACK=1;
export const priorityThresholds=Object.freeze({minShare:.55,minLead:3,
  initialWindowMs:5000,windowMs:5000,minInitialShare:.55,minInitialLead:2,minWindowShare:.45,minWindowLead:1.5,minSustainedFraction:.8,
  minSurvivalMs:1500,minSupporters:2,minPlayerContribution:.1,minPlayerLead:1.5});
// HP remains available in research reports; its value or absence never gates focus.
const diagnosticHPAgeMs=2000;
const identity=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`;
const sum=values=>values.reduce((s,n)=>s+n,0);
const ratio=(a,b)=>b>0?a/b:a>0?Infinity:0;
const totalBy=(events,key)=>{
  const map=new Map();for(const e of events)map.set(key(e),(map.get(key(e))??0)+e.damage);return map;
};
function comparison(hits,key){
  const totals=totalBy(hits,e=>e.key),damage=totals.get(key)??0,total=sum([...totals.values()]);
  const runnerUp=Math.max(0,...[...totals].filter(([k])=>k!==key).map(([,v])=>v));
  return {damage,total,share:total?damage/total:0,lead:ratio(damage,runnerUp)};
}

export function createPriorityTargetAnalyzer({fight,actors,events,complete},{thresholds={}}={}){
  const config={...priorityThresholds,...thresholds},actorByID=new Map(actors.map(a=>[a.id,a]));
  const players=new Set(fight.friendlyPlayers??actors.filter(a=>a.type==='Player').map(a=>a.id));
  const owner=id=>{
    const seen=new Set();
    while(id!=null&&!seen.has(id)){
      if(players.has(id))return id;
      seen.add(id);id=actorByID.get(id)?.petOwner;
    }
    return null;
  };
  const scoped=events.filter(e=>e.fight===fight.id&&e.timestamp>=fight.startTime&&e.timestamp<=fight.endTime).toSorted((a,b)=>a.timestamp-b.timestamp);
  const rows=new Map();
  const rowFor=key=>{if(!rows.has(key))rows.set(key,{key,engaged:Infinity,deaths:[],samples:[],hits:[],missing:[]});return rows.get(key);};
  const active=new Set(['damage','cast','begincast','death']);
  for(const e of scoped){
    for(const side of ['source','target']){
      if(actorByID.get(e[side+'ID'])?.type!=='NPC')continue;
      const r=rowFor(identity(e,side));
      if(!e.positionOnly&&active.has(e.type))r.engaged=Math.min(r.engaged,e.timestamp);
      const hp=e[side+'Resources'];
      if(hp?.maxHitPoints>0&&hp.hitPoints>=0&&hp.hitPoints<=hp.maxHitPoints)r.samples.push({time:e.timestamp,hp:hp.hitPoints/hp.maxHitPoints,maxHP:hp.maxHitPoints});
    }
    if(e.type==='death'&&!e.fake&&actorByID.get(e.targetID)?.type==='NPC')rowFor(identity(e,'target')).deaths.push(e.timestamp);
    if(e.type!=='damage'||!owner(e.sourceID)||actorByID.get(e.targetID)?.type!=='NPC')continue;
    const r=rowFor(identity(e,'target'));
    if(!Number.isFinite(e.amount)||e.amount<0){r.missing.push(e.timestamp);continue;}
    // Fellowship's amount is effective damage: overkill is already excluded.
    const damage=e.amount;
    if(damage)r.hits.push({time:e.timestamp,key:r.key,player:owner(e.sourceID),damage});
  }
  const cache=new Map();
  return function analyze(groups){
    const output=[];
    for(const group of groups){
      const cacheKey=JSON.stringify([group.id,group.boss===true,group.incomplete===true,[...group.mobKeys].sort()]);
      if(cache.has(cacheKey)){output.push(...cache.get(cacheKey));continue;}
      const groupResults=[];
      const members=[...new Set(group.mobKeys)].map(key=>rows.get(key)).filter(Boolean);
      const allHits=members.flatMap(r=>r.hits).sort((a,b)=>a.time-b.time);
      const deathOf=r=>r.deaths[0]??Infinity;
      const hasAlternative=(r,time)=>members.some(other=>other!==r&&other.engaged<=time&&deathOf(other)>time);
      for(const r of members){
        const end=deathOf(r);if(!Number.isFinite(end))continue;
        const start=r.hits[0]?.time??r.engaged;
        // API pull boundaries do not reset or invalidate a mob's damage window.
        const hits=allHits.filter(e=>e.time>=start&&e.time<=end&&hasAlternative(r,e.time));
        const stats=comparison(hits,r.key),missing=members.reduce((s,m)=>s+m.missing.filter(t=>t>=start&&t<=end).length,0);
        const windows=[];
        for(let time=start;time<end;time+=config.windowMs){
          const stop=Math.min(end,time+config.windowMs),window=hits.filter(e=>e.time>=time&&(stop===end?e.time<=stop:e.time<stop));
          const value=comparison(window,r.key);
          windows.push({start:time,end:stop,...value,focused:value.total>0&&value.share>=config.minWindowShare&&value.lead>=config.minWindowLead});
        }
        const damagedWindows=windows.filter(w=>w.total>0);
        const sustained=ratio(sum(damagedWindows.filter(w=>w.focused).map(w=>w.end-w.start)),sum(damagedWindows.map(w=>w.end-w.start)));
        const playerStats=sample=>{
          const total=sum(sample.map(e=>e.damage));
          return [...players].map(player=>{
            const value=comparison(sample.filter(e=>e.player===player),r.key);
            return {player,class:actorByID.get(player)?.subType,...value,supports:value.total>0&&value.total>=total*config.minPlayerContribution&&value.lead>=config.minPlayerLead};
          });
        };
        const perPlayer=playerStats(hits),initialEnd=Math.min(end,start+config.initialWindowMs);
        const initialHits=hits.filter(e=>e.time<initialEnd||initialEnd===end&&e.time===end);
        const initial={...comparison(initialHits,r.key),supportingPlayers:playerStats(initialHits).filter(p=>p.supports).length};
        const final=comparison(hits.filter(e=>e.time>=Math.max(start,end-config.windowMs)),r.key);
        const survivors=members.filter(m=>m!==r&&m.engaged<=end&&deathOf(m)>end+config.minSurvivalMs).map(m=>{
          const sample=m.samples.findLast(s=>s.time<=end),age=sample?end-sample.time:null;
          return {key:m.key,hp:age!==null&&age<=diagnosticHPAgeMs?sample.hp:null,sampleAgeMs:age,deathAfterMs:Number.isFinite(deathOf(m))?deathOf(m)-end:null};
        });
        const reasons=[];
        if(!complete)reasons.push('incomplete-log');
        if(members.length<2)reasons.push('single-mob');
        if(group.boss)reasons.push('boss-encounter');
        if(group.incomplete)reasons.push('incomplete-pack');
        if(missing)reasons.push('missing-damage-amounts');
        if(end<=start)reasons.push('no-damage-window');
        if(stats.share<config.minShare)reasons.push('low-share');
        if(stats.lead<config.minLead)reasons.push('low-lead');
        if(initial.share<config.minInitialShare||initial.lead<config.minInitialLead)reasons.push('no-initial-focus');
        if(initial.supportingPlayers<config.minSupporters)reasons.push('no-initial-party-focus');
        if(final.share<config.minWindowShare||final.lead<config.minWindowLead)reasons.push('focus-lost-before-death');
        if(sustained<config.minSustainedFraction)reasons.push('late-or-inconsistent-focus');
        if(!survivors.length)reasons.push('no-surviving-alternative');
        if(perPlayer.filter(p=>p.supports).length<config.minSupporters)reasons.push('not-shared-by-players');
        groupResults.push({groupId:group.id,key:r.key,start,end,durationMs:end-start,
          candidate:reasons.length===0,reasons,missingDamageEvents:missing,...stats,initial,final,sustained,perPlayer,survivors,windows});
      }
      // Keep the first qualifying focus, not a larger cleanup burst later on.
      const selected=groupResults.filter(r=>r.candidate).sort((a,b)=>a.start-b.start||b.share-a.share||a.end-b.end).slice(0,MAX_PRIORITY_TARGETS_PER_PACK);
      for(const r of groupResults)if(r.candidate&&!selected.includes(r)){r.candidate=false;r.reasons.push('pack-target-limit');}
      cache.set(cacheKey,groupResults);output.push(...groupResults);
    }
    return {thresholds:config,results:output};
  };
}
export function analyzePriorityTargets(log,groups,options){
  return createPriorityTargetAnalyzer(log,options)(groups);
}

// Called only after every pack in the route has been selected. Multiple NPC
// mappings can still describe that same route; mark only agreed placements.
export function detectSelectedRoutePriority(log,state){
  if(!state.complete)throw new Error('Select all route packs before detecting priority targets.');
  const assignments=state.priorityAssignments??[];
  if(!assignments.length)return [];
  const analyze=createPriorityTargetAnalyzer(log);
  const targets=assignments.map(groups=>{
    const placements=new Map(groups.map(g=>[g.id,g.placements]));
    return new Set(analyze(groups).results.filter(r=>r.candidate).map(r=>placements.get(r.groupId)[r.key]));
  });
  return [...targets[0]].filter(id=>targets.every(ids=>ids.has(id))).sort();
}
