import {hasCompatibleAssignment} from './assignment.js';

// Position samples can arrive after several Chicken casts. Keep every possible
// one-to-one pairing in a complete batch; observation order is not spawn order.
// Incomplete batches cannot establish which target owns the observed chicken.
export function chickenReplacements(casts,rows){
  const chickens=rows.filter(r=>[277,278].includes(r.gameID));
  const choices=casts.map(c=>chickens.filter(r=>r.firstTime>=c.timestamp&&r.firstTime<c.timestamp+10000));
  const result=new Map(),visited=new Set();
  for(let start=0;start<casts.length;start++){
    if(visited.has(start))continue;
    const batch=[start],members=new Set();visited.add(start);
    for(let i=0;i<batch.length;i++)for(const chicken of choices[batch[i]]){
      if(members.has(chicken))continue;
      members.add(chicken);
      for(let j=0;j<casts.length;j++)if(!visited.has(j)&&choices[j].includes(chicken)){visited.add(j);batch.push(j);}
    }
    const keys=batch.map(i=>`${casts[i].targetID}:${casts[i].targetInstance??1}`);
    const options=batch.map(i=>choices[i]);
    if(members.size!==batch.length||new Set(keys).size!==batch.length||!hasCompatibleAssignment(options))continue;
    for(const [i,key]of keys.entries()){
      const possible=options[i].filter(chicken=>hasCompatibleAssignment(options.filter((_,j)=>j!==i).map(cs=>cs.filter(c=>c!==chicken))));
      result.set(key,possible);
    }
  }
  return result;
}
