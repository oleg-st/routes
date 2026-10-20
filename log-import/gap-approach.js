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

// A player may keep moving toward a pack and turn back between samples. Use
// the immediately preceding recorded heading/speed, and require enough time
// both to enter the ordinary aggro radius and to reach the next recorded point.
// This is a possible path, never a new observed position or a wider radius.
function turnaround(s,target,time,radius){
  if(!s.incoming)return null;
  const {dx,dy,speed}=s.incoming,travel=speed*Math.max(0,Math.min(time,s.end)-s.start);
  const end={x:s.a.x+dx*travel,y:s.a.y+dy*travel};
  const hit=closest(s.a,end,target.a,target.b);
  if(hit.distance>radius||closest(s.a,s.a,target.a,target.b).distance<=radius)return null;
  let low=0,high=hit.fraction;
  for(let i=0;i<40;i++){
    const mid=(low+high)/2,p=at(s.a,end,mid);
    if(closest(p,p,target.a,target.b).distance<=radius)high=mid;else low=mid;
  }
  const point=at(s.a,end,high),outward=travel*high;
  const pathDistance=outward+Math.hypot(point.x-s.b.x,point.y-s.b.y);
  if(pathDistance>speed*(s.end-s.start))return null;
  return {distance:closest(point,point,target.a,target.b).distance,time:s.start+outward/speed,
    model:'turnaround',speed:speed*1000,pathDistance};
}

// A heading toward a pack can change inside a gap: a straight ray need not
// intersect its aggro circle. Bound the excursion by the freshly observed
// speed, the first event deadline and the return to the next recorded point.
// This remains a reviewable movement hypothesis, not a sampled aggro witness.
function detour(s,target,time,radius){
  if(!s.incoming)return null;
  const vx=target.b.x-target.a.x,vy=target.b.y-target.a.y,length=vx*vx+vy*vy;
  const fraction=length?clamp(((s.a.x-target.a.x)*vx+(s.a.y-target.a.y)*vy)/length):0;
  const destination=at(target.a,target.b,fraction),dx=destination.x-s.a.x,dy=destination.y-s.a.y;
  const distance=Math.hypot(dx,dy),{speed}=s.incoming;
  if(distance<=radius||dx*s.incoming.dx+dy*s.incoming.dy<=0)return null;
  const outward=distance-radius,point=at(s.a,destination,outward/distance);
  const contactTime=s.start+outward/speed,pathDistance=outward+Math.hypot(point.x-s.b.x,point.y-s.b.y);
  if(contactTime>Math.min(time,s.end)||pathDistance>speed*(s.end-s.start))return null;
  return {distance:radius,time:contactTime,model:'detour',speed:speed*1000,pathDistance};
}

// A plausible crossing or turnaround, never an observed position or proof of
// aggro. Only used when ordinary evidence cannot produce a complete route.
export function createGapApproach({packs,trajectories,events=[],invisibility=[],maxGapMs=15000,maxSpeed=3000}){
  const segments=[],cache=new Map(),byID=new Map(packs.map(p=>[p.id,p]));
  const blocked=(row,start,end)=>row.deaths.some(d=>d.timestamp>=start&&d.timestamp<=end)||
    events.some(e=>e.timestamp>=start&&e.timestamp<=end&&(e.type==='mapchange'||
      [1506,1002176].includes(e.abilityGameID)&&(e.sourceID===row.actorID||e.targetID===row.actorID)))||
    row.type==='Player'&&invisibility.some(v=>v.playerID===row.actorID&&(v.start?.time??-Infinity)<end&&(v.end?.time??Infinity)>start);
  for(const row of trajectories){
    if(!['Player','NPC'].includes(row.type))continue;
    const active=row.positions.find(p=>['damage','cast','begincast'].includes(p.eventType))?.t;
    for(let i=1;i<row.positions.length;i++){
      const a=row.positions[i-1],b=row.positions[i],gap=b.t-a.t;
      if(gap<=2000||gap>maxGapMs||!(a.hp>0&&b.hp>0)||a.x===b.x&&a.y===b.y)continue;
      if(row.type==='NPC'&&!(active<=a.t))continue;
      if(Math.hypot(a.x-b.x,a.y-b.y)/gap*1000>maxSpeed)continue;
      if(blocked(row,a.t,b.t))continue;
      let incoming=null;
      if(row.type==='Player'){
        // Same-time status/damage events often repeat a movement sample.
        let previous=i-2;while(previous>=0&&row.positions[previous].t===a.t)previous--;
        const p=row.positions[previous],dt=a.t-p?.t,dx=a.y-p?.y,dy=a.x-p?.x,length=Math.hypot(dx,dy);
        if(dt>0&&dt<=2000&&p.hp>0&&length>0&&length/dt*1000<=maxSpeed&&!blocked(row,p.t,a.t))incoming={dx:dx/length,dy:dy/length,speed:length/dt};
      }
      segments.push({key:row.key,source:row.type==='Player'?'player':'engaged enemy',start:a.t,end:b.t,
        a:{x:a.y,y:a.x},b:{x:b.y,y:b.x},incoming});
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
          const evidence=hit.distance<=radius&&!(s.source==='engaged enemy'&&crossing>=time)?{...hit,time:crossing}:
            turnaround(s,target,time,radius)??detour(s,target,time,radius);
          if(!evidence)continue;
          if(!best||evidence.distance<best.distance)best={...evidence,key:s.key,source:s.source,start:s.start,end:s.end,patrol:target.patrol,gapMs:s.end-s.start};
        }
      }
    }
    cache.set(key,best);return best;
  };
}
