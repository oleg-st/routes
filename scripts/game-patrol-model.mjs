import assert from 'node:assert/strict';
import {distance3D,validPoint} from './social-pack-model.mjs';
const lerp=(a,b,t)=>Object.fromEntries(['x','y','z'].map(k=>[k,a[k]+(b[k]-a[k])*t]));
export function centerHeightOffset(points,spawn){
  let best=Infinity,offset=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
    const t=len2?Math.max(0,Math.min(1,((spawn.x-a.x)*dx+(spawn.y-a.y)*dy)/len2)):0;
    const p=lerp(a,b,t),error=Math.hypot(p.x-spawn.x,p.y-spawn.y);
    if(error<best){best=error;offset=spawn.z-p.z;}
  }
  return offset;
}
export function gameSocialInput(data,activeKeys){
  const active=new Set(activeKeys),patrols=new Map(data.patrols.map(p=>[p.actorKey,p]));
  return data.mobs.filter(m=>active.has(m.actorKey)).map(m=>{
    assert.ok(validPoint(m.worldPosition),'Invalid spawn');
    assert.ok(Number.isFinite(m.socialAggro.distance)&&m.socialAggro.distance>0,'Unknown social radius');
    assert.equal(m.socialAggro.propagateThreat,true,'Disabled propagation needs explicit directed handling');
    assert.ok(m.patrolMemberships.length<=1,'Ambiguous multiple patrols');
    const membership=m.patrolMemberships[0],patrol=membership&&patrols.get(membership.patrolKey);
    const column=patrol?.columns.find(c=>c.column===membership.column);
    if(membership){assert.ok(column);assert.ok(column.slots.some(s=>s?.actorKey===m.actorKey&&s.row===membership.row));assert.ok(column.path.length>1);}
    return {id:m.actorKey,position:m.worldPosition,path:column?.path??[],
      inactive:m.socialAggro.receivesPropagationInitially===false,
      radius:m.socialAggro.distance,verticalLimit:m.socialAggro.verticalDistance,
      patrol:patrol??null,membership:membership??null,
      heightOffset:column?centerHeightOffset(column.path,m.worldPosition):0};
  });
}

// Geometric formation hypothesis, not a reconstruction of runtime movement.
// Columns share the reference-column progress; row offsets come from Spacing.
// Test both travel directions for non-loop paths, including clamped endpoints.
// Loop closure is used only when the game explicitly marks the patrol Looped.
export function formationMotionBounds(a,b,{heightAdjusted=true}={}){
  if(!a.patrol||a.patrol!==b.patrol)return null;
  const patrol=a.patrol,s=patrol.resolvedSettings;
  assert.equal(s.Formation,'ECRFollowPathFormationType::Column');
  assert.equal(s.SpaceEquallyAlongPath,false,'Equally spaced formation not implemented');
  assert.ok(Number.isFinite(s.Spacing)&&s.Spacing>=0);
  const referenceColumn=patrol.columns.find(c=>c.path.length>1),reference=referenceColumn.path;
  assert.equal(a.path.length,reference.length);assert.equal(b.path.length,reference.length);
  const points=s.Looped?[...reference,reference[0]]:reference;
  // Serialized samples are indexed in base-path distance. Their world-space
  // lengths differ across columns and can include baked projection artifacts.
  const sampleDistance=referenceColumn.baseDistanceBetweenPoints;
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+
    (Number.isFinite(sampleDistance)&&sampleDistance>0?sampleDistance:distance3D(points[i-1],points[i])));
  const length=lengths.at(-1);assert.ok(length>0);
  const wrapped=q=>((q%length)+length)%length;
  const pathFor=m=>s.Looped?[...m.path,m.path[0]]:m.path;
  const pa=pathFor(a),pb=pathFor(b);
  function at(m,path,q){
    q=s.Looped?wrapped(q):Math.max(0,Math.min(length,q));
    let i=1;while(i<lengths.length-1&&lengths[i]<q)i++;
    const span=lengths[i]-lengths[i-1],p=lerp(path[i-1],path[i],span?(q-lengths[i-1])/span:0);
    p.z+=heightAdjusted?m.heightOffset:0;return p;
  }
  let maxDistance=distance3D(a.position,b.position),maxVertical=Math.abs(a.position.z-b.position.z);
  let witness={kind:'spawn',a:a.position,b:b.position};
  for(const direction of s.Looped?[1]:[1,-1]){
    const oa=direction*a.membership.row*s.Spacing,ob=direction*b.membership.row*s.Spacing;
    const lo=s.Looped?0:Math.min(0,oa,ob),hi=s.Looped?length:length+Math.max(0,oa,ob);
    const candidates=[lo,hi,...lengths.flatMap(q=>[q+oa,q+ob]).map(q=>s.Looped?wrapped(q):q)].filter(q=>q>=lo&&q<=hi);
    // Between breakpoints both positions are affine. Norm and absolute Z maxima
    // occur at endpoints, so this is exact for this piecewise-linear hypothesis.
    for(const q of candidates){const x=at(a,pa,q-oa),y=at(b,pb,q-ob),distance=distance3D(x,y);
      maxVertical=Math.max(maxVertical,Math.abs(x.z-y.z));
      if(distance>maxDistance){maxDistance=distance;witness={kind:'path',progress:q,direction,a:x,b:y};}}
  }
  return {maxDistance,maxVertical,witness,patrolKey:patrol.actorKey,spacing:s.Spacing,
    rowSeparation:Math.abs(a.membership.row-b.membership.row)*s.Spacing,
    columns:[a.membership.column,b.membership.column],looped:s.Looped,heightAdjusted,sampleDistance:sampleDistance??null,
    note:'Common progress, indexed column paths and row spacing; speed/acceleration/catch-up/transient turn-around motion not simulated.'};
}
