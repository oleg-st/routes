import {validPoint,distance3D} from './social-pack-model.mjs';

// A sensitivity experiment, not recovered game timing. Project both spawns onto
// one polyline, preserve their along-path separation and their world offsets,
// then advance both by the same distance. No numerical speed, loop closure or pack ID is
// assumed. The examined interval ends whenever either projection hits an end.
export function sharedPatrolMotionBounds(path,a,b){
  if(path.length<2||!path.every(validPoint)||![a,b].every(validPoint))return null;
  const lengths=[0];
  for(let i=1;i<path.length;i++)lengths.push(lengths.at(-1)+distance3D(path[i-1],path[i]));
  const total=lengths.at(-1);
  if(!total)return null;
  function project(p){
    let best;
    for(let i=1;i<path.length;i++){
      const start=path[i-1],end=path[i],length=lengths[i]-lengths[i-1];
      if(!length)continue;
      const t=Math.max(0,Math.min(1,['x','y','z'].reduce((s,k)=>s+(p[k]-start[k])*(end[k]-start[k]),0)/length**2));
      const point=Object.fromEntries(['x','y','z'].map(k=>[k,start[k]+t*(end[k]-start[k])]));
      const error=distance3D(p,point);
      if(!best||error<best.error)best={distance:lengths[i-1]+t*length,error,offset:Object.fromEntries(['x','y','z'].map(k=>[k,p[k]-point[k]]))};
    }
    return best;
  }
  const pa=project(a),pb=project(b);
  function position(projection,shift){
    const s=Math.max(0,Math.min(total,projection.distance+shift));
    let i=1;
    while(i<path.length-1&&lengths[i]<s)i++;
    const length=lengths[i]-lengths[i-1],t=length?(s-lengths[i-1])/length:0;
    return Object.fromEntries(['x','y','z'].map(k=>[k,path[i-1][k]+t*(path[i][k]-path[i-1][k])+projection.offset[k]]));
  }
  const lo=-Math.min(pa.distance,pb.distance),hi=total-Math.max(pa.distance,pb.distance);
  // Between either mob's vertex crossings the relative position is affine.
  // Distance and absolute height difference are convex, so maxima occur here.
  const shifts=[lo,0,hi,...lengths.flatMap(s=>[s-pa.distance,s-pb.distance])].filter(s=>s>=lo&&s<=hi);
  let maxDistance=-Infinity,maxVertical=0,witness;
  for(const shift of shifts){
    const x=position(pa,shift),y=position(pb,shift),distance=distance3D(x,y);
    maxVertical=Math.max(maxVertical,Math.abs(x.z-y.z));
    if(distance>maxDistance){maxDistance=distance;witness={shift,a:x,b:y};}
  }
  return {maxDistance,maxVertical,witness,alongPathSeparation:Math.abs(pa.distance-pb.distance),projectionErrors:[pa.error,pb.error]};
}
