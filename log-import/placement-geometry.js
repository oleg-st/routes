const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
export function distanceToSegment(point,a,b){
  if(!valid(point)||!valid(a)||!valid(b))return Infinity;
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const fraction=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
  return Math.hypot(point.x-a.x-fraction*dx,point.y-a.y-fraction*dy);
}
export function distanceToPatrol(point,path){
  if(!valid(point)||!Array.isArray(path)||!path.length)return Infinity;
  let distance=Infinity;
  for(let i=0;i<path.length;i++){
    if(valid(path[i]))distance=Math.min(distance,Math.hypot(point.x-path[i].x,point.y-path[i].y));
    if(i)distance=Math.min(distance,distanceToSegment(point,path[i-1],path[i]));
  }
  // Do not invent a closing segment or bridge missing points.
  return distance;
}
export function placementDistance(point,placement){
  const spawn=valid(point)&&valid(placement.worldPosition)?Math.hypot(point.x-placement.worldPosition.x,point.y-placement.worldPosition.y):Infinity;
  const patrol=distanceToPatrol(point,placement.patrolPath);
  return {distance:Math.min(spawn,patrol),spawnDistance:spawn,patrolDistance:patrol,evidence:patrol<spawn?'patrol':'spawn'};
}

// Compile shared patrol geometry once per pack. Bounds only reject shapes that
// cannot be within the requested range; distances still use the same projection
// and Math.hypot as placementDistance, including isolated patrol vertices.
export function createPackDistance(placements){
  const shapes=[],seen=new Set();
  const add=(a,b=a)=>{
    if(!valid(a)||!valid(b))return;
    const key=JSON.stringify([a.x,a.y,b.x,b.y]);if(seen.has(key))return;seen.add(key);
    const dx=b.x-a.x,dy=b.y-a.y;
    shapes.push({x:a.x,y:a.y,dx,dy,length:dx*dx+dy*dy,
      minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)});
  };
  for(const p of placements){
    add(p.worldPosition);
    const path=p.patrolPath;
    if(!Array.isArray(path))continue;
    for(let i=0;i<path.length;i++){add(path[i]);if(i)add(path[i-1],path[i]);}
  }
  const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
  for(const s of shapes){bounds.minX=Math.min(bounds.minX,s.minX);bounds.maxX=Math.max(bounds.maxX,s.maxX);bounds.minY=Math.min(bounds.minY,s.minY);bounds.maxY=Math.max(bounds.maxY,s.maxY);}
  const outside=(p,s,r)=>p.x<s.minX-r||p.x>s.maxX+r||p.y<s.minY-r||p.y>s.maxY+r;
  return (point,range=Infinity)=>{
    if(!valid(point)||outside(point,bounds,range))return Infinity;
    let best=Infinity,limit=range;
    for(const s of shapes){
      if(outside(point,s,limit))continue;
      const fraction=s.length?Math.max(0,Math.min(1,((point.x-s.x)*s.dx+(point.y-s.y)*s.dy)/s.length)):0;
      const d=Math.hypot(point.x-s.x-fraction*s.dx,point.y-s.y-fraction*s.dy);
      if(d<best){best=d;limit=Math.min(range,best);}
    }
    return best<=range?best:Infinity;
  };
}
