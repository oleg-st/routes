// Production Custom geometry: game actors + game patrols + our social model.
// Third-party group memberships are deliberately not inputs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {actorGuids,resolveIdentity,projectGamePoint,dungeonIdentity,selectMapFrame} from './game-source-identity.mjs';
import {gameSocialInput,formationMotionBounds} from './game-patrol-model.mjs';
import {inferGeometricPacks} from './geometric-pack-model.mjs';
import {navigationIndex,auditPatrolIslands,applyIslandCandidates} from './game-patrol-island-rule.mjs';
const root=process.env.GAME_DATA_ROOT??'private/game-data/all-dungeons';
const output=process.env.GAME_DATA_OUTPUT??'data';
const registryFile='scripts/game-source-registry.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes={};
function read(f){const b=fs.readFileSync(f);hashes[f]=sha(b);return JSON.parse(b);}
const registry=read(registryFile),overlay=read('tmp/game-planner-overlay/overlay.json');
const mapFrames=read('data/game-map-frames.json');
const display=read('scripts/map-area-selection.json');
assert.equal(display.buildId,overlay.steamBuild,'Review displayed map areas for this build');
for(const [id,areas]of Object.entries(display.dungeons))for(const area of areas){
  assert.deepEqual(mapFrames[id]?.[area.id]?.calibration,area.calibration,'Native map frame changed: '+area.id);
}
const base=read('data/dungeons.json'),catalog=new Set(read('data/enemies.json').map(e=>e.id));
const gameDungeons={},customDungeons={},report={steamBuild:overlay.steamBuild,model:'game-formation-island-1s-v1',dungeons:[]};
for(const key of Object.keys(overlay.activeActorKeys).sort()){
  const id='Level.ID.'+key,d=base.find(d=>d.id===id),identity=dungeonIdentity(registry,id);
  assert.ok(d,`New dungeon ${key}: extract metadata and map frames before publishing`);
  const dir=`${root}/${key}`,data=read(dir+'/extracted.json');
  assert.equal(hashes[dir+'/extracted.json'],overlay.sourceHashes[key],'Regenerate selection overlay');
  assert.equal(data.steamBuild,overlay.steamBuild,'Mixed actor builds');
  const guids=actorGuids(fs.readdirSync(dir+'/raw').filter(f=>f.endsWith('.json')).map(f=>read(dir+'/raw/'+f)));
  const mesh=read(dir+'/navmesh/default.json');assert.equal(mesh.steamBuild,data.steamBuild);
  const audit=auditPatrolIslands(data,navigationIndex(mesh)),corrected=applyIslandCandidates(data,audit.candidates,1);
  const input=gameSocialInput(corrected.data,overlay.activeActorKeys[key]);
  assert.ok(input.length,'No active combat actors: '+key);
  const verticals=new Set(input.map(m=>m.verticalLimit));assert.equal(verticals.size,1,'Per-actor vertical limits need model support');
  const model=inferGeometricPacks(input,{heightAdjustedPaths:true,synchronizeSharedPaths:false,synchronizedMotionBounds:formationMotionBounds,verticalLimit:input[0].verticalLimit});
  assert.equal(model.invalid.length,0,'Invalid model input');
  const active=new Set(overlay.activeActorKeys[key]),byActor=new Map(),seenGuids=new Set();
  for(const mob of data.mobs.filter(m=>active.has(m.actorKey))){
    const guid=guids.get(mob.actorKey);assert.ok(!seenGuids.has(guid),'Duplicate actor GUID');seenGuids.add(guid);
    const entry=resolveIdentity(identity.actors,guid);
    assert.ok(catalog.has(mob.enemyId),`Extract catalog entry for new enemy ${mob.enemyId}`);
    const spawnPoint=selectMapFrame(mob.worldPosition,mapFrames[id],undefined,{displayAreas:display.dungeons[id]});
    const motion=input.find(m=>m.id===mob.actorKey),patrolPath=motion.path.length?motion.path:null;
    const burried=mob.behavior.spawnState==='Dormant'||!!mob.behavior.dormantProximityTrigger||mob.behavior.unburrowAnimationIndicators.length>0;
    const p={id:mob.enemyId,placementId:entry.placementId,worldPosition:mob.worldPosition,...spawnPoint,
      // Patrol samples can leave the map boxes. Extrapolate only from this
      // actor's freshly selected floor, never from its previous-build floor.
      patrolPath,mapPatrolPath:patrolPath?.map(w=>selectMapFrame(w,mapFrames[id],spawnPoint.mapImageId,{allowOutside:true,displayAreas:display.dungeons[id]}))??null,
      gameGuid:guid,...(burried?{burried:true}:{}),...(motion.inactive?{dormant:true}:{})};
    byActor.set(mob.actorKey,p);
  }
  const packs=model.groups.map(group=>{
    const members=group.map(k=>byActor.get(k).placementId).sort();
    return {id:'pack-game-'+sha(members.join('|')).slice(0,24),members};
  });
  const enemies=[...byActor.values()].sort((a,b)=>(identity.actors[a.gameGuid].order??Infinity)-(identity.actors[b.gameGuid].order??Infinity)||a.placementId.localeCompare(b.placementId));
  for(const encounter of overlay.encounters.filter(e=>e.dungeon===key))for(const phase of encounter.phases.slice(1)){
    const actor=byActor.get(encounter.actorKey);
    const candidates=Object.entries(mapFrames[id]).filter(([,f])=>['x','y','z'].every(k=>phase.markerPosition[k]>=f.bounds[0][k]&&phase.markerPosition[k]<=f.bounds[1][k]));
    assert.equal(candidates.length,1,'Ambiguous map area for encounter phase '+phase.legacyPlacementId);
    const [mapImageId,frame]=candidates[0];
    enemies.push({id:actor.id,placementId:phase.legacyPlacementId,worldPosition:phase.markerPosition,mapImageId,
      mapPosition:projectGamePoint(phase.markerPosition,frame),patrolPath:null,mapPatrolPath:null,gameGuid:actor.gameGuid,encounterPhase:phase.id});
    packs.push({id:'pack-game-'+sha(phase.legacyPlacementId).slice(0,24),members:[phase.legacyPlacementId]});
  }
  const owners=new Map(packs.flatMap(p=>p.members.map(id=>[id,p.id])));
  for(const p of enemies)p.packId=owners.get(p.placementId);
  assert.equal(owners.size,enemies.length);assert.equal(new Set(enemies.map(p=>p.placementId)).size,enemies.length);
  gameDungeons[id]={steamBuild:data.steamBuild,enemies};
  customDungeons[id]={packs,burried:enemies.filter(p=>p.burried).map(p=>p.placementId)};
  report.dungeons.push({id,actors:active.size,placements:enemies.length,packs:packs.length,patrolMembers:enemies.filter(p=>p.patrolPath).length,dormant:enemies.filter(p=>p.dormant).length,correctedPathPoints:corrected.editedPoints,navmeshCoverage:audit.coverage});
  console.log(key,active.size,'actors',packs.length,'packs');
}
for(const [f,h]of Object.entries(overlay.auxiliarySourceHashes))assert.equal(sha(fs.readFileSync(f)),h,'Stale overlay evidence: '+f);
for(const [f,h]of Object.entries(hashes))assert.equal(sha(fs.readFileSync(f)),h,'Source changed during build');
report.sourceHashes=hashes;
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(output+'/game-dungeons.js','// Generated by scripts/prepare-game-data.mjs; game geometry and inferred packs.\nexport const gameDungeons='+JSON.stringify(gameDungeons)+';\n');
fs.writeFileSync(output+'/custom-dungeons.js','// Generated from game data by scripts/prepare-game-data.mjs.\nexport const customDungeons='+JSON.stringify(customDungeons)+';\n');
fs.writeFileSync(output+'/dungeons.json',JSON.stringify(base.map(d=>({...d,enemies:gameDungeons[d.id].enemies})),null,2)+'\n');
fs.writeFileSync(registryFile,JSON.stringify(registry,null,2)+'\n');
fs.mkdirSync('tmp/game-source-migration',{recursive:true});
fs.writeFileSync('tmp/game-source-migration/report.json',JSON.stringify(report,null,2)+'\n');
