import {requiresPlayerContact} from './activation.js';
import {placementDistance} from './placement-geometry.js';

// Actual combat from the original NPC establishes that it has emerged. This
// is placement identity, not permission to wake other buried mobs from afar.
export function dormantSpawnEvidence({fightID,actors,events,rows,packs,catalog,key=(e)=>`${e.sourceID}:${e.sourceInstance??1}`}){
  const players=new Set(actors.filter(a=>a.type==='Player').map(a=>a.id));
  const outgoing=Map.groupBy(events.filter(e=>e.fight===fightID&&!e.fake&&!e.positionOnly&&
    ['cast','damage'].includes(e.type)&&players.has(e.targetID)&&e.sourceResources?.hitPoints>0),key);
  const byType=Map.groupBy(packs.flatMap(p=>p.placements),p=>catalog.get(p.id).gameId),result=new Map();
  for(const row of rows){
    const first=row.firstPosition;
    if(!first||!(first.hp>0)||first.hp!==first.maxHP||!(first.t>=row.firstTime&&first.t-row.firstTime<=250))continue;
    const point={x:first.y,y:first.x},placements=byType.get(row.gameID)??[];
    const candidates=placements.filter(p=>requiresPlayerContact(p)&&!p.patrolPath?.length&&
      Math.hypot(point.x-p.worldPosition.x,point.y-p.worldPosition.y)<=10);
    if(candidates.length!==1)continue;
    const candidate=candidates[0];
    // Nearby same-type spawns or crossing patrols cannot establish identity.
    if(placements.some(p=>p!==candidate&&placementDistance(point,p).distance<=100))continue;
    const active=(outgoing.get(row.key)??[]).some(e=>e.timestamp>=first.t&&e.timestamp-row.firstTime<=250&&
      Math.hypot(e.sourceResources.y-candidate.worldPosition.x,e.sourceResources.x-candidate.worldPosition.y)<=10);
    if(active)result.set(row.key,candidate.placementId);
  }
  return result;
}
