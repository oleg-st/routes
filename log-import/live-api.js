import {parseReportURL} from './report-url.js';

// Buffs, stacks and channels also carry movement samples between attacks.
// Keep their coordinates without treating a passive aura as a new engagement.
// Combatant info, gear, rankings and ability descriptions are still unnecessary.
export const routeEventTypes=['damage','cast','begincast','applydebuff','death','summon','heal','resourcechange','resurrect','mapchange','dungeonencounterstart','dungeonencounterend'];
export const positionEventTypes=['applybuff','refreshbuff','removebuff','applybuffstack','removebuffstack',
  'refreshdebuff','removedebuff','applydebuffstack','removedebuffstack','beginchannel','endchannel'];
export const routeEffectIDs=[1478,1486,1506,1002146,1002176,1000044];
export const routeEventFilter=`type IN (${[...routeEventTypes,...positionEventTypes].map(t=>`"${t}"`).join(',')}) OR ability.id IN (${routeEffectIDs.join(',')})`;
export const fightsQuery=`query RouteImportFights($code:String!){reportData{report(code:$code){
  fights(translate:false){id name startTime endTime difficultyLevel completionTime kill inProgress}
}}}`;
export const metadataQuery=`query RouteImportMetadata($code:String!,$fights:[Int]!){reportData{report(code:$code){
  fights(fightIDs:$fights,translate:false){id name startTime endTime difficultyLevel inProgress modifiers friendlyPlayers
    dungeonPulls{id startTime endTime encounterID}}
  masterData(translate:false){actors{id gameID type subType petOwner}}
}}}`;
export const eventsQuery=`query RouteImportEvents($code:String!,$fights:[Int]!,$start:Float!,$end:Float!,$filter:String!){reportData{report(code:$code){
  events(fightIDs:$fights,startTime:$start,endTime:$end,limit:10000,dataType:All,hostilityType:Friendlies,
    filterExpression:$filter,includeResources:true,useActorIDs:true){data nextPageTimestamp}
}}}`;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
export function compactRouteEvent(event){
  const result=pick(event,['timestamp','type','fight','sourceID','sourceInstance','targetID','targetInstance','attackerID','attackerInstance','abilityGameID','extraAbilityGameID','encounterID','mapName','fake']);
  // Preserve actual damage for priority-target research; older diagnostics lack it.
  if(event.type==='damage')for(const field of ['amount','overkill'])if(Number.isFinite(event[field]))result[field]=event[field];
  if(positionEventTypes.includes(event.type)&&!routeEffectIDs.includes(event.abilityGameID))result.positionOnly=true;
  for(const side of ['source','target','attacker'])if(event[side+'Resources'])result[side+'Resources']=pick(event[side+'Resources'],['x','y','hitPoints','maxHitPoints']);
  return result;
}
export function isRouteEvent(event){return routeEventTypes.includes(event.type)||positionEventTypes.includes(event.type)||routeEffectIDs.includes(event.abilityGameID);}
function reportQuery({token,signal,fetcher=fetch}){
  return async function query(query,variables){
    signal?.throwIfAborted();
    let response;
    try{response=await fetcher('https://www.fellowshiplogs.com/api/v2/user',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,variables})});}
    catch{signal?.throwIfAborted();throw new Error('Fellowship Logs request failed or timed out. Please retry.');}
    if(!response.ok){const error=new Error(response.status===401?'Fellowship Logs session expired. Connect again.':`Fellowship Logs returned HTTP ${response.status}.`);error.status=response.status;throw error;}
    const result=await response.json();
    // Never put remote error text/response bodies (or credentials) in the UI.
    if(result.errors?.length)throw new Error('Fellowship Logs rejected the import query. Check report access; the API may have changed.');
    const report=result.data?.reportData?.report;
    if(!report)throw new Error('Report unavailable. Check the link and your access to this report.');
    return report;
  };
}
export async function loadReportFights(url,options){
  const selection=parseReportURL(url,{requireFight:false});
  const report=await reportQuery(options)(fightsQuery,{code:selection.reportCode});
  if(!Array.isArray(report.fights))throw new Error('The report did not return its fight list.');
  const fights=report.fights.filter(f=>Number.isSafeInteger(f.id)&&f.id>0&&Number.isFinite(f.startTime)&&Number.isFinite(f.endTime))
    .sort((a,b)=>b.startTime-a.startTime||b.id-a.id);
  if(!fights.length)throw new Error('This report has no fights available to import.');
  return {...selection,fights,selectedFightID:selection.fightID==='last'?fights[0].id:selection.fightID??fights[0].id};
}
export async function loadLog(url,{token,signal,onProgress=()=>{},fetcher=fetch,validateFight=()=>{},fightSummary}){
  const selection=parseReportURL(url);
  if(selection.fightID==='last')selection.fightID=(await loadReportFights(url,{token,signal,fetcher})).selectedFightID;
  const variables={code:selection.reportCode,fights:[selection.fightID]};
  const query=reportQuery({token,signal,fetcher});
  onProgress('Reading the selected run…');
  const report=await query(metadataQuery,variables),fight=report.fights?.find(f=>f.id===selection.fightID);
  if(!fight||!Number.isFinite(fight.startTime)||!Number.isFinite(fight.endTime)||fight.endTime<=fight.startTime)throw new Error('The selected fight is not a supported dungeon run.');
  if(fight.difficultyLevel==null&&fightSummary?.id===fight.id&&Number.isInteger(fightSummary.difficultyLevel))fight.difficultyLevel=fightSummary.difficultyLevel;
  if(fight.inProgress)throw new Error('This run is still in progress. Import it after the log is complete.');
  if(!fight.dungeonPulls?.length||!Array.isArray(report.masterData?.actors))throw new Error('The log is missing dungeon pulls or actor identities.');
  validateFight(fight);
  const events=[];let cursor=fight.startTime,complete=false;
  for(let page=0;page<100;page++){
    const result=await query(eventsQuery,{...variables,start:cursor,end:fight.endTime,filter:routeEventFilter});
    const stream=result.events;
    if(!Array.isArray(stream?.data)||!Object.hasOwn(stream,'nextPageTimestamp'))throw new Error('Incomplete event response; the route was not imported.');
    for(const event of stream.data)if(event.fight===fight.id&&isRouteEvent(event))events.push(compactRouteEvent(event));
    const next=stream.nextPageTimestamp;
    if(next!==null&&(!Number.isFinite(next)||next<=cursor||next>fight.endTime))throw new Error('Invalid event cursor; the route was not imported.');
    const percent=next===null?100:Math.min(99,Math.floor((next-fight.startTime)/(fight.endTime-fight.startTime)*100));
    onProgress(`Reading movement and encounters… ${events.length.toLocaleString('en-US')} events · page ${page+1} (${percent}%)`);
    if(stream.nextPageTimestamp===null){complete=true;break;}
    cursor=stream.nextPageTimestamp;
  }
  if(!complete)throw new Error('Event limit reached. The log is incomplete and was not imported.');
  if(!events.length)throw new Error('No route events were returned for this fight.');
  const ids=new Set(events.flatMap(e=>[e.sourceID,e.targetID,e.attackerID]).filter(id=>id>0));
  const actors=report.masterData.actors.filter(a=>ids.has(a.id));
  if([...ids].some(id=>!actors.some(a=>a.id===id)))throw new Error('Actor identities are incomplete; the route was not imported.');
  return {...selection,fight,actors,events,complete:true};
}
