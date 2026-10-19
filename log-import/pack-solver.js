// Enumerate complete-pack explanations. No geometric guess is accepted as fact.
// Wildcards are observed transformed enemies whose original type is unknown.
export function solveCompletePacks(packs,target,{requiredIDs=[],wildcards=0,optionalTarget={},maxSolutions=10000,maxNodes=1000000,canSelect,canComplete,canContinue}={}){
  const required=new Set(requiredIDs),knownIDs=new Set(packs.map(p=>p.id));
  if([...required].some(id=>!knownIDs.has(id)))throw new Error('Required pack is missing.');
  const types=[...new Set([...Object.keys(target),...Object.keys(optionalTarget),...packs.flatMap(p=>Object.keys(p.counts))])];
  // Optional observations may occupy a selected whole pack or remain outside
  // it (confirmed death skips). canComplete must validate their joint assignment.
  const wanted=types.map(t=>target[t]||0),maximum=types.map((t,i)=>wanted[i]+(optionalTarget[t]||0));
  const minimumSize=wanted.reduce((s,n)=>s+n,0)+wildcards,budget=maximum.reduce((s,n)=>s+n,0)+wildcards;
  const rows=packs.map(p=>({...p,vector:types.map(t=>p.counts[t]||0),size:Object.values(p.counts).reduce((s,n)=>s+n,0)}));
  const forced=rows.filter(p=>required.has(p.id)),optional=rows.filter(p=>!required.has(p.id)).sort((a,b)=>b.size-a.size);
  const initial=types.map((_,i)=>forced.reduce((s,p)=>s+p.vector[i],0));
  const excess=counts=>counts.reduce((sum,n,i)=>sum+Math.max(0,n-maximum[i]),0);
  const suffix=Array.from({length:optional.length+1},()=>types.map(()=>0));
  for(let i=optional.length-1;i>=0;i--)suffix[i]=suffix[i+1].map((n,j)=>n+optional[i].vector[j]);
  const solutions=[];let nodes=0,truncated=false;
  // canSelect must reject only sets whose supersets are also incompatible.
  // This prunes impossible assignments before they consume the solution cap.
  function visit(index,counts,size,selected,changed=true){
    if(truncated)return;
    if(++nodes>maxNodes){truncated=true;return;}
    if(size>budget||excess(counts)>wildcards||counts.some((n,j)=>n+suffix[index][j]<wanted[j]))return;
    if(canContinue&&!canContinue(selected,optional.slice(index).map(p=>p.id)))return;
    if(changed&&canSelect&&!canSelect(selected))return;
    if(changed&&size>=minimumSize&&counts.every((n,j)=>n>=wanted[j])){
      if(!canComplete||canComplete(selected)){
        if(solutions.length===maxSolutions){truncated=true;return;}
        solutions.push({packIDs:[...selected],wildcardTypes:Object.fromEntries(types.map((t,j)=>[t,counts[j]-maximum[j]]).filter(([,n])=>n>0))});
      }
    }
    if(size===budget)return;
    if(index===optional.length)return;
    const pack=optional[index];
    visit(index+1,counts.map((n,j)=>n+pack.vector[j]),size+pack.size,[...selected,pack.id]);
    visit(index+1,counts,size,selected,false);
  }
  visit(0,initial,forced.reduce((s,p)=>s+p.size,0),forced.map(p=>p.id));
  return {solutions,exhaustive:!truncated,nodes};
}
