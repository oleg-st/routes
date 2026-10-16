// API segments describe actual attempts. The route describes first engagements:
// a reset/re-pull never moves an already selected enemy into a later pull.
// Only established identity aliases may merge different log instance IDs.
export function firstEngagements(events,{fightID,actors,aliases=new Map()}){
  const npcIDs=new Set(actors.filter(a=>a.type==='NPC').map(a=>a.id)),first=new Map();
  const resolve=key=>aliases.get(key)??key;
  for(const e of events.toSorted((a,b)=>a.timestamp-b.timestamp)){
    if(e.fight!==fightID||e.positionOnly)continue;
    for(const side of ['source','target']){
      if(!npcIDs.has(e[`${side}ID`]))continue;
      const active=side==='source'?['damage','cast','begincast'].includes(e.type):
        ['damage','death','applydebuff','refreshdebuff'].includes(e.type)||e.type==='cast'&&e.abilityGameID===1478;
      if(!active)continue;
      const key=resolve(`${e[`${side}ID`]}:${e[`${side}Instance`]??1}`);
      if(!first.has(key))first.set(key,e.timestamp);
    }
  }
  return first;
}

export function intendedPulls(segments,engagements){
  const seen=new Set(),result=[],ordered=engagements.toSorted((a,b)=>a.time-b.time);
  for(const segment of segments.toSorted((a,b)=>a.startTime-b.startTime)){
    const enemies=[];
    for(const e of ordered){
      if(seen.has(e.identity)||e.time>segment.endTime)continue;
      // Slightly earlier debuffs are often logged before the API segment starts.
      enemies.push(e.identity);seen.add(e.identity);
    }
    if(enemies.length)result.push({...segment,enemies});
  }
  return result;
}
