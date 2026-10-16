// Current leagues have four levels and a capstone (five raw levels each).
// For the supplied report, raw level 75 is displayed by FL as Eternal 55.
export function fightDifficulty(level){
  if(!Number.isInteger(level)||level<=0)return null;
  if(level>20)return `Eternal ${level-20}`;
  return `${['Contender','Adept','Champion','Paragon'][Math.floor((level-1)/5)]} ${(level-1)%5+1}`;
}
export function fightLabel(fight){
  const duration=fight.kill===true&&fight.completionTime>0?fight.completionTime:fight.endTime-fight.startTime;
  const seconds=Math.max(0,Math.floor(duration/1000));
  const status=fight.inProgress?'In progress':fight.kill===false?'Wipe':null;
  return [fight.name,`#${fight.id}`,fightDifficulty(fight.difficultyLevel),status,`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`].filter(Boolean).join(' · ');
}
