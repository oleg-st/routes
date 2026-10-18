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
export function separateMarkerCenters(markers,gap=0,overlap=0,{tolerance=.001,maxChecks=1200000}={}){
  const placed=markers.map(({id,point,radius,maxDisplacement=Infinity})=>({id,x:point[0],y:point[1],ox:point[0],oy:point[1],radius,maxDisplacement})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(!placed.length)return new Map();
  const cellSize=placed.reduce((size,p)=>Math.max(size,p.radius*2+gap),1),epsilonSquared=tolerance*tolerance;
  // Count candidate visits, including rejected pairs, to bound even coincident
  // crowds. A local cap distributes work instead of spending it on one mob.
  let checks=0;
  const neighborLimit=Math.max(64,Math.floor(maxChecks/placed.length/4));
  const move=(marker,dx,dy)=>{
    let x=marker.x+dx-marker.ox,y=marker.y+dy-marker.oy;
    const squared=x*x+y*y;
    if(squared>marker.maxDisplacement*marker.maxDisplacement){const ratio=marker.maxDisplacement/Math.sqrt(squared);x*=ratio;y*=ratio;}
    x+=marker.ox;y+=marker.oy;
    const mx=x-marker.x,my=y-marker.y;marker.x=x;marker.y=y;
    return mx*mx+my*my>epsilonSquared;
  };
  passes:for(let pass=0;pass<80;pass++){
    // Only nearby cells can collide; avoid comparing every mob on the map.
    // Numeric keys avoid allocating a string for every neighbor lookup.
    const cells=new Map();
    for(let i=0;i<placed.length;i++){
      const marker=placed[i],cx=Math.floor(marker.x/cellSize),cy=Math.floor(marker.y/cellSize);
      let column=cells.get(cx);if(!column)cells.set(cx,column=new Map());
      let bucket=column.get(cy);if(!bucket)column.set(cy,bucket=[]);bucket.push(i);
    }
    let moved=false,truncated=false;
    for(let i=0;i<placed.length;i++){
      const a=placed[i],cx=Math.floor(a.x/cellSize),cy=Math.floor(a.y/cellSize);
      let neighbors=0;
      nearby:for(let gx=cx-1;gx<=cx+1;gx++){
        const column=cells.get(gx);if(!column)continue;
        for(let gy=cy-1;gy<=cy+1;gy++){
          const bucket=column.get(gy);if(!bucket)continue;
          const offset=bucket.length>neighborLimit?(pass*31+i*17)%bucket.length:0;
          for(let k=0;k<bucket.length;k++){
            if(checks++>=maxChecks)break passes;
            if(neighbors++>=neighborLimit){truncated=true;break nearby;}
            const j=bucket[(k+offset)%bucket.length];if(j<=i)continue;
            const b=placed[j],dx=b.x-a.x,dy=b.y-a.y;
            // Measure overlap depth against the smaller portrait's diameter.
            const squared=dx*dx+dy*dy,minimum=a.radius+b.radius+gap-2*Math.min(a.radius,b.radius)*overlap;
            if(squared>=(minimum-tolerance)**2)continue;
            const distance=Math.sqrt(squared);
            const angle=(i*137.508+j*99.492)*Math.PI/180;
            const ux=distance?dx/distance:Math.cos(angle),uy=distance?dy/distance:Math.sin(angle),shift=(minimum-distance)/2;
            const da=move(a,-ux*shift,-uy*shift),db=move(b,ux*shift,uy*shift);
            if(da||db)moved=true;
          }
        }
      }
    }
    if(!moved&&!truncated)break;
  }
  return new Map(placed.map(({id,x,y})=>[id,[x,y]]));
}
