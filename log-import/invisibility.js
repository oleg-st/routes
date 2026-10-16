// Major Invisibility: cast 1486 (overlay relic item_mapping), buff 1002146
// (verified by extraAbilityGameID:1486 on the supplied report's applybuff).
// Keep each player's actual boundaries; cast time and nominal duration do not
// establish when every member entered or left invisibility.
export function createVisibilityIndex(intervals){
  const byPlayer=Map.groupBy(intervals,i=>i.playerID);
  return {
    stateAt(playerID,time){
      let unknown=false;
      for(const i of byPlayer.get(playerID)??[]){
        const start=i.start?.time??-Infinity,end=i.end?.time??Infinity;
        // At removal the player can body-pull again. Separate intervals keep
        // temporary visible gaps even when the route marker spans those gaps.
        if(time<start||time>=end)continue;
        if(i.start&&i.end)return 'invisible';
        // Missing boundaries cannot justify either a confirmed invisible state
        // or a body-aggro witness; do not silently assume visibility.
        unknown=true;
      }
      return unknown?'unknown':'visible';
    },
  };
}

export function extractInvisibility(events,{fightID,players,complete=false}) {
  const playerIDs=new Set(players.map(p=>p.id));
  const selected=events.filter(e=>e.fight===fightID).toSorted((a,b)=>a.timestamp-b.timestamp);
  const effectIDs=new Set([1002146]);
  for(const e of selected)if(e.type==='applybuff'&&e.extraAbilityGameID===1486)effectIDs.add(e.abilityGameID);
  const point=(e,side)=>{
    const p=e[`${side}Resources`];
    return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x,y:p.y,coordinateSystem:'log',evidence:'event-resources'}:null;
  };
  const boundary=e=>({time:e.timestamp,position:point(e,'target')});
  const casts=selected.filter(e=>e.type==='cast'&&e.abilityGameID===1486&&playerIDs.has(e.sourceID))
    .map(e=>({time:e.timestamp,sourceActorID:e.sourceID,position:point(e,'source')}));
  const active=new Map(),intervals=[];
  for(const e of selected){
    if(!effectIDs.has(e.abilityGameID)||!playerIDs.has(e.targetID))continue;
    const key=`${e.sourceID}:${e.targetID}:${e.targetInstance??1}:${e.abilityGameID}`;
    if(['applybuff','refreshbuff'].includes(e.type)){
      if(active.has(key))continue;
      const interval={playerID:e.targetID,sourceActorID:e.sourceID,effectID:e.abilityGameID,
        start:e.type==='applybuff'?boundary(e):null,end:null,
        observedFrom:boundary(e),status:e.type==='applybuff'?'missing-end':'missing-start-and-end'};
      active.set(key,interval);intervals.push(interval);
    }else if(e.type==='removebuff'){
      const interval=active.get(key);
      if(interval){interval.end=boundary(e);interval.status=interval.start?'complete':'missing-start';active.delete(key);}
      else intervals.push({playerID:e.targetID,sourceActorID:e.sourceID,effectID:e.abilityGameID,
        start:null,end:boundary(e),status:'missing-start'});
    }
  }
  const usages=casts.map((cast,index)=>{
    const next=casts.slice(index+1).find(c=>c.sourceActorID===cast.sourceActorID)?.time??Infinity;
    // Attribute the buff to its caster's activation. Inspect all later entries
    // before that caster's next activation, not just a one-second grace period.
    // An interval crossing the next activation is ambiguous, not a final exit.
    // Do not derive a removal point from the nominal buff duration.
    const members=intervals.filter(i=>{
      const observed=i.start?.time??i.observedFrom?.time??i.end?.time;
      return i.sourceActorID===cast.sourceActorID&&observed>=cast.time&&observed<next;
    });
    const finalExits=[...Map.groupBy(members,i=>i.playerID)].map(([playerID,entries])=>{
      const resolved=entries.every(i=>i.status==='complete'&&i.end.time<next);
      const end=resolved?entries.map(i=>i.end).toSorted((a,b)=>b.time-a.time)[0]:null;
      return {playerID,intervalCount:entries.length,end};
    });
    const resolved=complete&&finalExits.length>0&&finalExits.every(e=>e.end);
    const earliest=resolved?finalExits.toSorted((a,b)=>a.end.time-b.end.time||a.playerID-b.playerID)[0]:null;
    return {kind:'invis',sourceActorID:cast.sourceActorID,
      start:{time:cast.time,position:cast.position},
      end:earliest?{...earliest.end,playerID:earliest.playerID}:null,
      status:resolved?'complete':'unresolved',finalExits,
      endpointRule:'cast-position-to-earliest-final-player-exit',
      attribution:'same-caster-activation'};
  });
  return {status:casts.length||intervals.length?'detected':'not-observed',casts,intervals,usages};
}
