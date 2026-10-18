// No pack labels or source groupings are accepted by this model.
// Strongly connected components are groups with mutual threat propagation.
import {validPoint,distance3D} from './social-pack-model.mjs';
import {sharedPatrolMotionBounds} from './shared-patrol-motion.mjs';
export function stronglyConnected(ids,edges){
  const adjacency=new Map(ids.map(id=>[id,[]]));
  for(const {a,b}of edges)adjacency.get(a)?.push(b);
  const index=new Map(),low=new Map(),stack=[],onStack=new Set(),groups=[];let next=0;
  function visit(v){
    index.set(v,next);low.set(v,next++);stack.push(v);onStack.add(v);
    for(const w of adjacency.get(v)){if(!index.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(onStack.has(w))low.set(v,Math.min(low.get(v),index.get(w)));}
    if(low.get(v)===index.get(v)){const group=[];let w;do{w=stack.pop();onStack.delete(w);group.push(w);}while(w!==v);groups.push(group);}
  }
  for(const id of ids)if(!index.has(id))visit(id);
  return groups;
}
function interval(a,b,sphere,verticalLimit){
  const v=['x','y','z'].map(k=>b[k]-a[k]),w=['x','y','z'].map(k=>a[k]-sphere.point[k]);
  const aa=v.reduce((s,n)=>s+n*n,0),bb=2*v.reduce((s,n,i)=>s+n*w[i],0),cc=w.reduce((s,n)=>s+n*n,0)-sphere.radius**2;
  let lo=0,hi=1;
  if(aa===0){if(cc>0)return null;}else{const disc=bb*bb-4*aa*cc;if(disc<0)return null;lo=Math.max(0,(-bb-Math.sqrt(disc))/(2*aa));hi=Math.min(1,(-bb+Math.sqrt(disc))/(2*aa));}
  if(Number.isFinite(verticalLimit)){
    if(v[2]===0){if(Math.abs(w[2])>verticalLimit)return null;}
    else{const ts=[(-verticalLimit-w[2])/v[2],(verticalLimit-w[2])/v[2]].sort((a,b)=>a-b);lo=Math.max(lo,ts[0]);hi=Math.min(hi,ts[1]);}
  }
  return lo<=hi?[lo,hi]:null;
}
export function pathCovered(path,spheres,verticalLimit=Infinity){
  if(!path.length||!path.every(validPoint)||!spheres.length)return false;
  if(path.length===1)return spheres.some(s=>distance3D(path[0],s.point)<=s.radius&&Math.abs(path[0].z-s.point.z)<=verticalLimit);
  for(let i=1;i<path.length;i++){
    const ranges=spheres.map(s=>interval(path[i-1],path[i],s,verticalLimit)).filter(Boolean).sort((a,b)=>a[0]-b[0]);let end=0;
    if(!ranges.length)return false;
    for(const [lo,hi]of ranges){if(lo>end+1e-9)return false;end=Math.max(end,hi);}
    if(end<1-1e-9)return false;
  }
  return true;
}
export function inferGeometricPacks(mobs,{persistent=true,anchorPaths=false,heightAdjustedPaths=false,synchronizeSharedPaths=true,sharedPathArcOffsets=false,verticalLimit=Infinity,synchronizedMotionBounds=null}={}){
  const ids=mobs.map(p=>p.id),byID=new Map(mobs.map(p=>[p.id,p]));
  const eligible=mobs.filter(p=>!p.inactive&&validPoint(p.position));
  const moving=p=>p.path?.length>1;
  const pathKey=p=>moving(p)&&p.path.every(validPoint)?JSON.stringify(p.path):null;
  const keys=new Map(eligible.map(p=>[p.id,pathKey(p)]));
  const trajectories=new Map(eligible.map(p=>{
    if(!moving(p))return[p.id,[p.position]];
    if(!p.path.every(validPoint))return[p.id,null];
    const offset=Object.fromEntries(['x','y','z'].map(k=>[k,anchorPaths?p.position[k]-p.path[0][k]:0]));
    if(heightAdjustedPaths){
      let nearest=Infinity;
      for(let i=1;i<p.path.length;i++){
        const a=p.path[i-1],b=p.path[i],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
        const t=len?Math.max(0,Math.min(1,((p.position.x-a.x)*dx+(p.position.y-a.y)*dy)/len)):0;
        const distance=Math.hypot(p.position.x-a.x-t*dx,p.position.y-a.y-t*dy);
        if(distance<nearest){nearest=distance;offset.z=p.position.z-a.z-t*(b.z-a.z);}
      }
      offset.x=0;offset.y=0;
    }
    return[p.id,[p.position,...p.path.map(q=>Object.fromEntries(['x','y','z'].map(k=>[k,q[k]+offset[k]])))]];
  }));
  const close=(a,b,r)=>distance3D(a,b)<=r&&Math.abs(a.z-b.z)<=verticalLimit;
  const edges=[],assumptions=[];
  for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++){
    const a=eligible[i],b=eligible[j],ta=trajectories.get(a.id),tb=trajectories.get(b.id);
    let ab=close(a.position,b.position,a.radius),ba=close(a.position,b.position,b.radius);
    if(!ab&&!ba)continue;
    if(persistent&&(moving(a)||moving(b))){
      const explicitMotion=synchronizedMotionBounds?.(a,b);
      if(!ta||!tb){ab=false;ba=false;}
      else if(explicitMotion){
        ab=ab&&explicitMotion.maxDistance<=a.radius&&explicitMotion.maxVertical<=verticalLimit;
        ba=ba&&explicitMotion.maxDistance<=b.radius&&explicitMotion.maxVertical<=verticalLimit;
        assumptions.push({a:a.id,b:b.id,type:'explicit-patrol-formation',motion:explicitMotion});
      }
      else if(synchronizeSharedPaths&&keys.get(a.id)&&keys.get(a.id)===keys.get(b.id)){
        if(sharedPathArcOffsets){
          const motion=sharedPatrolMotionBounds(a.path,a.position,b.position);
          // Veto a rigid-formation link if equal travel along the actual curve
          // already permits separation. This still assumes equal speed and
          // constant world offsets; it is not a measured patrol simulation.
          ab=!!motion&&motion.maxDistance<=a.radius&&motion.maxVertical<=verticalLimit;
          ba=!!motion&&motion.maxDistance<=b.radius&&motion.maxVertical<=verticalLimit;
          assumptions.push({a:a.id,b:b.id,type:'shared-path-fixed-arc-offsets',motion});
        }else assumptions.push({a:a.id,b:b.id,type:'shared-path-translates-spawn-formation'});
      }else{
        for(const pa of ta){for(const pb of tb){if(ab&&!close(pa,pb,a.radius))ab=false;if(ba&&!close(pa,pb,b.radius))ba=false;if(!ab&&!ba)break;}if(!ab&&!ba)break;}
      }
    }
    if(ab)edges.push({a:a.id,b:b.id});if(ba)edges.push({a:b.id,b:a.id});
  }
  // A moving mob may always reach a connected fixed group via different members.
  if(persistent){
    const fixed=eligible.filter(p=>!moving(p)),fixedSet=new Set(fixed.map(p=>p.id));
    const fixedGroups=stronglyConnected([...fixedSet],edges.filter(e=>fixedSet.has(e.a)&&fixedSet.has(e.b)));
    for(const m of eligible.filter(moving)){
      const trajectory=trajectories.get(m.id);if(!trajectory)continue;
      // Spawn can lie partway along the route: do not invent a segment to its first vertex.
      const path=trajectory.slice(1);
      const covered=spheres=>pathCovered([m.position],spheres,verticalLimit)&&pathCovered(path,spheres,verticalLimit);
      for(const ids of fixedGroups.filter(g=>g.length>1)){
        const members=ids.map(id=>byID.get(id));
        if(!members.some(p=>close(m.position,p.position,Math.max(m.radius,p.radius))))continue;
        if(covered(members.map(p=>({point:p.position,radius:m.radius}))))edges.push({a:m.id,b:ids[0]});
        if(covered(members.map(p=>({point:p.position,radius:p.radius}))))edges.push({a:ids[0],b:m.id});
      }
    }
  }
  const groups=stronglyConnected(ids,edges),owner=new Map(groups.flatMap((g,i)=>g.map(id=>[id,i])));
  return {groups,assumptions,oneWayLinks:edges.filter(e=>owner.get(e.a)!==owner.get(e.b)),edges,
    invalid:mobs.filter(p=>!validPoint(p.position)||moving(p)&&!p.path.every(validPoint)).map(p=>p.id)};
}
