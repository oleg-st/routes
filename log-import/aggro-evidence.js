import {requiresPlayerContact} from './activation.js';

// Conservative evidence tier from the hearing/social research model, separate
// from the importer's wider feasibility envelope. This is not a probability.
// Logs lack height, LOS and exact threat-pulse times, so keep every candidate.
export function createAggroEvidence(packs,observations,{playerRadius=1100,socialRadius=1000,buriedRadius=100}={}){
  const prepared=new Map();
  for(const pack of packs){
    const members=pack.placements.filter(p=>!p.patrolPath?.length);
    const witnesses=[];
    for(const p of observations){
      if(p.interpolated||!(p.hp>0)||![p.x,p.y,p.t].every(Number.isFinite))continue;
      const player=p.type==='Player';
      if(player?p.visibility!=='visible':p.type!=='NPC'||!p.confirmedSource||p.t<p.activeSince+500||p.t>=p.deathTime)continue;
      let best=null;
      for(const member of members){
        if(requiresPlayerContact(member)&&!player)continue;
        const range=requiresPlayerContact(member)?buriedRadius:player?playerRadius:socialRadius;
        const distance=Math.hypot(p.x-member.worldPosition?.x,p.y-member.worldPosition?.y);
        if(distance<=range&&(!best||distance<best.distance))best={key:p.key,t:p.t,distance,range,source:player?'player':'social aggro'};
      }
      if(best)witnesses.push(best);
    }
    prepared.set(pack.id,witnesses.sort((a,b)=>a.t-b.t));
  }
  const cache=new Map();
  return (packID,start,end,memberKeys=[])=>{
    const cacheKey=JSON.stringify([packID,start,end,memberKeys.toSorted()]);
    if(cache.has(cacheKey))return cache.get(cacheKey);
    const excluded=new Set(memberKeys);let closest=null;
    for(const p of prepared.get(packID)??[]){
      if(p.t>end)break;
      if(p.t<start||excluded.has(p.key)||p.source==='social aggro'&&p.t===end)continue;
      if(!closest||p.distance/p.range<closest.distance/closest.range)closest=p;
    }
    const result=closest?{distance:closest.distance,range:closest.range,sources:[closest.source]}:null;
    cache.set(cacheKey,result);return result;
  };
}

export function combineAggroEvidence(values){
  if(!values.length||values.some(v=>!v))return null;
  const conservative=values.reduce((a,b)=>a.distance/a.range>b.distance/b.range?a:b);
  return {...conservative,sources:[...new Set(values.flatMap(v=>v.sources))]};
}
