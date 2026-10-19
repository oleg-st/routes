import {minimumAssignment} from './assignment.js';

// Retained observations belong to selected whole packs. Confirmed survivors
// may also occupy unused positions outside them; those packs need not be full.
// Every selected placement and every observation still needs a distinct match.
function assignType({rows,placements,selected,skippedKeys,pair,missingBudget}){
  const required=new Set(selected.map(p=>p.placementId)),n=rows.length+missingBudget;
  if(placements.length<n||required.size>n)return null;
  const base=rows.map(r=>placements.map(p=>{
    const e=pair.get(`${r.key}|${p.placementId}`);
    return e?.allowed&&(skippedKeys.has(r.key)||required.has(p.placementId))?
      e.distance+(e.gap||e.neighbor?1e9:0):null;
  }));
  let maximum=0;
  for(const costs of base)for(const cost of costs)if(cost!==null)maximum=Math.max(maximum,cost);
  // Covering required columns takes priority over all geometric preferences;
  // forbidden pairs cost more than any fully compatible assignment.
  const outside=(n+1)*(maximum+1),blocked=(n+1)*(outside+maximum+1);
  const costs=base.map(row=>row.map((cost,j)=>cost===null?blocked:cost+(required.has(placements[j].placementId)?0:outside)));
  for(let i=0;i<missingBudget;i++)costs.push(placements.map(p=>required.has(p.placementId)?0:blocked));
  const result=minimumAssignment(costs);
  if(result.columns.some((col,i)=>costs[i][col]>=blocked)||
    selected.some(p=>!result.columns.some(col=>placements[col].placementId===p.placementId)))return null;
  let score=0,cost=0;
  const assignments=rows.map((r,i)=>{
    const p=placements[result.columns[i]],e=pair.get(`${r.key}|${p.placementId}`);score+=e.distance;cost+=base[i][result.columns[i]];
    return {key:r.key,placementId:p.placementId,firstTime:r.firstTime,...(e.gap?{gap:e.gap}:{}),...(e.neighbor?{neighbor:e.neighbor}:{})};
  });
  return {assignments,score,cost};
}

// Different NPC types never share a placement. Cache each type's assignment
// across pack combinations, rather than repeatedly solving one large matrix.
export function createDeathSkipAssignment({rows,placements,skippedKeys,pair,catalog}){
  const rowsByType=Map.groupBy(rows,r=>r.gameID),placementsByType=Map.groupBy(placements,p=>catalog?.get(p.id)?.gameId);
  const types=[...new Set([...rowsByType.keys(),...placementsByType.keys()])],caches=new Map(types.map(t=>[t,new Map()]));
  return (selected,missingBudget)=>{
    const selectedByType=Map.groupBy(selected,p=>catalog?.get(p.id)?.gameId);
    let states=[{assignments:[],score:0,cost:0}];
    for(const type of types){
      const ps=selectedByType.get(type)??[],cache=caches.get(type),key=ps.map(p=>p.placementId).join('|');
      const next=[];
      for(let missing=0;missing<=missingBudget;missing++){
        const identity=`${missing}:${key}`;
        if(!cache.has(identity))cache.set(identity,assignType({rows:rowsByType.get(type)??[],placements:placementsByType.get(type)??[],selected:ps,skippedKeys,pair,missingBudget:missing}));
        const match=cache.get(identity);if(!match)continue;
        for(let total=missing;total<=missingBudget;total++){
          const previous=states[total-missing];if(!previous)continue;
          const cost=previous.cost+match.cost;
          if(!next[total]||cost<next[total].cost)next[total]={assignments:[...previous.assignments,...match.assignments],score:previous.score+match.score,cost};
        }
      }
      if(!next.length)return null;
      states=next;
    }
    return states[missingBudget]??null;
  };
}

export function assignDeathSkipPacks({selected,missingBudget,...options}){
  return createDeathSkipAssignment(options)(selected,missingBudget);
}
