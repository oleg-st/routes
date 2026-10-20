// Offline evidence report for the same detector used by live imports.
// Usage: node scripts/analyze-log-priority.mjs probe.json pack-evidence.json output.json
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {correctDungeon} from '../data/placement-corrections.js';
import {analyzePriorityTargets,MAX_PRIORITY_TARGETS_PER_PACK} from '../log-import/priority-targets.js';
const [input,evidenceFile,outputFile]=process.argv.slice(2);
if(!input||!evidenceFile||!outputFile)throw new Error('Usage: node scripts/analyze-log-priority.mjs probe.json pack-evidence.json output.json');
const read=f=>JSON.parse(fs.readFileSync(f));
const raw=read(input),evidence=read(evidenceFile);
const fight=raw.log?.fight??raw.report.fights.find(f=>f.id===raw.fightID);
const actors=raw.log?.actors??raw.masterData.actors;
const streams=[];const digests=new Set();
for(const stream of raw.eventStreams??[]){
  const hash=createHash('sha256');for(const page of stream.pages)for(const e of page.data)hash.update(JSON.stringify(e)+'\n');
  const digest=hash.digest('hex');if(!digests.has(digest)){digests.add(digest);streams.push(stream);}
}
const log={reportCode:raw.log?.reportCode??raw.reportCode,fight,actors,
  complete:raw.log?.complete??(raw.complete===true&&(raw.eventStreams??[]).every(s=>s.complete===true)),
  events:raw.log?.events??streams.flatMap(s=>s.pages.flatMap(p=>p.data)).filter(e=>e.fight===fight.id)};
