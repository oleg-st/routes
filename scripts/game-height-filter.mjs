// Conservative planner heuristic, not a game rule or proof of runtime inactivity.
// Evaluate the complete selected dungeon population, never individual floors.
export const heightFilterPolicy=Object.freeze({
  minGap:10000,minGapToMainSpan:3,maxExcludedFraction:0.01,minMainPopulation:20,
});
export function filterLowHeightOutliers(mobs,policy=heightFilterPolicy){
  const {minGap,minGapToMainSpan,maxExcludedFraction,minMainPopulation}=policy;
  if(!Number.isFinite(minGap)||minGap<=0||!Number.isFinite(minGapToMainSpan)||minGapToMainSpan<=0||
    !Number.isFinite(maxExcludedFraction)||maxExcludedFraction<=0||maxExcludedFraction>=0.5||
    !Number.isInteger(minMainPopulation)||minMainPopulation<2)throw Error('Invalid height filter policy');
  if(mobs.some(m=>!Number.isFinite(m.worldPosition?.z)))throw Error('Height filter requires finite world Z for every mob');
  const sorted=[...mobs].sort((a,b)=>a.worldPosition.z-b.worldPosition.z);
  const maxCount=Math.min(Math.floor(mobs.length*maxExcludedFraction),mobs.length-minMainPopulation);
  let cut=null;
  for(let count=1;count<=maxCount;count++){
    const lowMax=sorted[count-1].worldPosition.z,mainMin=sorted[count].worldPosition.z;
    const mainMax=sorted.at(-1).worldPosition.z,gap=mainMin-lowMax,mainSpan=mainMax-mainMin;
    if(gap<minGap||gap<minGapToMainSpan*mainSpan)continue;
    if(!cut||gap>cut.gap)cut={count,gap,lowMax,mainMin,mainMax,mainSpan,excludedFraction:count/mobs.length};
  }
  const removed=new Set(cut?sorted.slice(0,cut.count):[]);
  return {active:mobs.filter(m=>!removed.has(m)),excluded:mobs.filter(m=>removed.has(m)),evidence:cut,policy:{...policy}};
}
