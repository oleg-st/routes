// Only a prepared route can make these matching failures recoverable.
export const recoverableMatchingProblems={
  'no-compatible-route':'The observed enemies could not be matched to complete packs.',
  'unknown-chicken-target':'An original enemy targeted by Chicken could not be identified.',
  'matching-limit':'There are too many pack combinations to check completely.',
  'matching-timeout':'Complete route matching took too long.'
};

export function routeImportIssues(result,code){
  const issues=[];
  if(recoverableMatchingProblems[code])issues.push({code,message:recoverableMatchingProblems[code]});
  if(result.partial)issues.push({code:'partial-route',message:
    `Only ${result.partial.matched} matched ${result.partial.matched===1?'enemy':'enemies'} will be imported. ${result.partial.skipped.length} ${result.partial.skipped.length===1?'observation':'observations'} will be omitted. Pack membership and ambiguous positions need manual review.`});
  for(const kind of ['portal','invis']){
    const count=result.skippedRelics?.filter(r=>r.kind===kind).length??0;
    if(count)issues.push({code:`unplaced-${kind}`,message:
      `${count} ${kind==='portal'?'portal':'invisibility'} marker${count===1?'':'s'} could not be placed reliably on the map and will be omitted. Add ${count===1?'it':'them'} manually.`});
  }
  return issues;
}
