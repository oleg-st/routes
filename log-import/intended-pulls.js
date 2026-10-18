// API segments describe actual attempts. The route describes first engagements:
// a reset/re-pull never moves an already selected enemy into a later pull.
// Only established identity aliases may merge different log instance IDs.
export function firstEngagements(events,{fightID,actors,aliases=new Map(),key=(e,side)=>`${e[side+'ID']}:${e[side+'Instance']??1}`}){
  const npcIDs=new Set(actors.filter(a=>a.type==='NPC').map(a=>a.id)),first=new Map();
  const resolve=key=>aliases.get(key)??key;
  for(const e of events.toSorted((a,b)=>a.timestamp-b.timestamp)){
    if(e.fight!==fightID||e.positionOnly)continue;
    for(const side of ['source','target']){
      if(!npcIDs.has(e[`${side}ID`]))continue;
      const active=side==='source'?['damage','cast','begincast'].includes(e.type):
        ['damage','death','applydebuff','refreshdebuff'].includes(e.type)||e.type==='cast'&&e.abilityGameID===1478;
      if(!active)continue;
      const identity=resolve(key(e,side));
      if(identity==null)continue;
      if(!first.has(identity))first.set(identity,e.timestamp);
    }
  }
  return first;
}

// Opening casts/debuffs may precede the API pull's start. Once the previous
// pull has ended, a new engagement belongs to the next pull, not the old one.
// At shared/overlapping boundaries prefer the most recently started pull.
export function engagementSegmentIndex(segments,time){
  const index=segments.findLastIndex(p=>p.startTime<=time);
  if(index<0)return 0;
  return time<=segments[index].endTime||index===segments.length-1?index:index+1;
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
