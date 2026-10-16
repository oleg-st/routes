// Build only the identities, positions and HP evidence consumed by matching.
export function analyzeRouteEvents({fight,actors,events},dungeon,catalog,{key=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`}={}){
  const actorByID=new Map(actors.map(a=>[a.id,a])),instances=new Map();
  const byGameID=Map.groupBy(dungeon.enemies,p=>catalog.get(p.id)?.gameId);
  for(const e of events){
    for(const side of ['source','target','attacker']){
      const actor=actorByID.get(e[side+'ID']);if(!actor)continue;
      const instance=e[side+'Instance']??1,identity=key(e,side);
      let row=instances.get(identity);
      if(!row){row={key:identity,actorID:actor.id,instance,gameID:actor.gameID,type:actor.type,name:catalog.get(byGameID.get(actor.gameID)?.[0]?.id)?.name??actor.type,
        firstTime:Infinity,positions:[],deaths:[]};instances.set(identity,row);}
      if(!e.positionOnly)row.firstTime=Math.min(row.firstTime,e.timestamp);
      if(side==='target'&&e.type==='death'&&!e.fake)row.deaths.push({timestamp:e.timestamp});
      const r=e[side+'Resources'];
      if(!Number.isFinite(r?.x)||!Number.isFinite(r?.y))continue;
      const p={t:e.timestamp,x:r.x,y:r.y,hp:r.hitPoints,maxHP:r.maxHitPoints,eventType:e.type};
      const previous=row.positions.at(-1);
      if(!previous||previous.t!==p.t||previous.x!==p.x||previous.y!==p.y||previous.maxHP!==p.maxHP||previous.eventType!==p.eventType)row.positions.push(p);
    }
  }
  const trajectories=[...instances.values()];
  for(const r of trajectories){
    r.positions.sort((a,b)=>a.t-b.t);r.firstPosition=r.positions[0];
    r.nearest=r.firstPosition?(byGameID.get(r.gameID)??[]).map(p=>({placementId:p.placementId,
      distance:Math.hypot(r.firstPosition.y-p.worldPosition.x,r.firstPosition.x-p.worldPosition.y)})).sort((a,b)=>a.distance-b.distance).slice(0,2):[];
  }
  return {trajectories,npcRows:trajectories.filter(r=>r.type==='NPC'&&Number.isFinite(r.firstTime))};
}

// Corroborate HP contrasts within this run; no fixed global empowered multiplier.
export function routeHealthEvidence(rows){
  const health=rows.map(r=>{
    const histogram=new Map();
    for(const p of r.positions)if(p.maxHP>0)histogram.set(p.maxHP,(histogram.get(p.maxHP)??0)+1);
    return {key:r.key,gameID:r.gameID,maxHP:[...histogram].sort((a,b)=>b[1]-a[1])[0]?.[0]};
  });
  const contrasts=[...Map.groupBy(health,r=>r.gameID)].flatMap(([gameID,rs])=>{
    const levels=[...new Set(rs.map(r=>r.maxHP).filter(Boolean))].sort((a,b)=>a-b);
    return levels.length===2&&levels[1]/levels[0]>1.4?[{gameID,levels,ratio:levels[1]/levels[0]}]:[];
  });
  const corroborated=contrasts.filter(c=>contrasts.filter(b=>Math.abs(b.ratio/c.ratio-1)<0.0001).length>=3);
  return health.flatMap(r=>{const c=corroborated.find(c=>c.gameID===r.gameID);return c&&r.maxHP?[{key:r.key,empoweredCandidate:r.maxHP===c.levels[1]}]:[];});
}

// Reconstruct short gaps between player samples at enemy engagement times.
// Never extrapolate, bridge a death/map change, or interpolate teleport jumps.
export function interpolatePlayerPositions(trajectories,times,{visibility,mapChanges=[],maxGapMs=2000,maxSpeed=3000}={}){
  const result=[],ordered=[...new Set(times)].sort((a,b)=>a-b);
  for(const row of trajectories.filter(r=>r.type==='Player')){
    let i=0;
    for(const t of ordered){
      while(i+1<row.positions.length&&row.positions[i+1].t<t)i++;
      const a=row.positions[i],b=row.positions[i+1];
      if(!a||!b||a.t>=t||b.t<=t||b.t-a.t>maxGapMs||a.hp<=0||b.hp<=0)continue;
      if(row.deaths.some(d=>d.timestamp>=a.t&&d.timestamp<=b.t)||mapChanges.some(m=>m.timestamp>=a.t&&m.timestamp<=b.t))continue;
      if(Math.hypot(b.x-a.x,b.y-a.y)/(b.t-a.t)*1000>maxSpeed)continue;
      if(visibility&&[a.t,t,b.t].some(time=>visibility.stateAt(row.actorID,time)!=='visible'))continue;
      const fraction=(t-a.t)/(b.t-a.t);
      result.push({key:row.key,type:'Player',t,x:a.y+(b.y-a.y)*fraction,y:a.x+(b.x-a.x)*fraction,hp:Math.min(a.hp,b.hp),visibility:'visible',interpolated:true});
    }
  }
  return result;
}
