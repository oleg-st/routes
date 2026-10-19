import {minimumAssignment} from './assignment.js';

// Retained observations belong to selected whole packs. Confirmed survivors
// may also occupy unused positions outside them; those packs need not be full.
// Every selected placement and every observation still needs a distinct match.
function assignType({rows,placements,selected,skippedKeys,pair,missingBudget,engagementByKey,sharedEngagements,modes,forcedRows}){
  const required=new Set(selected.map(p=>p.placementId)),n=rows.length+missingBudget;
  if(placements.length<n||required.size>n)return null;
  const base=rows.map(r=>placements.map(p=>{
    const e=pair.get(`${r.key}|${p.placementId}`);
    if(forcedRows.has(r.key)&&forcedRows.get(r.key)!==p.packId)return null;
    if(engagementByKey&&required.has(p.placementId)){
      const mode=modes.get(p.packId),engagement=engagementByKey.get(r.key);
      if(mode!==undefined&&mode!==null&&engagement!==mode)return null;
      if(skippedKeys.has(r.key)&&(mode===null||!sharedEngagements.get(p.packId)?.has(engagement)))return null;
    }
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
export function createDeathSkipAssignment({rows,placements,skippedKeys,pair,catalog,engagementByKey}){
  const rowsByType=Map.groupBy(rows,r=>r.gameID),placementsByType=Map.groupBy(placements,p=>catalog?.get(p.id)?.gameId);
  const byPlacement=new Map(placements.map(p=>[p.placementId,p]));
  const types=[...new Set([...rowsByType.keys(),...placementsByType.keys()])],caches=new Map(types.map(t=>[t,new Map()]));
  // A survivor first seen in a later diversion cannot complete an earlier
  // killed pack (or a pack first observed after the diversion). Mixing is only
  // possible within the same engagement, e.g. a partially killed diversion.
  const sharedEngagements=new Map(),retainedByPack=new Map();
  if(engagementByKey)for(const [pack,ps]of Map.groupBy(placements,p=>p.packId)){
    const possible=rows.filter(r=>ps.some(p=>pair.get(`${r.key}|${p.placementId}`)?.allowed));
    const retained=new Set(possible.filter(r=>!skippedKeys.has(r.key)).map(r=>engagementByKey.get(r.key)));
    retainedByPack.set(pack,possible.filter(r=>!skippedKeys.has(r.key)));
    sharedEngagements.set(pack,new Set(possible.filter(r=>skippedKeys.has(r.key)&&retained.has(engagementByKey.get(r.key))).map(r=>engagementByKey.get(r.key))));
  }
  return (selected,missingBudget)=>{
    const selectedByType=Map.groupBy(selected,p=>catalog?.get(p.id)?.gameId);
    const selectedIDs=new Set(selected.map(p=>p.placementId));
    const selectedPacks=new Set(selected.map(p=>p.packId));
    let nodes=0;
    const solve=(modes,forcedRows=new Map())=>{
      if(++nodes>20000)throw Object.assign(new Error('Too many death-skip assignments to check completely. No route was created.'),{diagnostics:{code:'matching-limit',nodes}});
      let states=[{assignments:[],score:0,cost:0}];
      for(const type of types){
        const ps=selectedByType.get(type)??[],cache=caches.get(type),key=JSON.stringify([
          ps.map(p=>[p.placementId,modes.get(p.packId)??(modes.has(p.packId)?'no-skip':'any')]),
          (rowsByType.get(type)??[]).filter(r=>forcedRows.has(r.key)).map(r=>[r.key,forcedRows.get(r.key)]),
        ]);
        const next=[];
        for(let missing=0;missing<=missingBudget;missing++){
          const identity=`${missing}:${key}`;
          if(!cache.has(identity))cache.set(identity,assignType({rows:rowsByType.get(type)??[],placements:placementsByType.get(type)??[],selected:ps,skippedKeys,pair,missingBudget:missing,engagementByKey,sharedEngagements,modes,forcedRows}));
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
      const result=states[missingBudget]??null;
      if(!result||!engagementByKey)return result;
      const conflict=[...Map.groupBy(result.assignments.filter(a=>selectedIDs.has(a.placementId)),a=>byPlacement.get(a.placementId).packId)]
        .find(([,as])=>as.some(a=>skippedKeys.has(a.key))&&new Set(as.map(a=>engagementByKey.get(a.key))).size>1);
      if(!conflict){
        const retainedPacks=new Set(result.assignments.filter(a=>!skippedKeys.has(a.key)).map(a=>byPlacement.get(a.placementId).packId));
        const uncovered=[...selectedPacks].find(pack=>!retainedPacks.has(pack));
        if(uncovered===undefined)return result;
        // Every selected route pack needs an actual retained observation, not
        // just survivors/wildcards. Try each possible witness jointly.
        let best=null;
        for(const r of retainedByPack.get(uncovered)??[]){
          if(forcedRows.has(r.key))continue;
          const next=solve(modes,new Map([...forcedRows,[r.key,uncovered]]));
          if(next&&(!best||next.cost<best.cost))best=next;
        }
        return best;
      }
      // Resolve cross-type conflicts jointly. Branch only on the conflicting
      // pack instead of enumerating every pack/engagement combination up front.
      const [pack]=conflict;let best=null;
      for(const mode of [null,...sharedEngagements.get(pack)]){
        const next=solve(new Map([...modes,[pack,mode]]),forcedRows);
        if(next&&(!best||next.cost<best.cost))best=next;
      }
      return best;
    };
    return solve(new Map());
  };
}

export function assignDeathSkipPacks({selected,missingBudget,...options}){
  return createDeathSkipAssignment(options)(selected,missingBudget);
}
