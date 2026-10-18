// A brief diversion ending in one player's death is not a kill pull. Require
// living, nearly untouched mobs, no later engagement, and surviving players
// progressing to another kill. Missing death events alone are not sufficient.
export function deathSkipRows(log,rows,{key=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`}={}){
  if(!log.complete)return [];
  const {fight,actors}=log,events=log.events.filter(e=>e.fight===fight.id&&!e.positionOnly);
  const players=new Set(actors.filter(a=>a.type==='Player').map(a=>a.id));
  const bosses=new Set(actors.filter(a=>a.subType==='Boss').map(a=>a.id));
  const chicken=new Set(events.filter(e=>e.type==='cast'&&e.abilityGameID===1478).map(e=>key(e,'target')));
  const byKey=new Map(rows.map(r=>[r.key,r])),lastSeen=new Map();
  for(const e of events)for(const side of ['source','target','attacker']){
    const id=key(e,side);
    if(byKey.has(id))lastSeen.set(id,Math.max(lastSeen.get(id)??-Infinity,e.timestamp));
  }
  const skipped=[];
  for(const pull of fight.dungeonPulls){
    if(pull.encounterID||pull.endTime-pull.startTime>30000)continue;
    // API pull boundaries can precede the killing blow by a few milliseconds.
    const end=pull.endTime+1000;
    const deaths=events.filter(e=>e.type==='death'&&!e.fake&&e.timestamp>=pull.startTime&&e.timestamp<=end);
    const deadPlayers=new Set(deaths.filter(e=>players.has(e.targetID)).map(e=>e.targetID));
    if(!deadPlayers.size||deadPlayers.size>=players.size||deaths.some(e=>byKey.has(key(e,'target'))))continue;
    const members=rows.filter(r=>r.firstTime>=pull.startTime&&r.firstTime<=pull.endTime);
    if(!members.length||members.some(r=>{
      const p=r.positions?.at(-1);
      return bosses.has(r.actorID)||chicken.has(r.key)||r.deaths.length||lastSeen.get(r.key)>end||
        !p||p.t<pull.endTime-3000||!(p.maxHP>0&&p.hp>=p.maxHP*.9&&p.hp<=p.maxHP);
    }))continue;
    const memberKeys=new Set(members.map(r=>r.key));
    if(!events.some(e=>e.type==='damage'&&e.timestamp>=pull.startTime&&e.timestamp<=end&&
      memberKeys.has(key(e,'source'))&&deadPlayers.has(e.targetID)))continue;
    const laterKill=events.find(e=>e.type==='death'&&!e.fake&&e.timestamp>end&&byKey.has(key(e,'target')));
    if(!laterKill||!events.some(e=>e.type==='damage'&&e.timestamp>end&&e.timestamp<=laterKill.timestamp&&
      players.has(e.sourceID)&&!deadPlayers.has(e.sourceID)&&key(e,'target')===key(laterKill,'target')))continue;
    skipped.push(...members.map(r=>({key:r.key,pullID:pull.id,reason:'survived-death-skip'})));
  }
  return skipped;
}
