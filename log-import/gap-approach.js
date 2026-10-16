import {requiresPlayerContact} from './activation.js';

const clamp=n=>Math.max(0,Math.min(1,n));
const at=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function closest(a,b,c,d=c){
  const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y,den=ux*vy-uy*vx;
  if(den){const t=((c.x-a.x)*vy-(c.y-a.y)*vx)/den,s=((c.x-a.x)*uy-(c.y-a.y)*ux)/den;
    if(t>=0&&t<=1&&s>=0&&s<=1)return {distance:0,fraction:t};}
  const length=ux*ux+uy*uy,other=vx*vx+vy*vy;
  const choices=[c,d].map(p=>{const fraction=length?clamp(((p.x-a.x)*ux+(p.y-a.y)*uy)/length):0,q=at(a,b,fraction);
    return {distance:Math.hypot(q.x-p.x,q.y-p.y),fraction};});
  for(const [p,fraction] of [[a,0],[b,1]]){const t=other?clamp(((p.x-c.x)*vx+(p.y-c.y)*vy)/other):0,q=at(c,d,t);choices.push({distance:Math.hypot(q.x-p.x,q.y-p.y),fraction});}
  return choices.sort((a,b)=>a.distance-b.distance)[0];
}

// A plausible straight-line crossing, never an observed position or proof of
// aggro. Only used when ordinary evidence cannot produce a complete route.
export function createGapApproach({packs,trajectories,events=[],invisibility=[],maxGapMs=15000,maxSpeed=3000}){
  const segments=[],cache=new Map(),byID=new Map(packs.map(p=>[p.id,p]));
  for(const row of trajectories){
    if(!['Player','NPC'].includes(row.type))continue;
    const active=row.positions.find(p=>['damage','cast','begincast'].includes(p.eventType))?.t;
    for(let i=1;i<row.positions.length;i++){
      const a=row.positions[i-1],b=row.positions[i],gap=b.t-a.t;
      if(gap<=2000||gap>maxGapMs||!(a.hp>0&&b.hp>0)||a.x===b.x&&a.y===b.y)continue;
      if(row.type==='NPC'&&!(active<=a.t))continue;
      if(Math.hypot(a.x-b.x,a.y-b.y)/gap*1000>maxSpeed)continue;
      if(row.deaths.some(d=>d.timestamp>=a.t&&d.timestamp<=b.t))continue;
      if(events.some(e=>e.timestamp>=a.t&&e.timestamp<=b.t&&(e.type==='mapchange'||
        [1506,1002176].includes(e.abilityGameID)&&(e.sourceID===row.actorID||e.targetID===row.actorID))))continue;
      if(row.type==='Player'&&invisibility.some(v=>v.playerID===row.actorID&&(v.start?.time??-Infinity)<b.t&&(v.end?.time??Infinity)>a.t))continue;
      segments.push({key:row.key,source:row.type==='Player'?'player':'engaged enemy',start:a.t,end:b.t,
        a:{x:a.y,y:a.x},b:{x:b.y,y:b.x}});
    }
  }
  return (packID,time,radius)=>{
    const key=`${packID}|${time}|${radius}`;if(cache.has(key))return cache.get(key);
    let best=null;
    for(const s of segments){
      if(s.start>=time)continue;
      // Later samples may bracket the event, but only the inferred part before
      // first engagement can support the hypothesis. Never use a later crossing.
      const end=Math.min(time,s.end),b=at(s.a,s.b,(end-s.start)/(s.end-s.start));
      for(const p of byID.get(packID)?.placements??[]){
        if(requiresPlayerContact(p))continue;
        const targets=[{a:p.worldPosition,b:p.worldPosition,patrol:false}];
        const path=p.patrolPath??[];
        for(let i=0;i<path.length;i++)targets.push({a:path[i],b:i?path[i-1]:path[i],patrol:true});
        for(const target of targets){
          if(![target.a,target.b].every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)))continue;
          const hit=closest(s.a,b,target.a,target.b),crossing=s.start+(end-s.start)*hit.fraction;
          if(hit.distance>radius||s.source==='engaged enemy'&&crossing>=time)continue;
          if(!best||hit.distance<best.distance)best={...hit,key:s.key,source:s.source,start:s.start,end:s.end,time:crossing,patrol:target.patrol,gapMs:s.end-s.start};
        }
      }
    }
    cache.set(key,best);return best;
  };
}
