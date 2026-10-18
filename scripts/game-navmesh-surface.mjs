// Static surface diagnostics, not a reachability test or an actor-removal rule.
// Never collapse multiple floors into a single height field.
export function projectTriangleXY(p, vertices) {
  const [a,b,c]=vertices;
  const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if(Math.abs(den)>1e-10){
    const u=((b[1]-c[1])*(p.x-c[0])+(c[0]-b[0])*(p.y-c[1]))/den;
    const v=((c[1]-a[1])*(p.x-c[0])+(a[0]-c[0])*(p.y-c[1]))/den;
    if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)
      return {point:[p.x,p.y,u*a[2]+v*b[2]+(1-u-v)*c[2]],horizontalDistance:0};
  }
  let best=null;
  for(let i=0;i<3;i++){
    const start=vertices[i],end=vertices[(i+1)%3];
    const dx=end[0]-start[0],dy=end[1]-start[1],length2=dx*dx+dy*dy;
    // For a vertical edge, choose the point closest in Z among equal XY projections.
    const t=length2>1e-15?Math.max(0,Math.min(1,((p.x-start[0])*dx+(p.y-start[1])*dy)/length2)):
      end[2]!==start[2]?Math.max(0,Math.min(1,(p.z-start[2])/(end[2]-start[2]))):0;
    const point=start.map((value,j)=>value+t*(end[j]-value));
    const distance=Math.hypot(p.x-point[0],p.y-point[1]);
    if(!best||distance<best.horizontalDistance-1e-8||
      (Math.abs(distance-best.horizontalDistance)<=1e-8&&Math.abs(p.z-point[2])<Math.abs(p.z-best.point[2])))
      best={point,horizontalDistance:distance};
  }
  return best;
}

export function prepareNavmesh(mesh){
  const triangles=[];
  let minZ=Infinity,maxZ=-Infinity;
  for(const tile of mesh.tiles)for(const tri of tile.surfaceTriangles){
    const vertices=tri.vertices.map(i=>tile.renderVertices[i]);
    if(vertices.length!==3||vertices.some(v=>!v||v.length!==3||!v.every(Number.isFinite)))throw Error('Invalid navmesh triangle');
    for(const v of vertices){minZ=Math.min(minZ,v[2]);maxZ=Math.max(maxZ,v[2]);}
    triangles.push({tile:tile.id,polygon:tri.polygon,vertices});
  }
  if(!triangles.length)throw Error('Empty navmesh surface');
  return {triangles,minZ,maxZ};
}

export function sampleNavmesh(prepared,p,{nearRadius=300}={}){
  if(![p.x,p.y,p.z,nearRadius].every(Number.isFinite)||nearRadius<0)throw Error('Invalid surface query');
  let nearestXY=null,bestNearbyHeight=null;
  const atXY=[];
  for(const tri of prepared.triangles){
    const projected=projectTriangleXY(p,tri.vertices);
    const hit={...projected,verticalOffset:p.z-projected.point[2],tile:tri.tile,polygon:tri.polygon};
    if(!nearestXY||hit.horizontalDistance<nearestXY.horizontalDistance-1e-8||
      (Math.abs(hit.horizontalDistance-nearestXY.horizontalDistance)<=1e-8&&Math.abs(hit.verticalOffset)<Math.abs(nearestXY.verticalOffset)))nearestXY=hit;
    if(hit.horizontalDistance===0)atXY.push(hit);
    if(hit.horizontalDistance<=nearRadius&&(!bestNearbyHeight||Math.abs(hit.verticalOffset)<Math.abs(bestNearbyHeight.verticalOffset)))bestNearbyHeight=hit;
  }
  atXY.sort((a,b)=>Math.abs(a.verticalOffset)-Math.abs(b.verticalOffset));
  return {nearestXY,closestHeightAtXY:atXY[0]??null,
    surfaceHeightsAtXY:[...new Set(atXY.map(h=>Math.round(h.point[2]*1000)/1000))].sort((a,b)=>a-b),
    bestNearbyHeight,nearRadius,belowAllSurfaceBy:Math.max(0,prepared.minZ-p.z),
    aboveAllSurfaceBy:Math.max(0,p.z-prepared.maxZ)};
}
