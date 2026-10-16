import {analyzeRouteEvents,routeHealthEvidence,interpolatePlayerPositions} from './live-analysis.js';
import {correctImportPacks} from './pack-corrections.js';
import {placementDistance} from './placement-geometry.js';
import {minimumAssignment} from './assignment.js';
import {solveCompletePacks} from './pack-solver.js';
import {createApproachFilter} from './approach-filter.js';
import {reverseApproachEvidence,scoreReverseApproach,compareReverseRank} from './reverse-approach.js';
import {classifySummons} from './summon-evidence.js';
import {modifierEvidence,createEmpoweredConstraint} from './modifier-evidence.js';
import {extractInvisibility,createVisibilityIndex} from './invisibility.js';
import {extractPortals} from './portals.js';
import {bossIntervals,outsideBossCombat,deduplicateRelicUsages} from './route-relics.js';
import {firstEngagements} from './intended-pulls.js';
import {matchingConfig} from './matching-config.js';
import {createPathProximity,combineProximity} from './path-proximity.js';
import {createGapApproach} from './gap-approach.js';
import {mapViews,mapCoordinates} from '../map-views.js';

const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
export async function matchLiveLog(log,{dungeon,catalog,presets,dungeonData,signal,onProgress=()=>{},config=matchingConfig,adaptiveRadius=false}){
  if(!log.complete)throw new Error('Incomplete log; no route was created.');
  const {fight,actors,events}=log;
  onProgress('Matching enemies to the selected dungeon data…');await yieldUI();signal?.throwIfAborted();
  const {npcRows,trajectories}=analyzeRouteEvents(log,dungeon,catalog);
  const affixes=modifierEvidence(fight,actors,events),health=routeHealthEvidence(npcRows);
  const empoweredCompatible=createEmpoweredConstraint({...affixes.empowered,empoweredPlacements:presets?.empowered??[],healthEvidence:health});
  const removed=new Set(['ghorn','witch'].flatMap(k=>affixes[k].active?presets?.[k]?.replacedEnemies??[]:[]));
  const packs=correctImportPacks([...Map.groupBy(dungeon.enemies,p=>p.packId)].map(([id,all],i)=>{
    const placements=all.filter(p=>!removed.has(p.placementId));
    return {id,number:`G${i+1}`,placements,counts:Object.fromEntries([...Map.groupBy(placements,p=>catalog.get(p.id).gameId)].map(([t,ps])=>[t,ps.length]))};
  }).filter(p=>p.placements.length),{dungeonID:dungeon.id,catalog,dungeonData});
  const packByID=new Map(packs.map(p=>[p.id,p])),packByPlacement=new Map(packs.flatMap(p=>p.placements.map(m=>[m.placementId,p])));
  const staticTypes=new Set(packs.flatMap(p=>Object.keys(p.counts).map(Number)));
  const summons=new Set(classifySummons({fightID:fight.id,actors,rows:npcRows,events}).map(r=>r.key));
  const chickenCasts=events.filter(e=>e.type==='cast'&&e.abilityGameID===1478);
  const chickenKeys=new Set(chickenCasts.map(e=>`${e.targetID}:${e.targetInstance??1}`));
  let rows=npcRows.filter(r=>staticTypes.has(r.gameID)&&!summons.has(r.key));
  // Replacement geometry is a hint; original identity always comes from the cast.
  rows=rows.map(r=>{
    if(r.firstPosition||!chickenKeys.has(r.key))return r;
    const cast=chickenCasts.find(e=>`${e.targetID}:${e.targetInstance??1}`===r.key);
    const nextCast=chickenCasts.find(e=>e.timestamp>cast.timestamp)?.timestamp??Infinity;
    const chickens=npcRows.filter(c=>[277,278].includes(c.gameID)&&c.firstTime>=cast.timestamp&&c.firstTime<Math.min(nextCast,cast.timestamp+5000));
    return {...r,firstTime:cast.timestamp,firstPosition:chickens.length===1?chickens[0].firstPosition:undefined};
  });
  if(chickenCasts.some(c=>!rows.some(r=>r.key===`${c.targetID}:${c.targetInstance??1}`)))throw new Error('A Chicken target could not be identified. The route needs manual analysis.');
  if(!rows.length)throw new Error('No enemies could be matched to this dungeon.');
  const players=actors.filter(a=>a.type==='Player'),actorByID=new Map(actors.map(a=>[a.id,a]));
  const invisible=extractInvisibility(events,{fightID:fight.id,players,complete:true}),visibility=createVisibilityIndex(invisible.intervals);
  const combat=new Set(['damage','cast','begincast','death']);
  const observations=trajectories.flatMap(row=>{
    const activeSince=row.positions.find(p=>combat.has(p.eventType))?.t,deathTime=row.deaths[0]?.timestamp??Infinity;
    return row.positions.filter(p=>row.type==='Player'?p.hp>0:Number.isFinite(activeSince)&&p.t>=activeSince&&p.t<=deathTime).map(p=>({
      x:p.y,y:p.x,hp:p.hp,t:p.t,key:row.key,type:row.type,activeSince,deathTime,visibility:row.type==='Player'?visibility.stateAt(row.actorID,p.t):undefined}));
  });
  observations.push(...interpolatePlayerPositions(trajectories,rows.map(r=>r.firstTime),{visibility,mapChanges:events.filter(e=>e.type==='mapchange')}));
  const anchor=r=>r.nearest[0]?.distance<2&&(!r.nearest[1]||r.nearest[1].distance>=2)?r.nearest[0].placementId:null;
  const anchors=Map.groupBy(rows.filter(anchor),r=>packByPlacement.get(anchor(r))?.id);
  const attacks=events.filter(e=>['cast','damage'].includes(e.type)&&e.abilityGameID!==1002109&&actorByID.get(e.sourceID)?.type==='Player'&&actorByID.get(e.targetID)?.type==='NPC'&&Number.isFinite(e.sourceResources?.x)&&Number.isFinite(e.sourceResources?.y))
    .map(e=>({x:e.sourceResources.y,y:e.sourceResources.x,t:e.timestamp,key:`${e.sourceID}:1`,targetKey:`${e.targetID}:${e.targetInstance??1}`,abilityGameID:e.abilityGameID,range:config.attackRange}));
  const radiusAttempts=[];
  const step=config.aggroRadiusStep??matchingConfig.aggroRadiusStep;
  const maximum=adaptiveRadius?Math.max(config.aggroRadius,config.maxAggroRadius??matchingConfig.maxAggroRadius):config.aggroRadius;
  if(!Number.isFinite(step)||step<=0||!Number.isFinite(maximum)||!Number.isFinite(config.aggroRadius)||config.aggroRadius<0)throw new Error('Invalid matching radius configuration.');
  const forward=createApproachFilter({packs:packs.map(p=>({...p,memberKeys:(anchors.get(p.id)??[]).map(r=>r.key)})),observations,attacks,
    playerRadius:config.aggroRadius,chainRadius:config.aggroRadius,buriedRadius:config.buriedRadius,maxPlayerRadius:maximum,maxChainRadius:maximum});
  let gapApproach;
  for(let radius=config.aggroRadius;radius<=maximum;radius+=step){
    signal?.throwIfAborted();
    onProgress(`Matching packs with approach radius ${radius}…`);await yieldUI();
    try{
      let result;
      try{result=await matchAtRadius({...config,aggroRadius:radius});}
      catch(error){
        if(error.diagnostics?.code!=='no-compatible-route'||error.diagnostics.counts.some(c=>c.observed>c.available))throw error;
        gapApproach??=createGapApproach({packs,trajectories,events,invisibility:invisible.intervals});
        onProgress('Checking possible movement through gaps in the log…');
        result=await matchAtRadius({...config,aggroRadius:radius},true);
      }
      return {...result,matching:{aggroRadius:radius,buriedRadius:config.buriedRadius,attackRange:config.attackRange,
        radiusAttempts:[...radiusAttempts,{radius,matched:true}]}};
    }catch(error){
      if(error.diagnostics?.code!=='no-compatible-route')throw error;
      radiusAttempts.push({radius,matched:false});
      error.diagnostics={...error.diagnostics,aggroRadius:radius,radiusAttempts:[...radiusAttempts]};
      // More recorded instances than map placements cannot be fixed by proximity.
      if(error.diagnostics.counts.some(c=>c.observed>c.available)||radius+step>maximum)throw error;
    }
  }

  // Event analysis and summon/visibility classification are shared by all attempts.
  // Stop at the first successful radius; never merge wider, weaker candidates.
  async function matchAtRadius(config,allowGaps=false){
  const reverse=reverseApproachEvidence({packs,observations,radius:config.aggroRadius,startTime:fight.startTime,endTime:fight.endTime,
    buriedRadius:config.buriedRadius,removedPlacementIDs:[...removed],engagedAt:new Map([...anchors].map(([id,rs])=>[id,Math.min(...rs.map(r=>r.firstTime))]))});
  await yieldUI();signal?.throwIfAborted();
  const allPlacements=packs.flatMap(p=>p.placements),byType=Map.groupBy(allPlacements,p=>catalog.get(p.id).gameId);
  const pair=new Map();
  for(const r of rows)for(const p of byType.get(r.gameID)??[]){
    const support=forward.check(p.packId,r.firstTime,r.key,{playerRadius:config.aggroRadius,chainRadius:config.aggroRadius}),identity=anchor(r)===p.placementId||byType.get(r.gameID).length===1&&catalog.get(p.id).isBoss;
    const reasons=[];
    if(anchor(r)&&anchor(r)!==p.placementId)reasons.push('different-spawn-position');
    if(!empoweredCompatible(r.key,p.placementId))reasons.push('empowered-mismatch');
    const gap=!support.supported&&!identity&&allowGaps?gapApproach(p.packId,r.firstTime,config.aggroRadius):null;
    if(!support.supported&&!identity&&!gap)reasons.push(support.reason);
    pair.set(`${r.key}|${p.placementId}`,{allowed:!reasons.length,reasons,gap,
      distance:r.firstPosition?placementDistance({x:r.firstPosition.y,y:r.firstPosition.x},p).distance:0});
  }
  const rowsByType=Map.groupBy(rows,r=>r.gameID),requiredIDs=[...new Set(rows.filter(anchor).map(r=>packByPlacement.get(anchor(r))?.id).filter(Boolean))];
  onProgress('Checking complete pack combinations…');await yieldUI();signal?.throwIfAborted();
  const candidates=[],attempts=[];let closestRejected=null;
  // One missing sibling is the existing intended-route hypothesis, never a
  // silently invented whole pack. It requires explicit review in the UI.
  for(const missingBudget of [0,1]){
  const feasible=packs.filter(pack=>[...Map.groupBy(pack.placements,p=>catalog.get(p.id).gameId)].every(([type,ps])=>{
    const rs=rowsByType.get(type)??[];
    return rs.length+missingBudget>=ps.length&&minimumAssignment(ps.map(p=>[...rs.map(r=>pair.get(`${r.key}|${p.placementId}`).allowed?0:1),...Array(missingBudget).fill(0)])).cost===0;
  }));
  const attempt={missingBudget,feasiblePacks:feasible.map(p=>p.id),infeasibleRequiredPacks:requiredIDs.filter(id=>!feasible.some(p=>p.id===id))};attempts.push(attempt);
  if(attempt.infeasibleRequiredPacks.length)continue;
  const enumeration=solveCompletePacks(feasible,Object.fromEntries([...rowsByType].map(([t,rs])=>[t,rs.length])),{requiredIDs,wildcards:missingBudget,maxSolutions:20000,maxNodes:1000000});
  if(!enumeration.exhaustive)throw new Error('Too many pack combinations to check completely. No route was created.');
  attempt.combinations=enumeration.solutions.length;
  for(let index=0;index<enumeration.solutions.length;index++){
    if(index%100===0){await yieldUI();signal?.throwIfAborted();}
    const s=enumeration.solutions[index],placements=s.packIDs.flatMap(id=>packByID.get(id).placements),assignments=[];let valid=true,score=0;
    for(const [type,rs]of rowsByType){
      const ps=placements.filter(p=>catalog.get(p.id).gameId===type);
      const result=minimumAssignment(rs.map(r=>ps.map(p=>{const e=pair.get(`${r.key}|${p.placementId}`);return e.allowed?e.distance+(e.gap?1e9:0):1e12;})));
      result.columns.forEach((col,i)=>{const r=rs[i],p=ps[col],e=pair.get(`${r.key}|${p.placementId}`);valid&&=e.allowed;score+=e.distance;assignments.push({key:r.key,placementId:p.placementId,firstTime:r.firstTime,...(e.gap?{gap:e.gap}:{})});});
    }
    if(missingBudget){
      const matched=new Set(assignments.map(a=>a.placementId));
      for(const p of placements.filter(p=>!matched.has(p.placementId))){
        const siblings=assignments.filter(a=>!a.inferred&&packByPlacement.get(a.placementId).id===p.packId);
        if(!siblings.length){valid=false;continue;}
        assignments.push({key:`unobserved:${p.placementId}`,placementId:p.placementId,firstTime:Math.min(...siblings.map(a=>a.firstTime)),inferred:true});
      }
    }
    if(valid)candidates.push({...s,score,assignments,reverse:scoreReverseApproach(reverse,s.packIDs)});
    else{
      const rejected=assignments.filter(a=>!a.inferred&&!pair.get(`${a.key}|${a.placementId}`).allowed);
      if(!closestRejected||rejected.length<closestRejected.length)closestRejected=rejected.map(a=>({...a,...pair.get(`${a.key}|${a.placementId}`)}));
    }
  }
  if(candidates.length)break;
  }
  if(!candidates.length){
    const unmatched=rows.filter(r=>!(byType.get(r.gameID)??[]).some(p=>pair.get(`${r.key}|${p.placementId}`).allowed));
    const counts=[...rowsByType].map(([gameID,rs])=>({gameID,name:rs[0].name,observed:rs.length,available:byType.get(gameID)?.length??0}));
    const excess=counts.filter(c=>c.observed>c.available);
    const detail=excess.length?`The log contains more instances than the map for: ${excess.map(c=>`${c.name} (${c.observed} in log, ${c.available} on map)`).join('; ')}.`:
      unmatched.length?`${unmatched.length} of ${rows.length} enemies have no compatible map position under the current movement and empowered checks.`:
      'Individual enemies have possible matches, but their counts and pack membership do not form a complete route.';
    const error=new Error(`Could not match this run. ${detail} Download import diagnostics to investigate.`);
    const infeasibleRequired=[...new Set(attempts.flatMap(a=>a.infeasibleRequiredPacks))].map(id=>({id,placements:packByID.get(id).placements.map(p=>({id:p.placementId,name:catalog.get(p.id).name,
      compatibleRows:rows.filter(r=>pair.get(`${r.key}|${p.placementId}`)?.allowed).map(r=>r.key)}))}));
    const rejectedPacks=packs.filter(p=>!attempts[0].feasiblePacks.includes(p.id)).map(pack=>({id:pack.id,number:pack.number,placements:pack.placements.map(p=>({placementId:p.placementId,name:catalog.get(p.id).name,
      nearestRows:(rowsByType.get(catalog.get(p.id).gameId)??[]).map(r=>({key:r.key,...pair.get(`${r.key}|${p.placementId}`)})).sort((a,b)=>a.distance-b.distance).slice(0,3)}))}));
    error.diagnostics={code:'no-compatible-route',counts,attempts,closestRejected,infeasibleRequired,rejectedPacks,unmatched:unmatched.map(r=>({key:r.key,name:r.name,gameID:r.gameID,firstTime:r.firstTime,
      placements:(byType.get(r.gameID)??[]).map(p=>({placementId:p.placementId,packId:p.packId,...pair.get(`${r.key}|${p.placementId}`)}))}))};
    throw error;
  }
  if(candidates.length>100)throw new Error('More than 100 compatible routes remain. Manual analysis is needed before importing.');
  const gapCount=c=>new Set(c.assignments.filter(a=>a.gap).map(a=>packByPlacement.get(a.placementId).id)).size;
  candidates.sort((a,b)=>gapCount(a)-gapCount(b)||compareReverseRank(a,b));
  const inferredPlacements=[...new Set(candidates.flatMap(c=>c.assignments.filter(a=>a.inferred).map(a=>a.placementId)))];
  const movementHypotheses=[...new Map(candidates.flatMap(c=>c.assignments.filter(a=>a.gap).map(a=>[`${a.placementId}|${a.gap.key}|${a.gap.start}`,{placementId:a.placementId,pack:packByPlacement.get(a.placementId).number,...a.gap}]))).values()];
  const assumption=[inferredPlacements.length?'Each candidate includes one unobserved pack member by the whole-pack rule. It may instead be absent or replaced; choose only if you accept this intended-route hypothesis.':null,
    movementHypotheses.length?`Possible approach to ${[...new Set(movementHypotheses.map(h=>h.pack))].join(', ')} is estimated across gaps in the log. The actual path is unknown; review this movement hypothesis before accepting.`:null].filter(Boolean).join(' ')||null;
  const groups={},variants=[],first=firstEngagements(events,{fightID:fight.id,actors});
  const pathProximity=createPathProximity(packs,observations);
  const empoweredKeys=new Set([...affixes.empowered.confirmedInstances.map(r=>r.key),...health.filter(r=>r.empoweredCandidate).map(r=>r.key)]);
  for(const candidate of candidates){
    const proximity={};
    const pulls=fight.dungeonPulls.map(p=>({id:`segment-${p.id}`,start:(p.startTime-fight.startTime)/1000,end:(p.endTime-fight.startTime)/1000,groups:[]}));
    for(const [pack,as]of Map.groupBy(candidate.assignments,a=>packByPlacement.get(a.placementId))){
      const members=as.map(a=>a.placementId).sort(),excluded=as.filter(a=>chickenKeys.has(a.key)).map(a=>a.placementId).sort(),empowered=as.filter(a=>empoweredKeys.has(a.key)).map(a=>a.placementId).sort();
      const time=Math.min(...as.map(a=>first.get(a.key)??a.firstTime));
      const segment=Math.max(0,fight.dungeonPulls.findLastIndex(p=>p.startTime<=time));
      const identity=JSON.stringify([members,excluded,empowered]);
      let id=Object.keys(groups).find(id=>groups[id].identity===identity);
      if(!id){id=`group-${Object.keys(groups).length}`;groups[id]={id,identity,label:pack.number,enemies:members,excluded,empowered};}
      proximity[id]=pathProximity(pack.id,time);
      const gap=as.filter(a=>a.gap).sort((a,b)=>a.gap.distance-b.gap.distance)[0]?.gap;
      if(gap)proximity[id]={minDistance:gap.distance,maxDistance:gap.distance,sources:[gap.source],patrol:gap.patrol,estimated:true};
      pulls[segment].groups.push(id);
    }
    for(const kind of ['ghorn','witch'])if(affixes[kind].active){
      const npc=npcRows.find(r=>r.gameID===affixes[kind].gameID),id=`modifier:${kind}`;
      const segment=Math.max(0,fight.dungeonPulls.findLastIndex(p=>p.startTime<=npc.firstTime));
      groups[id]={id,label:kind==='ghorn'?'Ghorn':'Witch',enemies:[id],excluded:[],empowered:[]};pulls[segment].groups.push(id);
    }
    pulls.forEach(p=>p.groups.sort());
    const duplicate=variants.find(v=>JSON.stringify(v.pulls)===JSON.stringify(pulls));
    if(duplicate){for(const id of Object.keys(proximity))duplicate.proximity[id]=combineProximity([duplicate.proximity[id],proximity[id]]);}
    else variants.push({pulls,proximity});
  }
  const kept=variants[0].pulls.map((_,i)=>i).filter(i=>variants.some(v=>v.pulls[i].groups.length));
  for(const v of variants)v.pulls=kept.map((i,n)=>({...v.pulls[i],label:`Pull ${n+1}`}));
  for(const g of Object.values(groups))delete g.identity;
  const portals=extractPortals(events,{fightID:fight.id,players,endTime:fight.endTime});
  const intervals=bossIntervals(events,fight.id,fight.endTime),view=mapViews(dungeon)[0];
  const usages=deduplicateRelicUsages([...invisible.usages.map(u=>({...u,kind:'invis'})),...portals.usages].filter(u=>outsideBossCombat(u,intervals)));
  const drawings=usages.map((u,i)=>({id:`log-${u.kind}-${i}`,mapId:view.id,kind:u.kind,color:u.kind==='portal'?'#70d9ff':'#bb86fc',
    points:[u.start,u.end].map(b=>{
      const change=events.filter(e=>e.type==='mapchange'&&e.timestamp<=b.time).at(-1);
      const map=dungeon.mapImages.find(m=>m.name===(change?.mapName??'Start'))??dungeon.mapImages[0];
      return mapCoordinates({worldPosition:{x:b.position.y,y:b.position.x},mapImageId:map.id,mapPosition:{x:0,y:0}},view);
    }),afterTime:(u.end.time-fight.startTime)/1000}));
  return {id:`${log.reportCode}-${fight.id}`,live:true,assumption,inferredPlacements,movementHypotheses,dungeonData,title:dungeon.name,dungeonID:dungeon.id,reportCode:log.reportCode,fightID:fight.id,
    duration:Math.round((fight.endTime-fight.startTime)/1000),groups,variants,drawings,shadow:affixes.shadowlord.active===true,empowered:affixes.empowered.active===true,
    replacement:Object.fromEntries(['ghorn','witch'].map(k=>[k,{active:affixes[k].active===true}])),
    note:'Matched from the selected log using current dungeon data. Whole packs stay in their first pull; repeated attempts are omitted.'};
  }
}
