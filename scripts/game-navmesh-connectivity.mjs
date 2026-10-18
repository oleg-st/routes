import assert from 'node:assert/strict';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const midpoint=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const key=(tile,poly)=>`${tile}/${poly}`;

// Static topology witness, not a replacement for Unreal/Detour pathfinding.
// Match only opposite portal edges in adjacent grid cells, allowing layers to
// differ. Never connect polygons based on XY proximity alone.
export function buildGraph(mesh,{maxPortalHeightGap=0.1,allowIgnoredOffMesh=false}={}){
  const nodes=new Map(),portals=[];let internalEdges=0;
  const offMeshCount=mesh.tiles.reduce((n,t)=>n+t.offMeshConnections.length+t.offMeshSegments.length,0);
  assert.ok(allowIgnoredOffMesh||offMeshCount===0,'Off-mesh links require explicit handling');
  for(const t of mesh.tiles)for(const p of t.polygons){
    if(p.type!==0||p.flags===0||p.area===0)continue;
    const vertices=p.vertices.map(i=>t.vertices[i]);
    nodes.set(key(t.id,p.index),{id:key(t.id,p.index),tile:t.id,polygon:p.index,grid:t.grid,vertices,
      center:[0,1,2].map(i=>vertices.reduce((n,v)=>n+v[i],0)/vertices.length),edges:[]});
  }
  for(const t of mesh.tiles)for(const p of t.polygons){
    const a=nodes.get(key(t.id,p.index));if(!a)continue;
    p.neighbors.forEach((n,i)=>{
      const from=t.vertices[p.vertices[i]],to=t.vertices[p.vertices[(i+1)%p.vertices.length]];
      if(n.kind==='internal'){
        const b=nodes.get(key(t.id,n.polygon));if(!b)return;
        // Check the serialized neighbor actually shares this edge.
        assert.ok(b.vertices.some(v=>distance(v,from)<1e-6)&&b.vertices.some(v=>distance(v,to)<1e-6));
        a.edges.push({to:b.id,kind:'internal',crossing:midpoint(from,to),heightGap:0});internalEdges++;
      }else if(n.kind==='portal'){
        assert.ok([0,2,4,6].includes(n.side),'Unsupported diagonal portal');
        const axis=n.side%4===0?0:1,along=1-axis;
        assert.ok(Math.abs(from[axis]-to[axis])<0.01);
        const ends=[from,to].sort((x,y)=>x[along]-y[along]);
        portals.push({node:a,side:n.side,axis,along,ends,plane:from[axis],matched:false});
      }
    });
  }
  const byCell=new Map();for(const p of portals){const id=`${p.node.grid.x}:${p.node.grid.y}:${p.side}`;
    if(!byCell.has(id))byCell.set(id,[]);byCell.get(id).push(p);}
  const shifts={0:[1,0],2:[0,1],4:[-1,0],6:[0,-1]};let portalEdges=0;
  for(const a of portals){
    const [dx,dy]=shifts[a.side];
    for(const b of byCell.get(`${a.node.grid.x+dx}:${a.node.grid.y+dy}:${(a.side+4)%8}`)??[]){
      if(Math.abs(a.plane-b.plane)>0.01)continue;
      const axis=a.along,lo=Math.max(a.ends[0][axis],b.ends[0][axis])+0.01,hi=Math.min(a.ends[1][axis],b.ends[1][axis])-0.01;
      if(lo>hi)continue;
      const z=(p,x)=>p.ends[0][2]+(p.ends[1][2]-p.ends[0][2])*(x-p.ends[0][axis])/(p.ends[1][axis]-p.ends[0][axis]);
      const d0=z(a,lo)-z(b,lo),d1=z(a,hi)-z(b,hi);
      let x=d0*d1<0?lo+(hi-lo)*d0/(d0-d1):Math.abs(d0)<Math.abs(d1)?lo:hi;
      // Prefer the midpoint when the complete overlap agrees in height.
      if(Math.max(Math.abs(d0),Math.abs(d1))<=maxPortalHeightGap)x=(lo+hi)/2;
      const gap=Math.abs(z(a,x)-z(b,x));if(gap>maxPortalHeightGap+1e-6)continue;
      const crossing=[0,0,(z(a,x)+z(b,x))/2];crossing[a.axis]=a.plane;crossing[axis]=x;
      a.node.edges.push({to:b.node.id,kind:'portal',crossing,heightGap:gap});a.matched=true;portalEdges++;
    }
  }
  for(const a of nodes.values())for(const e of a.edges)assert.ok(nodes.get(e.to).edges.some(f=>f.to===a.id),'Non-reciprocal static link');
  return {nodes,stats:{polygons:nodes.size,internalDirectedEdges:internalEdges,portalDirectedEdges:portalEdges,
    portalEdges:portals.length,unmatchedPortalEdges:portals.filter(p=>!p.matched).length,maxPortalHeightGap,ignoredOffMesh:offMeshCount},
    unmatchedPortals:portals.filter(p=>!p.matched).map(p=>({node:p.node.id,side:p.side,ends:p.ends}))};
}

export function search(graph,start,end,allowed=()=>true){
  assert.ok(graph.nodes.has(start)&&graph.nodes.has(end));
  const visited=new Map([[start,null]]),queue=[start];
  for(let i=0;i<queue.length;i++){
    const id=queue[i];if(id===end)break;
    for(const e of graph.nodes.get(id).edges)if(!visited.has(e.to)&&allowed(graph.nodes.get(e.to))){visited.set(e.to,{from:id,edge:e});queue.push(e.to);}
  }
  if(!visited.has(end))return {connected:false,visited:visited.size};
  const corridor=[];let id=end;
  while(id!==start){const p=visited.get(id);corridor.push({from:p.from,...p.edge});id=p.from;}corridor.reverse();
  return {connected:true,visited:visited.size,corridor};
}