if(evidence.reportCode&&evidence.reportCode!==log.reportCode||evidence.fightID&&evidence.fightID!==fight.id)throw new Error('Pack evidence belongs to another fight.');
const catalog=new Map(read('data/enemies.json').map(e=>[e.id,e]));
const dungeon=correctDungeon(read('data/dungeons.json').find(d=>d.name===fight.name));
const placements=new Map(dungeon.enemies.map(p=>[p.placementId,p]));
const packNumbers=new Map([...new Set(dungeon.enemies.map(p=>p.packId))].map((id,i)=>[id,`G${i+1}`]));
const variants=evidence.strict?.causal?.variants?.map(v=>v.assignments)??evidence.globals?.map(v=>v.pulls.flatMap(p=>p.assignments));
if(!variants?.length)throw new Error('No pack assignment variants in evidence.');
const actorByID=new Map(actors.map(a=>[a.id,a]));
const chickenKeys=new Set(log.events.filter(e=>e.type==='cast'&&e.abilityGameID===1478).map(e=>`${e.targetID}:${e.targetInstance??1}`));
const hypotheses=variants.map((assignments,index)=>{
  const groups=new Map();
  for(const a of assignments){
    const pos=placements.get(a.placementId);if(!pos||a.inferred||a.key.startsWith('unobserved:')||chickenKeys.has(a.key))continue;
    if(!groups.has(pos.packId))groups.set(pos.packId,{id:pos.packId,label:packNumbers.get(pos.packId),mobKeys:[],placements:{},boss:false});
    const group=groups.get(pos.packId);group.mobKeys.push(a.key);group.placements[a.key]=a.placementId;group.boss||=catalog.get(pos.id)?.isBoss===true;
  }
  const analysis=analyzePriorityTargets(log,[...groups.values()]);
  const rows=analysis.results.map(r=>({...r,pack:groups.get(r.groupId).label,
    name:actorByID.get(Number(r.key.split(':')[0]))?.name??catalog.get(placements.get(groups.get(r.groupId).placements[r.key]).id)?.name,
    placementId:groups.get(r.groupId).placements[r.key],
    startSeconds:(r.start-fight.startTime)/1000,endSeconds:(r.end-fight.startTime)/1000,
    survivors:r.survivors.map(s=>({...s,name:actorByID.get(Number(s.key.split(':')[0]))?.name})),
    windows:r.windows.map(w=>({...w,startSeconds:(w.start-fight.startTime)/1000,endSeconds:(w.end-fight.startTime)/1000}))}));
  return {index,groupCount:groups.size,candidates:rows.filter(r=>r.candidate),rows};
});
const first=hypotheses[0];
for(const row of first.rows){
  const alternatives=hypotheses.map(h=>h.rows.find(r=>r.key===row.key));
  row.samePackAcrossVariants=alternatives.every(r=>r?.groupId===row.groupId);
  row.candidateAcrossVariants=alternatives.every(r=>r?.candidate);
  row.samePlacementAcrossVariants=alternatives.every(r=>r?.placementId===row.placementId);
}
const bossRows=first.rows.filter(r=>r.reasons.includes('boss-encounter'));
const thresholds=analyzePriorityTargets(log,[]).thresholds;
// Recompute sequential selection from the individual criteria rather than
// reusing the detector's final candidate/cap flags. HP is diagnostic only.
function priorityFunnel(rows){
  const summarize=r=>({key:r.key,name:r.name,pack:r.pack,initialShare:r.initial.share,
    share:r.share,lead:r.lead,sustained:r.sustained,startSeconds:r.startSeconds,endSeconds:r.endSeconds});
  let remaining=[...rows];const stages=[];
  const apply=(id,label,accept)=>{
    const before=remaining.length,removed=remaining.filter(r=>!accept(r));remaining=remaining.filter(accept);
    stages.push({id,label,before,dropped:removed.length,after:remaining.length,
      removed:removed.map(summarize),remaining:remaining.map(summarize)});
  };
  const without=(...reasons)=>r=>!r.reasons.some(reason=>reasons.includes(reason));
  apply('multi','At least two mobs in the pack',without('single-mob'));
  apply('boss','Exclude boss packs',without('boss-encounter'));
  apply('data','Complete damage and pack-matching evidence',without('incomplete-log','incomplete-pack','missing-damage-amounts','no-damage-window'));
  apply('opening',`First ${thresholds.initialWindowMs/1000} seconds: share >=55%, lead >=2x`,without('no-initial-focus'));
  apply('share','Whole lifetime: share >=55%',without('low-share'));
  apply('lead','Whole lifetime: lead >=3x',without('low-lead'));
  apply('sustained','Sustained focus and final window',without('late-or-inconsistent-focus','focus-lost-before-death'));
  apply('players','At least two contributing players, including opening',without('no-initial-party-focus','not-shared-by-players'));
  apply('survivor','Another mob survives at least 1.5 seconds',without('no-surviving-alternative'));
  const selected=new Set([...Map.groupBy(remaining,r=>r.groupId).values()].flatMap(rs=>rs.toSorted((a,b)=>a.start-b.start||b.share-a.share||a.end-b.end).slice(0,MAX_PRIORITY_TARGETS_PER_PACK)));
  apply('cap',`At most ${MAX_PRIORITY_TARGETS_PER_PACK} target per pack`,r=>selected.has(r));
  return {input:rows.length,stages,final:remaining.map(summarize)};
}
const funnel=priorityFunnel(first.rows);
const output={status:'offline-priority-evidence',reportCode:log.reportCode,fightID:fight.id,dungeon:dungeon.name,
  source:input,packEvidence:evidenceFile,complete:log.complete,events:log.events.length,duplicateStreamsRemoved:(raw.eventStreams?.length??0)-streams.length,
  thresholds,assignmentVariants:hypotheses.length,
  mappedAssignments:variants[0].length,chickenExcluded:variants[0].filter(a=>chickenKeys.has(a.key)).map(a=>({key:a.key,name:a.name})),funnel,
  limitations:['Pack assignments come from supplied matching hypotheses, not verified log spawn IDs.',
    'This offline report does not change routes. Thresholds are provisional; this sample has no manually labelled ground truth.',
    'Boss packs and missing damage amounts cannot qualify. API pull boundaries are ignored; survivor HP is diagnostic only.'],
  candidates:first.candidates,bossControls:bossRows,rows:first.rows,
  variantCandidates:hypotheses.map(h=>({index:h.index,keys:h.candidates.map(r=>r.key)}))};
fs.mkdirSync(path.dirname(path.resolve(outputFile)),{recursive:true});
fs.writeFileSync(outputFile,JSON.stringify(output,(_key,v)=>typeof v==='number'&&!Number.isFinite(v)?null:v,2)+'\n');
console.log(JSON.stringify({reportCode:output.reportCode,fightID:fight.id,dungeon:dungeon.name,variants:output.assignmentVariants,
  funnel:funnel.stages.map(({id,before,dropped,after})=>({id,before,dropped,after})),
  candidates:output.candidates.map(r=>({pack:r.pack,name:r.name,key:r.key,share:r.share,lead:r.lead,sustained:r.sustained,
    supportingPlayers:r.perPlayer.filter(p=>p.supports).map(p=>p.class),samePlacement:r.samePlacementAcrossVariants})),
  close:output.rows.filter(r=>r.share>=.4&&r.lead>=2.5).map(r=>({pack:r.pack,name:r.name,key:r.key,share:r.share,lead:r.lead,sustained:r.sustained,reasons:r.reasons})),
  bossControls:bossRows.map(r=>({pack:r.pack,name:r.name,share:r.share,reasons:r.reasons}))},null,2));
