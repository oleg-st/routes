// A failed trash pull can leave only part of a pack alive. Keep those
// observations for placement matching, but do not turn them into route kills.
// Missing death events alone are insufficient: require a player death at the
// pull boundary and a fresh, valid positive-HP sample of the surviving NPC.
export function abandonedPullSurvivors(log,rows,{key=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`}={}){
  if(!log.complete)return [];
  const {fight,actors}=log,events=log.events.filter(e=>e.fight===fight.id&&!e.fake).toSorted((a,b)=>a.timestamp-b.timestamp);
  const players=new Set(actors.filter(a=>a.type==='Player').map(a=>a.id));
  const bosses=new Set(actors.filter(a=>a.subType==='Boss').map(a=>a.id));
  const byKey=new Map(rows.map(r=>[r.key,r])),lastSeen=new Map(),lastHP=new Map(),resolved=new Set();
  for(const e of events){
    if(e.type==='death'||e.type==='damage'&&e.overkill>0||e.type==='cast'&&e.abilityGameID===1478)resolved.add(key(e,'target'));
    for(const side of ['source','target','attacker']){
      const id=key(e,side);if(!byKey.has(id))continue;
      if(!e.positionOnly)lastSeen.set(id,e.timestamp);
      const r=e[side+'Resources'];
      if(Number.isFinite(r?.hitPoints)&&r.maxHitPoints>0&&r.hitPoints>=0&&r.hitPoints<=r.maxHitPoints){
        lastHP.set(id,{time:e.timestamp,hp:r.hitPoints});
        if(r.hitPoints===0)resolved.add(id);
      }
    }
  }
  const survivors=[];
  for(const pull of fight.dungeonPulls){
    if(pull.encounterID)continue;
    const end=pull.endTime;
    const deaths=events.filter(e=>e.type==='death'&&players.has(e.targetID)&&Math.abs(e.timestamp-end)<=1000);
    if(!deaths.length)continue;
    for(const row of rows){
      const hp=lastHP.get(row.key),last=lastSeen.get(row.key);
      if(bosses.has(row.actorID)||resolved.has(row.key)||
        row.firstTime<pull.startTime||row.firstTime>end+1000||last>end+1000||
        !hp||hp.hp<=0||Math.abs(hp.time-end)>1000)continue;
      survivors.push({key:row.key,pullID:pull.id,reason:'survived-failed-pull',lastHealth:hp.hp,lastHealthTime:hp.time});
    }
  }
  return survivors;
}
