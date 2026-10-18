// Convex envelope around marker discs. Handles one mob, lines and coincident points.
export function pullOutline(points,padding){
  if(!points.length)return [];
  const cloud=points.flatMap(([x,y])=>Array.from({length:20},(_,i)=>[x+Math.cos(i*Math.PI/10)*padding,y+Math.sin(i*Math.PI/10)*padding]));
  const sorted=[...new Map(cloud.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=ps=>{const h=[];for(const p of ps){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}

// Resolve collisions in display space, starting from the source on every zoom.
// A displacement limit keeps dense groups near their real positions. Crowded
// overviews may retain some overlap rather than pushing icons across the map.
export function separateMarkerCenters(markers,gap=0,overlap=0){
  const placed=markers.map(({id,point,radius,maxDisplacement=Infinity})=>({id,point:[...point],origin:point,radius,maxDisplacement})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(!placed.length)return new Map();
  const cellSize=Math.max(1,...placed.map(p=>p.radius*2+gap));
  const move=(marker,dx,dy)=>{
    let x=marker.point[0]+dx-marker.origin[0],y=marker.point[1]+dy-marker.origin[1];
    const distance=Math.hypot(x,y);
    if(distance>marker.maxDisplacement){const ratio=marker.maxDisplacement/distance;x*=ratio;y*=ratio;}
    const next=[marker.origin[0]+x,marker.origin[1]+y],delta=Math.hypot(next[0]-marker.point[0],next[1]-marker.point[1]);
    marker.point=next;return delta;
  };
  for(let pass=0;pass<80;pass++){
    // Only nearby cells can collide; avoid comparing every mob on the map.
    const cells=new Map();
    for(const [i,marker] of placed.entries()){
      const key=`${Math.floor(marker.point[0]/cellSize)},${Math.floor(marker.point[1]/cellSize)}`;
      if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
    }
    let moved=false;
    for(let i=0;i<placed.length;i++){
      const a=placed[i],cx=Math.floor(a.point[0]/cellSize),cy=Math.floor(a.point[1]/cellSize);
      for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++)for(const j of cells.get(`${gx},${gy}`)||[]){
        if(j<=i)continue;
        const b=placed[j],dx=b.point[0]-a.point[0],dy=b.point[1]-a.point[1];
        // Limit the overlap depth by the smaller portrait's diameter, so a
        // large neighbor cannot hide most of a small mob.
        const squared=dx*dx+dy*dy,minimum=a.radius+b.radius+gap-2*Math.min(a.radius,b.radius)*overlap;
        if(squared>=(minimum-.001)**2)continue;
        const distance=Math.sqrt(squared);
        // Different deterministic directions prevent coincident groups becoming
        // a long horizontal row. Sorting by ID keeps rerenders reproducible.
        const angle=(i*137.508+j*99.492)*Math.PI/180;
        const ux=distance?dx/distance:Math.cos(angle),uy=distance?dy/distance:Math.sin(angle),shift=(minimum-distance)/2;
        const da=move(a,-ux*shift,-uy*shift),db=move(b,ux*shift,uy*shift);
        if(da>.001||db>.001)moved=true;
      }
    }
    if(!moved)break;
  }
  return new Map(placed.map(({id,point})=>[id,point]));
}
