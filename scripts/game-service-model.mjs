import assert from 'node:assert/strict';
import {projectGamePoint} from './game-source-identity.mjs';
export function selectedServiceLevel(source,selectedLevels){
 const level=source.split('/').at(-1).replace(/\.umap$/,'');
 return !/Enemies/i.test(level)||selectedLevels.includes(level);
}
// One display flag represents the party's starting group, not one selected
// player's spawn. Keep the full spread for review rather than selecting a slot.
export function playerStartCenter(starts,dungeonKey){
 assert.ok(starts.length,'No PlayerStart actors for '+dungeonKey);
 const points=starts.map(o=>{
  assert.equal(o.source.split('/').at(-1),dungeonKey+'.umap','Start in streamed level requires transform/activation support');
  const root=o.rootComponent?.properties;
  assert.ok(root&&!root.AttachParent,'Attached or missing PlayerStart root');
  const p=root.RelativeLocation;
  assert.ok(p&&['X','Y','Z'].every(k=>Number.isFinite(p[k])),'Missing PlayerStart coordinates');
  return {x:p.X,y:p.Y,z:p.Z};
 });
 const diameter=Math.max(...points.flatMap(a=>points.map(b=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z))));
 return {worldPosition:Object.fromEntries(['x','y','z'].map(k=>[k,points.reduce((sum,p)=>sum+p[k],0)/points.length])),spawnPoints:points,sources:starts.map(o=>o.ref),diameter};
}
// Cylinder extends upward from the spawner. For a vertical capsule, test its
// central segment against the solid cylinder, then expand by capsule radius.
export function capsuleInCylinder(capsule,origin,radius,height){
 const {position:p,radius:r,halfHeight:h}=capsule;
 if(capsule.axis){
  const distance=t=>{
   const q=Object.fromEntries(['x','y','z'].map(k=>[k,p[k]+capsule.axis[k]*(h-r)*t]));
   const horizontal=Math.max(0,Math.hypot(q.x-origin.x,q.y-origin.y)-radius);
   const vertical=Math.max(0,origin.z-q.z,q.z-origin.z-height);
   return horizontal*horizontal+vertical*vertical;
  };
  // Squared distance to a convex cylinder is convex along the capsule axis.
  let lo=-1,hi=1;for(let i=0;i<80;i++){const a=(2*lo+hi)/3,b=(lo+2*hi)/3;if(distance(a)<distance(b))hi=b;else lo=a;}
  return Math.min(distance(-1),distance(1),distance((lo+hi)/2))<=r*r;
 }
 const horizontal=Math.max(0,Math.hypot(p.x-origin.x,p.y-origin.y)-radius);
 const vertical=Math.max(0,origin.z-(p.z+h-r),(p.z-h+r)-(origin.z+height));
 return horizontal*horizontal+vertical*vertical<=r*r;
}
export function rotateGameVector(v,rotation={}){
 const [p,y,r]=['Pitch','Yaw','Roll'].map(k=>(rotation[k]??0)*Math.PI/180),cp=Math.cos(p),sp=Math.sin(p),cy=Math.cos(y),sy=Math.sin(y),cr=Math.cos(r),sr=Math.sin(r);
 return {x:v.x*cp*cy+v.y*(sr*sp*cy-cr*sy)+v.z*(-cr*sp*cy-sr*sy),y:v.x*cp*sy+v.y*(sr*sp*sy+cr*cy)+v.z*(-cr*sp*sy+sr*cy),z:v.x*sp-v.y*sr*cp+v.z*cr*cp};
}
export function serviceMapPoint(position,frames,placements){
 const candidates=Object.entries(frames).filter(([,f])=>['x','y','z'].every(k=>position[k]>=f.bounds[0][k]&&position[k]<=f.bounds[1][k]));
 assert.ok(candidates.length,'POI outside exported map areas');
 // Overlapping map volumes have no serialized priority. Use nearby combat
// actors to choose the displayed floor; retain all candidates in the audit.
 const distance=p=>Math.hypot(...['x','y','z'].map(k=>p.worldPosition[k]-position[k]));
 const ranked=candidates.map(([id,f])=>({id,f,distance:Math.min(...placements.filter(p=>p.mapImageId===id).map(distance))})).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
 return {mapImageId:ranked[0].id,mapPosition:projectGamePoint(position,ranked[0].f),candidates:ranked.map(r=>r.id)};
}
