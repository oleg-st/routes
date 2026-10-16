// Choices always filter whole-run candidates, never independent per-pull guesses.
import {combineProximity} from './path-proximity.js';
export function createReviewSession(fixture){
  if(!fixture.variants?.length)throw new Error('No complete route candidates.');
  let candidates=[...fixture.variants],history=[];
  function state(){
    const pulls=[];
    for(let index=0;index<candidates[0].pulls.length;index++){
      const source=candidates[0].pulls[index];
      const common=source.groups.filter(id=>candidates.every(v=>v.pulls[index].groups.includes(id)));
      pulls.push({...source,groups:common});
      const alternatives=[...new Set(candidates.flatMap(v=>v.pulls[index].groups))].filter(id=>!common.includes(id));
      if(alternatives.length){
        const options=alternatives.map(id=>({id,groups:[id],label:fixture.groups[id].label,
          proximity:combineProximity(candidates.filter(v=>v.pulls[index].groups.includes(id)).map(v=>v.proximity?.[id]))}));
        // Rank conservatively if the same pack has different engagement times
        // across compatible routes. Never remove a candidate on this soft score.
        const evidenceTier=o=>!o.proximity?2:o.proximity.estimated?1:0;
        options.sort((a,b)=>evidenceTier(a)-evidenceTier(b)||(a.proximity?.maxDistance??Infinity)-(b.proximity?.maxDistance??Infinity));
        if(options[0]?.proximity&&options.slice(1).every(o=>o.proximity&&o.proximity.minDistance>options[0].proximity.maxDistance))options[0].closestToPath=true;
        if(candidates.some(v=>v.pulls[index].groups.length===common.length))options.push({id:'finish-pull',groups:[],label:'No more packs in this pull'});
        return {pulls,pullIndex:index,options,complete:false,remaining:candidates.length,canBack:history.length>0};
      }
    }
    return {pulls,pullIndex:pulls.length-1,options:[],complete:true,remaining:candidates.length,canBack:history.length>0};
  }
  return {state,choose(id){
    const s=state(),choice=s.options.find(o=>o.id===id);
    if(!choice)throw new Error('This option is no longer available.');
    const filtered=candidates.filter(v=>id==='finish-pull'?v.pulls[s.pullIndex].groups.length===s.pulls.at(-1).groups.length:v.pulls[s.pullIndex].groups.includes(id));
    if(!filtered.length)throw new Error('Choice has no compatible route.');
    history.push(candidates);candidates=filtered;return state();
  },back(){if(history.length)candidates=history.pop();return state();}};
}
