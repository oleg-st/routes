// Handwritten UI scenarios, not exported Fellowship Logs data.
const groups=Object.fromEntries(['a','b','c','d','e'].map((id,i)=>[id,{id,label:`G${i+1}`,enemies:[id],excluded:[],empowered:[]}]));
const pull=(id,members)=>({id,label:`Pull ${id}`,groups:members});
const base={dungeonData:'custom',duration:60,groups,drawings:[],note:'Synthetic review scenario.'};
export const logFixtures=[
  {...base,id:'JLhT1y4Fa3n9Xjx8-6',title:'Choice scenario',reportCode:'JLhT1y4Fa3n9Xjx8',fightID:6,
    variants:['b','c'].flatMap(m=>['d','e'].map(n=>({pulls:[pull(1,['a']),pull(2,[m]),pull(3,[n])]})))},
  {...base,id:'c4nFLaThdAxtVpYv-5',title:'Immediate scenario',reportCode:'c4nFLaThdAxtVpYv',fightID:5,
    variants:[{pulls:[pull(1,['a','b']),pull(2,['c'])]}]},
  {...base,id:'rgTQYB9dqPzjJFha-7',title:'Hypothesis scenario',reportCode:'rgTQYB9dqPzjJFha',fightID:7,
    assumption:'One unobserved member is included; this route is a hypothesis.',inferredPlacements:['a'],
    variants:[{pulls:[pull(1,['a','b']),pull(2,['c'])]},{pulls:[pull(1,['a','c']),pull(2,['b'])]}]},
];
