// Eternal retains the exported offset of 20. Below it, raw level alone cannot
// distinguish the new Casual buckets (all use level 1) or a historical league.
export function fightDifficulty(level){
  if(!Number.isInteger(level)||level<=0)return null;
  if(level>20)return `Eternal ${level-20}`;
  return `Difficulty ${level}`;
}
export function fightLabel(fight){
  const duration=fight.kill===true&&fight.completionTime>0?fight.completionTime:fight.endTime-fight.startTime;
  const seconds=Math.max(0,Math.floor(duration/1000));
  const status=fight.inProgress?'In progress':fight.kill===false?'Wipe':null;
  return [fight.name,`#${fight.id}`,fightDifficulty(fight.difficultyLevel),status,`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`].filter(Boolean).join(' · ');
}
