// Offline regression runner. Keeps duplicate saved runs and visits subdirectories.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {analyzeRouteEvents} from '../log-import/live-analysis.js';
import {encounterIdentity} from '../log-import/boss-encounters.js';
import {compactRouteEvent,isRouteEvent} from '../log-import/live-api.js';
import {correctDungeon} from '../data/placement-corrections.js';

const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const root=arg('logs','private/logs'),output=arg('output','tmp/summon-game-rules/after.json');
const engine=arg('engine');
const {classifySummons,matchLiveLog}=engine?await import(pathToFileURL(path.resolve(engine))):
  {...await import('../log-import/summon-evidence.js'),...await import('../log-import/live-matcher.js')};
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)??'null').digest('hex');
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const presets=JSON.parse(fs.readFileSync('data/modifier-placements.json'));
const npcNames=fs.existsSync('private/reports/game-summon-rules.json')?JSON.parse(fs.readFileSync('private/reports/game-summon-rules.json')).npcNames??{}:{};
const previous=arg('compare')?JSON.parse(fs.readFileSync(arg('compare'))):null;
const results=[];
for(const file of fs.readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.json')).sort()){
  const filename=file.replaceAll('\\','/'),bytes=fs.readFileSync(path.join(root,file)),saved=JSON.parse(bytes);
  const base={file:filename,inputHash:hash(bytes.toString())};
  let log=saved.log,options;
  if(!log){
    const stream=saved.eventStreams?.find(s=>s.hostility==='Friendlies')??saved.eventStreams?.[0];
    if(!stream){results.push({...base,status:'skipped',reason:'Metadata only; no events or actor identities'});continue;}
    // The live API uses one Friendlies/All stream. Do not concatenate the
    // equivalent Enemies stream or deduplicate legitimate equal-time events.
    const fight=saved.report?.fights?.find(f=>f.id===saved.fightID);
    log={reportCode:saved.reportCode,complete:stream.complete&&saved.complete,fight,actors:saved.masterData?.actors,
      events:stream.pages.flatMap(p=>p.data).filter(e=>e.fight===fight?.id&&isRouteEvent(e)).map(compactRouteEvent)};
    base.stream=stream.hostility;
  }
  if(!log.fight||!Array.isArray(log.actors)||!Array.isArray(log.events))throw Error('Unsupported log: '+filename);
  if(saved.matching){options={...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e]))};base.geometry='saved';}
  else{
    const dungeon=correctDungeon(dungeons.find(d=>d.name===log.fight.name));
    options={dungeon,catalog,presets:presets.dungeons[dungeon.id],dungeonData:'custom'};base.geometry='current';
  }
  const {npcRows}=analyzeRouteEvents(log,options.dungeon,options.catalog,encounterIdentity(log,options.dungeon));
  const byKey=new Map(npcRows.map(r=>[r.key,r]));
  const summons=classifySummons({fightID:log.fight.id,actors:log.actors,rows:npcRows,events:log.events}).map(s=>{
    const r=byKey.get(s.key);return {...s,gameID:r.gameID,name:options.catalog.values().find(e=>e.gameId===r.gameID)?.name??npcNames[r.gameID]??r.name,
      firstTime:r.firstTime,staticDistance:r.nearest?.[0]?.distance};
  }).sort((a,b)=>a.key.localeCompare(b.key));
  let route;
  try{
    const result=await matchLiveLog(log,options);
    route={status:'matched',hash:hash(result),variants:result.variants.length,pulls:result.variants.map(v=>v.pulls.length),
      placements:[...new Set(Object.values(result.groups).flatMap(g=>g.enemies))].sort()};
  }catch(error){route={status:'failed',error:error.message,diagnostics:error.diagnostics};}
  const row={...base,status:'replayed',fight:log.fight.id,dungeon:log.fight.name,events:log.events.length,npcs:npcRows.length,summons,route};
  if(previous){
    const old=previous.results.find(r=>r.file===filename);
    if(!old||old.inputHash!==row.inputHash)throw Error('Missing/changed baseline input: '+filename);
    const before=new Map(old.summons.map(s=>[s.key,s])),after=new Map(summons.map(s=>[s.key,s]));
    const evidence=({name,gameID,firstTime,staticDistance,...s})=>s;
    row.changes={added:summons.filter(s=>!before.has(s.key)),removed:old.summons.filter(s=>!after.has(s.key)),
      evidence:summons.filter(s=>before.has(s.key)&&hash(evidence(s))!==hash(evidence(before.get(s.key)))).map(s=>({before:before.get(s.key),after:s})),
      routeChanged:route.status!==old.route.status||route.hash!==old.route.hash||route.error!==old.route.error||hash(route.diagnostics)!==hash(old.route.diagnostics),beforeRoute:old.route};
  }
  results.push(row);
  console.log(`${filename}: ${summons.length} summons, ${route.status}${row.changes?`, +${row.changes.added.length}/-${row.changes.removed.length}, route ${row.changes.routeChanged?'changed':'same'}`:''}`);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
}
const report={summary:{files:results.length,replayed:results.filter(r=>r.status==='replayed').length,skipped:results.filter(r=>r.status==='skipped').length,
  matched:results.filter(r=>r.route?.status==='matched').length,failed:results.filter(r=>r.route?.status==='failed').length,
  summons:results.reduce((n,r)=>n+(r.summons?.length??0),0),
  ...(previous?{added:results.reduce((n,r)=>n+(r.changes?.added.length??0),0),removed:results.reduce((n,r)=>n+(r.changes?.removed.length??0),0),
    routesChanged:results.filter(r=>r.changes?.routeChanged).length}:{} )},results};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
