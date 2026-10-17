import {placementDistance,createPackDistance} from './placement-geometry.js';

// Soft ranking only. Samples do not prove aggro, line of sight, or patrol phase.
export function createPathProximity(packs,observations){
  const byID=new Map(packs.map(p=>[p.id,{pack:p,distance:createPackDistance(p.placements)}])),cache=new Map();
  const points=observations.filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&
    (p.type==='Player'?p.hp>0&&p.visibility==='visible':p.type==='NPC'&&Number.isFinite(p.activeSince)&&p.t>=p.activeSince&&p.t<=(p.deathTime??Infinity)))
    .toSorted((a,b)=>a.t-b.t);
  return (packID,time)=>{
    const key=`${packID}|${time}`;if(cache.has(key))return cache.get(key);
    const prepared=byID.get(packID);
    let closest=null;
    for(const p of points){
      if(p.t>time)break;
      if(p.type==='NPC'&&p.t>=time)continue;
      if(!prepared||prepared.distance(p,closest?.distance??Infinity)>=(closest?.distance??Infinity))continue;
      // Resolve original member order only for a new minimum, retaining the
      // exact source and spawn/patrol tie-breaking of the unindexed calculation.
      for(const member of prepared.pack.placements){
        const metric=placementDistance(p,member);
        if(Number.isFinite(metric.distance)&&(!closest||metric.distance<closest.distance))closest={distance:metric.distance,
          source:p.type==='Player'?'player':'engaged enemy',geometry:metric.evidence,time:p.t,key:p.key};
      }
    }
    const result=closest?{minDistance:closest.distance,maxDistance:closest.distance,sources:[closest.source],patrol:closest.geometry==='patrol'}:null;
    cache.set(key,result);return result;
  };
}

export function combineProximity(values){
  if(!values.length||values.some(v=>!v))return null;
  return {minDistance:Math.min(...values.map(v=>v.minDistance)),maxDistance:Math.max(...values.map(v=>v.maxDistance)),
    sources:[...new Set(values.flatMap(v=>v.sources))],patrol:values.some(v=>v.patrol),...(values.some(v=>v.estimated)?{estimated:true}:{}),
    ...(values.every(v=>v.basis==='neighbor')?{basis:'neighbor'}:{})};
}
