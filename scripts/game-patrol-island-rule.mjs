import {buildGraph} from './game-navmesh-connectivity.mjs';
import {prepareNavmesh,projectTriangleXY} from './game-navmesh-surface.mjs';

const key=(t,p)=>`${t}/${p}`;
export function navigationIndex(mesh){
  const graph=buildGraph(mesh,{maxPortalHeightGap:2*mesh.agent.maxClimb,allowIgnoredOffMesh:true});
  const componentByPoly=new Map(),components=[];
  for(const id of graph.nodes.keys()){
    if(componentByPoly.has(id))continue;
    const index=components.length,queue=[id];componentByPoly.set(id,index);
    for(let i=0;i<queue.length;i++)for(const e of graph.nodes.get(queue[i]).edges)if(!componentByPoly.has(e.to)){componentByPoly.set(e.to,index);queue.push(e.to);}
    components.push({polygons:queue.length,unmatchedPortals:0,offMeshUncertainty:false});
  }
  for(const p of graph.unmatchedPortals)components[componentByPoly.get(p.node)].unmatchedPortals++;
  const triangles=prepareNavmesh(mesh).triangles.map(t=>({...t,component:componentByPoly.get(key(t.tile,t.polygon))})).filter(t=>t.component!==undefined);
  const cells=new Map(),cellSize=400;
  for(const t of triangles){
    const lo=[0,1].map(i=>Math.floor(Math.min(...t.vertices.map(p=>p[i]))/cellSize)),hi=[0,1].map(i=>Math.floor(Math.max(...t.vertices.map(p=>p[i]))/cellSize));
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++){
      const k=`${x}:${y}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(t);
    }
  }
  function nearby(p,radius){
    const out=new Set();for(let x=Math.floor((p.x-radius)/cellSize);x<=Math.floor((p.x+radius)/cellSize);x++)for(let y=Math.floor((p.y-radius)/cellSize);y<=Math.floor((p.y+radius)/cellSize);y++)for(const t of cells.get(`${x}:${y}`)??[])out.add(t);
    return out;
  }
  function query(p,{radius=1,zTolerance=5,component=null}={}){
    let best=null;
    for(const t of nearby(p,radius)){
      if(component!==null&&t.component!==component)continue;
      const hit=projectTriangleXY(p,t.vertices),dz=Math.abs(p.z-hit.point[2]);
      if(hit.horizontalDistance>radius||dz>zTolerance)continue;
      const score=hit.horizontalDistance**2+dz**2;
      if(!best||score<best.score)best={...hit,component:t.component,polygon:key(t.tile,t.polygon),score};
    }
    return best;
  }
  // Do not claim an island is disconnected if a baked special link could touch
  // it. Conservatively taint all nearby XY components at both endpoints, at any Z.
  for(const tile of mesh.tiles){
    if(tile.offMeshSegments.length)for(const c of components)c.offMeshUncertainty=true;
    for(const link of tile.offMeshConnections)for(const a of [link.from,link.to]){
      const p={x:a[0],y:a[1],z:a[2]},radius=Math.max(300,link.radius??0);
      for(const t of nearby(p,radius))if(projectTriangleXY(p,t.vertices).horizontalDistance<=radius)components[t.component].offMeshUncertainty=true;
    }
  }
  return {query,components,stats:graph.stats};
}

// Find bounded excursions, including runs that cross the seam of a loop.
export function foreignRuns(labels,looped){
  const n=labels.length,runs=[];
  for(let start=0;start<n;start++){
    const previous=(start-1+n)%n;
    if(!looped&&start===0)continue;
    if(labels[start]===null||labels[previous]===null||labels[start]===labels[previous])continue;
    const home=labels[previous],indices=[];let end=start;
    while(indices.length<n&&labels[end]!==home&&labels[end]!==null){
      indices.push(end);end++;
      if(end===n){if(!looped)break;end=0;}
    }
    if(end<n&&labels[end]===home&&indices.length<n)runs.push({before:previous,after:end,indices,home});
  }
  return runs;
}

export function auditPatrolIslands(data,nav,{projectionRadius=150,projectionHeightTolerance=150}={}){
  const candidates=[],unmapped=[],coverage={patrols:0,occupiedColumns:0,points:0,mappedPoints:0};
  for(const patrol of data.patrols){
    const occupied=patrol.columns.filter(c=>c.slots.some(Boolean));if(!occupied.length)continue;
    coverage.patrols++;
    const mapping=new Map(occupied.map(c=>{
      const hits=c.path.map(p=>nav.query(p));coverage.occupiedColumns++;coverage.points+=hits.length;coverage.mappedPoints+=hits.filter(Boolean).length;
      const indices=hits.flatMap((h,i)=>h?[]:[i]);if(indices.length)unmapped.push({patrolKey:patrol.actorKey,patrol:patrol.actorName,column:c.column,indices});
      return [c.column,hits];
    }));
    for(const col of occupied){
      const hits=mapping.get(col.column),labels=hits.map(h=>h?.component??null),s=patrol.resolvedSettings;
      for(const run of foreignRuns(labels,s.Looped)){
        const before=col.path[run.before],after=col.path[run.after],length=run.indices.length;
        const bridge=run.indices.map((index,i)=>({index,point:Object.fromEntries(['x','y','z'].map(k=>[k,before[k]+(after[k]-before[k])*(i+1)/(length+1)]))}));
        const deviations=bridge.map(({index,point})=>Math.abs(col.path[index].z-point.z));
        const foreign=[...new Set(run.indices.map(i=>labels[i]))],reasons=[];
        if(Math.max(...deviations)<=600)reasons.push('no-large-vertical-excursion');
        if(foreign.some(i=>nav.components[i].unmatchedPortals))reasons.push('foreign-component-has-unmatched-portals');
        if(foreign.some(i=>nav.components[i].offMeshUncertainty)||nav.components[run.home].offMeshUncertainty)reasons.push('off-mesh-link-uncertainty');
        if(!run.indices.every(i=>occupied.some(c=>c!==col&&mapping.get(c.column)[i]?.component===run.home)))reasons.push('no-other-column-on-home-surface');
        const replacements=bridge.map(({index,point})=>{
          const original=col.path[index],hit=nav.query({...original,z:point.z},{radius:projectionRadius,zTolerance:projectionHeightTolerance,component:run.home});
          return {index,original,expectedZ:point.z,replacement:hit?{x:hit.point[0],y:hit.point[1],z:hit.point[2]}:null,horizontalShift:hit?.horizontalDistance??null};
        });
        if(replacements.some(r=>!r.replacement))reasons.push('no-nearby-home-surface-projection');
        const duration=(length+1)*col.baseDistanceBetweenPoints/s.TargetMovementSpeed;
        if(!Number.isFinite(duration)||duration<=0)reasons.push('unknown-duration');
        candidates.push({patrolKey:patrol.actorKey,patrol:patrol.actorName,column:col.column,...run,foreign,
          durationAtTargetSpeed:duration,maxVerticalDeviation:Math.max(...deviations),reasons,replacements,
          maxHorizontalShift:Math.max(...replacements.map(r=>r.horizontalShift??Infinity)),foreignComponents:foreign.map(i=>nav.components[i])});
      }
    }
  }
  return {coverage,candidates,unmapped};
}

export function applyIslandCandidates(data,candidates,maxSeconds){
  const copy=structuredClone(data),patrols=new Map(copy.patrols.map(p=>[p.actorKey,p]));
  const accepted=candidates.filter(c=>!c.reasons.length&&c.durationAtTargetSpeed<=maxSeconds);
  const edited=new Set();
  for(const c of accepted){const column=patrols.get(c.patrolKey).columns.find(p=>p.column===c.column);
    for(const r of c.replacements){const id=`${c.patrolKey}/${c.column}/${r.index}`;if(edited.has(id))throw Error('Overlapping island corrections');edited.add(id);column.path[r.index]=r.replacement;}}
  return {data:copy,accepted,editedPoints:edited.size};
}
