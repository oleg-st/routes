import {requiresPlayerContact} from './activation.js';
import {matchingConfig} from './matching-config.js';
// Soft evidence only: 2D distance does not establish line of sight or floor.
// An unknown patrol phase cannot establish that a mob occupied its path nearby.
export function reverseApproachEvidence({packs,observations,radius,buriedRadius=matchingConfig.buriedRadius,startTime=-Infinity,endTime=Infinity,removedPlacementIDs=[],engagedAt=new Map()}) {
  if(![radius,buriedRadius].every(n=>Number.isFinite(n)&&n>=0))throw new Error('A finite nonnegative radius is required.');
  const removed=new Set(removedPlacementIDs),result=[];
  const players=observations.filter(p=>p.type==='Player'&&p.visibility==='visible'&&p.hp>0&&Number.isFinite(p.t)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.t>=startTime&&p.t<=endTime);
  for(const pack of packs){
    const staticMembers=pack.placements.filter(p=>!removed.has(p.placementId)&&!p.patrolPath?.length&&Number.isFinite(p.worldPosition?.x)&&Number.isFinite(p.worldPosition?.y));
    let first=null,closest=null;
    for(const p of players){
      // Once a pack is known engaged/dead, its original spawn is not live evidence.
      if(p.t>=(engagedAt.get(pack.id)??Infinity))continue;
      for(const member of staticMembers){
        const distance=Math.hypot(p.x-member.worldPosition.x,p.y-member.worldPosition.y);
        const range=requiresPlayerContact(member)?buriedRadius:radius;
        if(distance>range)continue;
        const witness={key:p.key,t:p.t,distance,range,placementId:member.placementId};
        if(!first||p.t<first.t)first=witness;
        if(!closest||distance<closest.distance)closest=witness;
      }
    }
    if(first)result.push({packId:pack.id,first,closest,strength:'strong-soft',basis:'visible-living-player-near-static-spawn'});
  }
  return result;
}

export function scoreReverseApproach(evidence,selectedPackIDs){
  const selected=new Set(selectedPackIDs);
  const unexplained=evidence.filter(e=>!selected.has(e.packId));
  // One contradiction per skipped pack, independent of sample rate and duration.
  return {missedPackCount:unexplained.length,unexplained};
}

export function compareReverseRank(a,b){
  // Strong argument, not rejection or a probability. Keep all feasible variants.
  return a.reverse.missedPackCount-b.reverse.missedPackCount||a.score-b.score;
}
