import {bossIntervals,outsideBossCombat,deduplicateRelicUsages} from './route-relics.js';
const position=r=>Number.isFinite(r?.x)&&Number.isFinite(r?.y)?{x:r.x,y:r.y}:null;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Repeated use after a wipe is one intended skip. Compare both endpoints in the
// same direction; proximity of only the exit must not merge different portals.
export function intendedPortals(usages,{sameEndpointRadius=250}={}){
  return deduplicateRelicUsages(usages,{sameEndpointRadius});
}

// Portal Sickness is the trigger. A placement cast is never a route endpoint.
// Preserve event order within one timestamp: Relic Teleport's sourceResources
// precede the debuff's targetResources even though both have the same timestamp.
export function extractPortals(events,{fightID,players,endTime,maxSampleAge=1000,waveWindow=20000,endpointRadius=1000}){
  const playerIDs=new Set(players.map(p=>p.id)),previous=new Map(),crossings=[],issues=[];
  const intervals=bossIntervals(events,fightID,endTime);
  for(const e of events.filter(e=>e.fight===fightID).toSorted((a,b)=>a.timestamp-b.timestamp)){
    if(e.type==='applydebuff'&&e.abilityGameID===1002176&&playerIDs.has(e.targetID)){
      const before=previous.get(e.targetID),after=position(e.targetResources);
      if(before&&after&&e.timestamp-before.time<=maxSampleAge&&distance(before.position,after)>100){
        const crossing={playerID:e.targetID,start:before,end:{time:e.timestamp,position:after}};
        if(outsideBossCombat(crossing,intervals))crossings.push(crossing);
      }else issues.push({playerID:e.targetID,time:e.timestamp,reason:'missing-or-stale-transition-position'});
    }
    for(const side of ['source','target']){
      const id=e[`${side}ID`],r=e[`${side}Resources`],p=position(r);
      if(playerIDs.has(id)&&p&&r.hitPoints!==0)previous.set(id,{time:e.timestamp,position:p});
    }
    if(e.type==='death'&&playerIDs.has(e.targetID))previous.delete(e.targetID);
  }
  const waves=[];
  for(const crossing of crossings){
    let wave=waves.findLast(w=>crossing.end.time-w[0].end.time<=waveWindow&&
      !w.some(c=>c.playerID===crossing.playerID)&&distance(w[0].start.position,crossing.start.position)<=endpointRadius&&distance(w[0].end.position,crossing.end.position)<=endpointRadius);
    if(!wave){wave=[];waves.push(wave);}wave.push(crossing);
  }
  const average=(wave,side)=>({time:Math[side==='start'?'min':'max'](...wave.map(c=>c[side].time)),
    position:{x:wave.reduce((n,c)=>n+c[side].position.x,0)/wave.length,y:wave.reduce((n,c)=>n+c[side].position.y,0)/wave.length}});
  return {usages:waves.map(w=>({kind:'portal',start:average(w,'start'),end:average(w,'end'),playerCount:w.length})),issues};
}
