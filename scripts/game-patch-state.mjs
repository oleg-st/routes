// Patch snapshots contain private source data and must stay outside published data/.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {actorGuids} from './game-source-identity.mjs';
import {readDifficultyTables} from './game-difficulty-source.mjs';

export const sha=value=>createHash('sha256').update(value).digest('hex');
export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function diffRecords(before,after){
  const added=[],removed=[],changed=[];
  for(const key of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()){
    if(!(key in before))added.push(key);
    else if(!(key in after))removed.push(key);
    else if(!equal(before[key],after[key]))changed.push(key);
  }
  return {added,removed,changed};
}
// Texture exports have their own manifest; the general asset manifest only
// lists their references. Include raw pixels as well as decoded PNGs (HDR
// textures intentionally have no PNG) so artwork-only changes are visible.
export function captureTextureState(root,build){
  const directory=path.join(root,'private/game-data/planner');
  const read=file=>JSON.parse(fs.readFileSync(path.join(directory,file)));
  const manifest=read('textures-manifest.json'),images=read('images.json');
  for(const source of [manifest,images])if(String(source.steamBuild)!==String(build))throw Error('Mixed texture builds');
  const decoded=new Map();
  for(const image of images.images){
    const key=image.source.toLowerCase();
    if(decoded.has(key))throw Error('Duplicate decoded texture: '+key);
    decoded.set(key,image);
  }
  const textures={};
  const verify=(file,expected)=>{
    const bytes=fs.readFileSync(path.join(directory,file));
    if(!expected||sha(bytes)!==expected)throw Error('Texture hash mismatch: '+file);
    return bytes;
  };
  for(const result of manifest.results){
    const key=result.Source.toLowerCase();
    if(key in textures)throw Error('Duplicate texture export: '+key);
    if(!result.Output||result.Error||result.Diagnostics?.length)throw Error('Incomplete texture export: '+key);
    const metadata=JSON.parse(verify(result.Output,result.Sha256)),image=decoded.get(key);
    if(!image||metadata.Source.toLowerCase()!==key)throw Error('Missing/mismatched texture image: '+key);
    verify(path.join(path.dirname(result.Output),metadata.BulkFile),metadata.BulkSha256);
    if(image.output){
      verify(image.output,image.sha256);
      if(image.metadataSha256!==result.Sha256)throw Error('Stale decoded texture: '+key);
    }else if(image.status!=='raw-hdr')throw Error('Missing decoded texture: '+key);
    textures[key]={metadataSha256:result.Sha256,bulkSha256:metadata.BulkSha256,
      imageSha256:image.output?image.sha256:null,width:metadata.Width,height:metadata.Height,pixelFormat:metadata.PixelFormat};
  }
  for(const key of decoded.keys())if(!(key in textures))throw Error('Unregistered decoded texture: '+key);
  return textures;
}
export function captureGameState(root='.'){
  const issues=[],read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  function attempt(label,fn,fallback={}){try{return fn();}catch(e){issues.push(label+': '+e.message);return fallback;}}
  const planner='private/game-data/planner',actorsRoot='private/game-data/all-dungeons';
  const manifest=read(planner+'/manifest.json'),registry=read(planner+'/dungeons.json');
  const build=String(manifest.steamBuild),sources={};
  const textures=attempt('textures',()=>captureTextureState(root,build));
  const checkBuild=(label,data)=>{if(String(data.steamBuild)!==build)issues.push('Mixed builds: '+label+' = '+data.steamBuild+'; expected '+build);};
  checkBuild('dungeon registry',registry);
  checkBuild('actor registry',read(actorsRoot+'/dungeon-registry.json'));
  checkBuild('actor summary',read(actorsRoot+'/summary.json'));
  const coverage=read(planner+'/coverage.json');checkBuild('catalog coverage',coverage);
  if(coverage.coverage?.some(d=>d.missing.length)||coverage.unresolvedTemplates?.length)issues.push('Catalog coverage has gaps');
  for(const r of manifest.results){
    const key=r.Source.toLowerCase();
    if(key in sources)issues.push('Duplicate export: '+r.Source);
    sources[key]=r.Sha256;
    attempt(r.Source,()=>{
      if(r.Error||r.Diagnostics?.length||!r.Output)throw Error('Incomplete export');
      if(sha(fs.readFileSync(path.join(root,planner,r.Output)))!==r.Sha256)throw Error('Export hash mismatch');
    });
  }
  const mappings=read('private/game-data/native-mappings.json');
  if(sha(fs.readFileSync(path.join(root,'private/game-data/native-mappings.json')))!==manifest.nativeMappingsSha256)issues.push('Native mappings differ from planner manifest');
  for(const file of ['native-aggro-defaults','native-patrol-defaults']){
    const defaults=read('private/game-data/'+file+'.json');
    if(defaults.sourceSha256!==mappings.sourceSha256)issues.push('Native source mismatch: '+file);
  }
  const dungeons={};
  for(const d of registry.playable){
    attempt(d.id,()=>{
      const dir=actorsRoot+'/'+d.key,data=read(dir+'/extracted.json');checkBuild(d.id,data);
      if(data.issues?.length)issues.push('Actor normalization issues: '+d.id);
      const raw=Object.entries(data.rawSha256).map(([name,hash])=>{
        const bytes=fs.readFileSync(path.join(root,dir,'raw',name));
        if(sha(bytes)!==hash)throw Error('Actor raw hash mismatch: '+name);
        return JSON.parse(bytes);
      });
      const guids=actorGuids(raw),actors={};
      for(const mob of data.mobs){
        const guid=guids.get(mob.actorKey);
        if(!guid||guid in actors)throw Error('Missing/duplicate actor GUID: '+mob.actorKey);
        // Raw export indices are deliberately excluded from placement comparison.
        actors[guid]={enemyId:mob.enemyId,worldPosition:mob.worldPosition};
      }
      const navmesh={};
      for(const profile of ['default','boss']){
        const file=dir+'/navmesh/'+profile+'.json',bytes=fs.readFileSync(path.join(root,file));
        checkBuild(file,JSON.parse(bytes));navmesh[profile]=sha(bytes);
      }
      dungeons[d.id]={key:d.key,info:d.info,selectedLevels:data.selectedLevels,actors,
        patrolsSha256:sha(JSON.stringify(canonical(data.patrols))),
        behaviorSha256:sha(JSON.stringify(canonical(data.mobs.map(m=>({guid:guids.get(m.actorKey),behavior:m.behavior,socialAggro:m.socialAggro}))))),navmesh};
    });
  }
  const npcs=Object.fromEntries(read(planner+'/npcs.json').map(n=>[n.characterId,n]));
  const abilities=Object.fromEntries(read(planner+'/abilities.json').map(a=>[a.blueprint,a]));
  const tables=Object.fromEntries(read(planner+'/tables.json').map(t=>[t.name,t.rows]));
  const difficulty=attempt('difficulty tables',()=>Object.fromEntries(Object.entries(readDifficultyTables(path.join(root,actorsRoot))).map(([name,t])=>[name,t.rows])));
  Object.assign(tables,difficulty);
  const mapAreas=read(planner+'/map-objects.json').filter(o=>o.type==='BP_DungeonMapAreaBox_C');
  const services=read(planner+'/services.json');checkBuild('services',services);
  const guards=[];
  const serviceRules=read('scripts/game-service-semantics.json'),summons=read('scripts/game-summon-semantics.json');
  if(services.nativeSourceSha256!==serviceRules.nativeSourceSha256)guards.push('Review native targeting/scoring: scripts/game-service-semantics.json');
  for(const [source,hash]of Object.entries(serviceRules.scripts)){
    const entry=services.scripts.find(s=>s.source===source);
    if(!entry||attempt(source,()=>sha(fs.readFileSync(path.join(root,entry.file))),null)!==hash)guards.push('Review service Blueprint: '+source);
  }
  if(String(summons.steamBuild)!==build)guards.push('Review summon semantics for build '+build+': scripts/game-summon-semantics.json');
  for(const entry of summons.sources)if(attempt(entry.source,()=>sha(fs.readFileSync(path.join(root,entry.file))),null)!==entry.sha256)guards.push('Review summon Blueprint: '+entry.source);
  return {schemaVersion:1,build,capturedAt:new Date().toISOString(),issues,guards,nativeSha256:mappings.sourceSha256,
    sources,textures,dungeons,npcs,abilities,tables,mapAreas};
}
export function compareGameStates(before,after){
  if(before.schemaVersion!==1||after.schemaVersion!==1)throw Error('Unsupported patch snapshot schema');
  const dungeonDiff=diffRecords(before.dungeons,after.dungeons),dungeons={};
  for(const id of Object.keys(after.dungeons).filter(id=>id in before.dungeons)){
    const old=before.dungeons[id],next=after.dungeons[id],actors=diffRecords(old.actors,next.actors);
    const moved=[],retyped=[];
    for(const guid of actors.changed){
      const a=old.actors[guid],b=next.actors[guid];
      if(!equal(a.worldPosition,b.worldPosition))moved.push({guid,from:a.worldPosition,to:b.worldPosition});
      if(a.enemyId!==b.enemyId)retyped.push({guid,from:a.enemyId,to:b.enemyId});
    }
    dungeons[id]={added:actors.added,removed:actors.removed,moved,retyped,metadataChanged:!equal(old.info,next.info),
      selectionChanged:!equal(old.selectedLevels,next.selectedLevels),patrolsChanged:old.patrolsSha256!==next.patrolsSha256,
      behaviorChanged:old.behaviorSha256!==next.behaviorSha256,navmeshChanged:!equal(old.navmesh,next.navmesh)};
  }
  const tables=diffRecords(before.tables,after.tables);
  const tableRows=Object.fromEntries(tables.changed.map(name=>[name,diffRecords(before.tables[name],after.tables[name])]));
  return {schemaVersion:1,fromBuild:before.build,toBuild:after.build,issues:after.issues,guards:after.guards,
    dungeonDiff,dungeons,npcs:diffRecords(before.npcs,after.npcs),abilities:diffRecords(before.abilities,after.abilities),
    tables,tableRows,sources:diffRecords(before.sources,after.sources),
    textures:before.textures&&after.textures?diffRecords(before.textures,after.textures):null,
    nativeChanged:before.nativeSha256!==after.nativeSha256,
    mapAreasChanged:!equal(before.mapAreas,after.mapAreas)};
}
export function patchReportText(report){
  const list=d=>`+${d.added.length} / -${d.removed.length} / changed ${d.changed.length}`;
  const lines=[`Game patch ${report.fromBuild} -> ${report.toBuild}`,
    `Dungeons: ${list(report.dungeonDiff)}`,`NPCs: ${list(report.npcs)}`,`Abilities: ${list(report.abilities)}`,
    `Tables: ${list(report.tables)}`,`Exported sources: ${list(report.sources)}`,
    report.textures?`Textures (raw and decoded): ${list(report.textures)}`:'Textures: comparison unavailable; snapshot lacks a texture inventory',
    `Native executable changed: ${report.nativeChanged}; map areas changed: ${report.mapAreasChanged}`];
  for(const id of report.dungeonDiff.added)lines.push('NEW DUNGEON: '+id);
  for(const [id,d]of Object.entries(report.dungeons))if(d.added.length||d.removed.length||d.moved.length||d.retyped.length||d.metadataChanged||d.selectionChanged||d.patrolsChanged||d.behaviorChanged||d.navmeshChanged)
    lines.push(`${id}: +${d.added.length} / -${d.removed.length} actors; moved ${d.moved.length}; retyped ${d.retyped.length}; metadata ${d.metadataChanged}; selection ${d.selectionChanged}; patrols ${d.patrolsChanged}; behavior ${d.behaviorChanged}; navmesh ${d.navmeshChanged}`);
  for(const [name,rows]of Object.entries(report.tableRows))lines.push(name+': '+list(rows));
  for(const issue of report.issues)lines.push('INVALID SOURCE: '+issue);
  for(const guard of report.guards)lines.push('REVIEW REQUIRED: '+guard);
  lines.push('Review changed map bounds/artwork, Combined recipes, reference calibration and marker anchors before building.',
    'Review changed difficulty/health curves, score/timer rules, affixes, summons and log IDs; hashes must only be updated after review.',
    'GUID changes retire placements. Do not match new actors by proximity or reuse route dictionary indexes.');
  return lines.join('\n')+'\n';
}
