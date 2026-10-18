// Geometry only: distances do not establish visibility, patrol phase or aggro.
export const validPoint=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
export const distance3D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// User rule: a shared route, nearby spawn and catalog corroboration define one
// patrol unit. Do not compare its members at independent phases of that route.
export function samePatrolUnit(a,b,corroborated,radius=1000){
  if(!corroborated||!validPoint(a.worldPosition)||!validPoint(b.worldPosition))return false;
  if(distance3D(a.worldPosition,b.worldPosition)>radius)return false;
  const x=a.patrolPath,y=b.patrolPath;
  return Boolean(x?.length>=2&&x.length===y?.length&&x.every((p,i)=>
    validPoint(p)&&validPoint(y[i])&&['x','y','z'].every(k=>p[k]===y[i][k])));
}
export function components(ids,edges){
  const parents=new Map(ids.map(id=>[id,id]));
  const root=id=>{let p=id;while(parents.get(p)!==p)p=parents.get(p);return p;};
  for(const {a,b}of edges)if(parents.has(a)&&parents.has(b))parents.set(root(a),root(b));
  return [...Map.groupBy(ids,root).values()];
}
export function connectingThreshold(ids,edges,weight){
  const ordered=[...edges].sort((a,b)=>weight(a)-weight(b)),used=[];
  if(ids.length<2)return 0;
  for(const edge of ordered){used.push(edge);if(components(ids,used).length===1)return weight(edge);}
  return null;
}
function segmentDistance(a,b,p){
  const v=['x','y','z'].map(k=>b[k]-a[k]),w=['x','y','z'].map(k=>p[k]-a[k]);
  const length=v.reduce((s,n)=>s+n*n,0),t=length?Math.max(0,Math.min(1,v.reduce((s,n,i)=>s+n*w[i],0)/length)):0;
  return Math.hypot(...v.map((n,i)=>w[i]-t*n));
}
function coveredInterval(a,b,p,radius){
  const v=['x','y','z'].map(k=>b[k]-a[k]),w=['x','y','z'].map(k=>a[k]-p[k]);
  const aa=v.reduce((s,n)=>s+n*n,0),bb=2*v.reduce((s,n,i)=>s+n*w[i],0),cc=w.reduce((s,n)=>s+n*n,0)-radius*radius;
  if(!aa)return cc<=0?[0,1]:null;
  const disc=bb*bb-4*aa*cc;if(disc<0)return null;
  const lo=Math.max(0,(-bb-Math.sqrt(disc))/(2*aa)),hi=Math.min(1,(-bb+Math.sqrt(disc))/(2*aa));
  return lo<=hi?[lo,hi]:null;
}
export function auditPath(path,stationary,radius=1000){
  const fixed=stationary.filter(validPoint),valid=path.filter(validPoint);
  if(!fixed.length||!valid.length)return {status:'missing-coordinates'};
  let nearest=Infinity,farWitness=null,allCovered=true;
  const record=(p,segment,fraction)=>{
    const d=Math.min(...fixed.map(q=>distance3D(p,q)));
    if(!farWitness||d>farWitness.distance)farWitness={point:p,distance:d,segment,fraction};
  };
  for(let i=0;i<path.length;i++){
    const p=path[i];if(!validPoint(p)){allCovered=false;continue;}
    record(p,i,0);nearest=Math.min(nearest,...fixed.map(q=>distance3D(p,q)));
    if(i===0||!validPoint(path[i-1])){if(fixed.every(q=>distance3D(p,q)>radius))allCovered=false;continue;}
    const a=path[i-1],b=p;
    nearest=Math.min(nearest,...fixed.map(q=>segmentDistance(a,b,q)));
    const intervals=fixed.map(q=>coveredInterval(a,b,q,radius)).filter(Boolean).sort((x,y)=>x[0]-y[0]);
    let end=0;
    const gap=(lo,hi)=>{
      if(hi-lo<=1e-9)return;allCovered=false;
      const t=(lo+hi)/2;record(Object.fromEntries(['x','y','z'].map(k=>[k,a[k]+(b[k]-a[k])*t])),i-1,t);
    };
    for(const [lo,hi]of intervals){if(lo>end)gap(end,lo);end=Math.max(end,hi);}
    if(end<1)gap(end,1);
  }
  return {status:valid.length!==path.length?'incomplete-path':allCovered?'always-within-radius':'has-outside-section',
    nearestDistance:nearest,farWitness,points:path.length};
}
