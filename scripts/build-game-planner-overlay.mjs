// Planner presentation/selection policy, separate from the untouched game dump.
// Run after extraction. Output is for the forthcoming game-source importer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stormwatchBoss} from '../data/boss-encounters.js';
import {filterLowHeightOutliers,heightFilterPolicy} from './game-height-filter.mjs';
import {prepareNavmesh} from './game-navmesh-surface.mjs';
const root=process.argv[2]??process.env.GAME_DATA_ROOT??'private/game-data/all-dungeons';
const out=process.argv[3]??'tmp/game-planner-overlay';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const toXYZ=p=>({x:p.X,y:p.Y,z:p.Z});
const sources={},activeActorKeys={},excludedActors=[],heightChecks=[];
const auxiliarySourceHashes={};
const objectsFile=path.join(root,'route-objects.json'),objects=read(objectsFile);
auxiliarySourceHashes[objectsFile]=hash(objectsFile);
const serviceObjects=objects.sourceActors.filter(o=>o.selected&&o.routeRecommendation?.includeAsCombatEnemy===false&&o.routeRecommendation?.includeInPullGroups===false);
const potentialHazards=objects.trapSpawners.filter(o=>o.selected);
const data=new Map();
for(const entry of fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory())){
  const dir=path.join(root,entry.name),file=path.join(dir,'extracted.json');
  if(!fs.existsSync(file))continue;
  const d=read(file);sources[entry.name]=hash(file);data.set(entry.name,d);
  const services=serviceObjects.filter(o=>o.dungeon===entry.name);
  for(const service of services){
    const mob=d.mobs.find(m=>m.actorKey===service.objectPath);
    assert.ok(mob,'Service-object proof must match a selected actor');
    assert.deepEqual(mob.worldPosition,toXYZ(service.position));
    excludedActors.push({dungeon:entry.name,actorKey:mob.actorKey,actorName:mob.actorName,
      worldPosition:mob.worldPosition,reason:service.role,classification:'service-object',
      evidence:{sourceFile:objectsFile,objectPath:service.objectPath,routeRecommendation:service.routeRecommendation}});
  }
  const serviceKeys=new Set(services.map(s=>s.objectPath));
  const filtered=filterLowHeightOutliers(d.mobs.filter(m=>!serviceKeys.has(m.actorKey)));
  // Corroborate population-height exclusions with actual baked surfaces. Missing navmesh
  // or disagreement must stop preparation rather than silently publish a weaker exclusion.
  const navmeshEvidence=[];
  if(filtered.excluded.length)for(const profile of ['default','boss']){
    const file=path.join(dir,'navmesh',profile+'.json'),mesh=read(file);
    assert.equal(mesh.steamBuild,d.steamBuild,'Navmesh build differs from actors');
    auxiliarySourceHashes[file]=hash(file);
    const surface=prepareNavmesh(mesh);
    for(const mob of filtered.excluded)assert.ok(surface.minZ-mob.worldPosition.z>=heightFilterPolicy.minGap,
      'Height exclusion is not corroborated by navmesh: '+mob.actorKey);
    navmeshEvidence.push({profile,file,minSurfaceZ:surface.minZ,maxSurfaceZ:surface.maxZ});
  }
  activeActorKeys[entry.name]=filtered.active.map(m=>m.actorKey);
  heightChecks.push({dungeon:entry.name,total:d.mobs.length,serviceObjects:services.length,excluded:filtered.excluded.length,evidence:filtered.evidence,navmeshEvidence});
  for(const m of filtered.excluded)excludedActors.push({dungeon:entry.name,actorKey:m.actorKey,actorName:m.actorName,
    worldPosition:m.worldPosition,reason:'Tiny lower population separated by a large Z gap relative to the main population.',
    classification:'height-outlier-corroborated-by-navmesh; runtime inactivity not proven',evidence:filtered.evidence,navmeshEvidence});
}
const builds=new Set([...data.values()].map(d=>d.steamBuild));
assert.equal(builds.size,1,'Cannot mix game builds');

const proofFile=path.join(root,'NightPatrol/brogg-retreat.json'),proof=read(proofFile);
assert.equal(proof.kind,'same-actor-phase-teleport');
const boss=data.get('NightPatrol').mobs.find(m=>m.actorKey===proof.actor.objectPath);
assert.ok(boss,'Brogg proof must refer to the current game actor');
assert.deepEqual(boss.worldPosition,toXYZ(proof.actor.initialActorPosition));
for(const asset of Object.values(proof.sources.assets))assert.equal(hash(path.join(root,'behavior-scripts',asset.file)),asset.sha256,'Changed Brogg proof asset');
const anchor=toXYZ(proof.destination.groundMarkerPosition);
assert.ok(Object.values(anchor).every(Number.isFinite));
const encounters=[{dungeon:'NightPatrol',actorKey:boss.actorKey,enemyId:boss.enemyId,
  identity:'one-actor-two-encounter-markers',countAsActors:1,
  phases:[
    {id:'phase-1',label:'Phase 1',phaseTag:proof.fromPhase,legacyPlacementId:stormwatchBoss.bridge,
      markerPosition:boss.worldPosition,positionKind:'actor-center',actorPosition:boss.worldPosition},
    {id:'phase-2',label:'Phase 2',phaseTag:proof.toPhase,legacyPlacementId:stormwatchBoss.final,
      markerPosition:anchor,positionKind:'teleport-ground-anchor',actorPosition:proof.destination.exactActorPosition?toXYZ(proof.destination.exactActorPosition):null,
      actorPositionFormula:proof.destination.actorPositionFormula,
      note:'Render the extracted destination anchor. Do not treat it as the actor center for 3D aggro until the ground-to-actor offset is resolved.'},
  ],transition:{ability:'GA_NP_BossHellcaller_Retreat',triggerHealthPercent:proof.triggerHealthPercent,
    firstPhaseMinHealthPercent:proof.firstPhaseMinHealthPercent,timingSeconds:proof.timingSeconds},
  source:{proofFile,sha256:hash(proofFile),targetObjectPath:proof.destination.markerObjectPath}}];
const totalGameMobs=[...data.values()].reduce((n,d)=>n+d.mobs.length,0);
const activeMobs=Object.values(activeActorKeys).reduce((n,ids)=>n+ids.length,0);
assert.equal(activeMobs,totalGameMobs-excludedActors.length);
assert.equal(activeActorKeys.NightPatrol.filter(id=>id===boss.actorKey).length,1,'Phases must not duplicate the boss actor');
for(const [file,digest] of Object.entries(auxiliarySourceHashes))assert.equal(hash(file),digest,'Source changed during overlay build');
for(const [dungeon,digest] of Object.entries(sources))assert.equal(hash(path.join(root,dungeon,'extracted.json')),digest,'Actors changed during overlay build');
const result={schemaVersion:3,generatedAt:new Date().toISOString(),steamBuild:[...builds][0],heightFilterPolicy,heightChecks,
  sourceHashes:sources,auxiliarySourceHashes,summary:{gameActors:totalGameMobs,activeActors:activeMobs,excludedActors:excludedActors.length,
    serviceObjects:serviceObjects.length,potentialHazards:potentialHazards.length,encounterMarkers:2},
  activeActorKeys,excludedActors,serviceObjects,potentialHazards,encounters,
  note:'Game-source importer input. Raw/extracted data and current published planner datasets are unchanged.'};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'overlay.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({summary:result.summary,exclusion:excludedActors[0],encounters},null,2));
