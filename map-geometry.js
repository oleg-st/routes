// Convex envelope around marker discs. Handles one mob, lines and coincident points.
export function pullOutline(points,padding){
  if(!points.length)return [];
  const cloud=points.flatMap(([x,y])=>Array.from({length:20},(_,i)=>[x+Math.cos(i*Math.PI/10)*padding,y+Math.sin(i*Math.PI/10)*padding]));
  const sorted=[...new Map(cloud.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=ps=>{const h=[];for(const p of ps){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}
