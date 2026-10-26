import {placementDistance} from './placement-geometry.js';
import {requiresPlayerContact} from './activation.js';

// A tiny spawn discrepancy must not lose an otherwise observed ranged pull.
// This evidence applies only to the opening cast, never to hard placement
// identity, neighbor recovery, or a wider player/chain aggro radius.
export function withOpeningPackEvidence(attacks,{packs,rows,catalog}){
  const byKey=new Map(rows.map(r=>[r.key,r]));
  const byType=Map.groupBy(packs.flatMap(pack=>pack.placements.map(p=>({pack,p}))),entry=>catalog.get(entry.p.id).gameId);
  return attacks.map(attack=>{
    const row=byKey.get(attack.targetKey),sample=row?.firstPosition;
    // Use the original NPC's immediate, full-health debuff sample. Delayed
    // combat positions and Chicken replacement coordinates cannot identify it.
    if(attack.type!=='cast'||attack.fake||attack.abilityGameID===1478||attack.t!==row?.firstTime||
      !sample||sample.eventType!=='applydebuff'||!(sample.hp>0)||sample.hp!==sample.maxHP||
      !(sample.t>=attack.t&&sample.t-attack.t<=250))return attack;
    const point={x:sample.y,y:sample.x},placements=byType.get(row.gameID)??[];
    const nearby=placements.filter(({p})=>!p.patrolPath?.length&&!requiresPlayerContact(p)&&!catalog.get(p.id).isBoss&&
      Math.hypot(point.x-p.worldPosition.x,point.y-p.worldPosition.y)<=10);
    const pack=nearby[0]?.pack;if(!pack)return attack;
    // Also check other packs' patrol paths, not just their initial spawns.
    // A 100-unit separation keeps the 10-unit tolerance away from ambiguous mobs.
    if(placements.some(entry=>entry.pack.id!==pack.id&&placementDistance(point,entry.p).distance<=100))return attack;
    return {...attack,confirmedPackId:pack.id};
  });
}
