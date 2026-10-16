// Boss intervals are half-open; a skip ending exactly as a boss starts is kept.
export function bossIntervals(events,fightID,endTime){
  const active=new Map(),intervals=[];
  for(const e of events.filter(e=>e.fight===fightID).toSorted((a,b)=>a.timestamp-b.timestamp)){
    if(e.type==='dungeonencounterstart')active.set(e.encounterID,e.timestamp);
    if(e.type==='dungeonencounterend'&&active.has(e.encounterID)){
      intervals.push([active.get(e.encounterID),e.timestamp]);active.delete(e.encounterID);
    }
  }
  for(const start of active.values())intervals.push([start,endTime]);
  return intervals;
}
export function outsideBossCombat(usage,intervals){
  if(!usage.start?.position||!usage.end?.position)return false;
  return !intervals.some(([start,end])=>usage.start.time===usage.end.time?
    usage.start.time>=start&&usage.start.time<end:usage.start.time<end&&usage.end.time>start);
}

// Apply after excluding boss-combat usages. Long waits/wipes do not create a
// second intended skip when both endpoints of the same relic remain nearby.
export function deduplicateRelicUsages(usages,{sameEndpointRadius=250}={}){
  if(!Number.isFinite(sameEndpointRadius)||sameEndpointRadius<0)throw new Error('Invalid relic deduplication radius');
  const result=[],valid=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
  const close=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=sameEndpointRadius;
  for(const usage of usages.toSorted((a,b)=>a.start.time-b.start.time)){
    if(!valid(usage.start?.position)||!valid(usage.end?.position))continue;
    const duplicate=result.some(other=>other.kind===usage.kind&&close(other.start.position,usage.start.position)&&close(other.end.position,usage.end.position));
    if(!duplicate)result.push(usage);
  }
  return result;
}
