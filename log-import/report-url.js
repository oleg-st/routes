export function parseReportURL(value,{requireFight=true}={}){
  let url;try{url=new URL(value);}catch{throw new Error('Enter a Fellowship Logs report URL.');}
  if(url.protocol!=='https:'||!['www.fellowshiplogs.com','fellowshiplogs.com'].includes(url.hostname)||url.port||url.username||url.password)throw new Error('Use an HTTPS Fellowship Logs report URL.');
  const match=/^\/reports\/([A-Za-z0-9]{16})\/?$/.exec(url.pathname);
  if(!match)throw new Error('Report code was not found in the URL.');
  const query=url.searchParams.get('fight'),fragment=new URLSearchParams(url.hash.slice(1)).get('fight');
  if(query&&fragment&&query!==fragment)throw new Error('The URL contains conflicting fight IDs.');
  const fight=query??fragment;
  if(fight===null&&!requireFight)return {reportCode:match[1],fightID:null};
  if(!/^[1-9]\d*$/.test(fight??'')||!Number.isSafeInteger(Number(fight)))throw new Error('Select a specific numbered fight in the URL.');
  return {reportCode:match[1],fightID:Number(fight)};
}
