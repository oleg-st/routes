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
export function deduplicateRelicUsages(usages,{sameEndpointRadius=250,overlappingInvisibilityRadius=1000}={}){
  if([sameEndpointRadius,overlappingInvisibilityRadius].some(r=>!Number.isFinite(r)||r<0))throw new Error('Invalid relic deduplication radius');
  const result=[],valid=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
  const close=(a,b,radius)=>Math.hypot(a.x-b.x,a.y-b.y)<=radius;
  for(const usage of usages.toSorted((a,b)=>a.start.time-b.start.time)){
    if(!valid(usage.start?.position)||!valid(usage.end?.position))continue;
    const duplicate=result.some(other=>{
      if(other.kind!==usage.kind)return false;
      const a=other.start.position,b=other.end.position,c=usage.start.position,d=usage.end.position;
      // Concurrent activations by nearby party members describe one skip.
      // Keep the earliest marker; individual visibility intervals stay intact.
      const overlap=usage.kind==='invis'&&Math.max(other.start.time,usage.start.time)<Math.min(other.end.time,usage.end.time);
      const sameDirection=(b.x-a.x)*(d.x-c.x)+(b.y-a.y)*(d.y-c.y)>0;
      const radius=overlap&&sameDirection?Math.max(sameEndpointRadius,overlappingInvisibilityRadius):sameEndpointRadius;
      return close(a,c,radius)&&close(b,d,radius);
    });
    if(!duplicate)result.push(usage);
  }
  return result;
}
