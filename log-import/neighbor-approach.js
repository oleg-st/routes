import {createPackDistance} from './placement-geometry.js';
import {requiresPlayerContact} from './activation.js';

// Explicit recovery hypothesis, not observed aggro. Only independently anchored
// packs can seed this search; a candidate neighbor can never seed another one.
export function createNeighborApproach({packs,confirmed,radius}){
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Invalid neighboring pack radius.');
  const byID=new Map(packs.map(p=>[p.id,p]));
  const distances=new Map(packs.map(pack=>{
    const distance=createPackDistance(pack.placements.filter(p=>!requiresPlayerContact(p)));
    return [pack.id,confirmed.filter(source=>source.packId!==pack.id).flatMap(source=>{
      const from=byID.get(source.packId);
      // Known spawn geometry only: the source patrol's other possible positions
      // have not been observed and cannot justify remote neighbors.
      const d=Math.min(...(from?.placements??[]).map(p=>distance(p.worldPosition,radius)));
      return d<=radius?[{...source,distance:d,radius}]:[];
    }).sort((a,b)=>a.distance-b.distance)];
  }));
  return (packId,time)=>distances.get(packId)?.find(source=>source.time<time)??null;
}
