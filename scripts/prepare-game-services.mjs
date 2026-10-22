import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGameCatalogSource,readJson,sha} from './game-catalog-source.mjs';
import {gameDungeons} from '../data/game-dungeons.js';
import {capsuleInCylinder,selectedServiceLevel,serviceMapPoint,rotateGameVector,playerStartCenter} from './game-service-model.mjs';
import {gameScoringRules} from './game-scoring-source.mjs';
const s=loadGameCatalogSource(),frames=readJson('data/game-map-frames.json'),catalog=readJson('data/enemies.json');
const semantics=readJson('scripts/game-service-semantics.json'),services=s.read('services');
assert.equal(services.steamBuild,s.manifest.steamBuild,'Re-export service Blueprints');
assert.equal(services.nativeSourceSha256,semantics.nativeSourceSha256,'Game native code changed; review targeting and scoring before publishing');
for(const [source,hash]of Object.entries(semantics.scripts)){
 const r=services.scripts.find(r=>r.source===source);
 assert.ok(r,'Missing service Blueprint '+source);assert.equal(sha(fs.readFileSync(r.file)),hash,'Service Blueprint changed; review rules: '+source);
}
const out=process.env.GAME_SERVICES_OUTPUT??'data';fs.mkdirSync(out,{recursive:true});
const report={steamBuild:s.manifest.steamBuild,source:'installed-game',floorAssignments:[],entrances:[],dungeons:[],limitations:[
 'Selected enemy layers follow the geometry export profile; runtime alternative-layer activation is not simulated.',
 'Overlapping map areas use the nearest mapped combat actor to choose the displayed floor; see floorAssignments.',
 'Mini-boss replacement uses initial actor positions: per user confirmation, the actor exists at instance creation and activates later. Capsule-cylinder intersection is our reconstruction of the native query, not an executed game query.',
 'Shadow Lord totals describe orb thresholds for selected deaths, assuming pickups and successful lord spawns; route data cannot reproduce pickup timing, resets or unselected summons.'
]};
const campfires={},starts={},presets={buildId:s.manifest.steamBuild,source:'installed-game',status:'actor-tags-and-spawner-hit-capsules',dungeons:{}};
const xyz=p=>({x:p.X??0,y:p.Y??0,z:p.Z??0});
function capsule(actor,placement){
 const p=s.properties(actor.ref),root=s.properties(p.RootComponent),hit=s.properties(p.CharacterHitVolume);
 const scale=root.RelativeScale3D??{X:1,Y:1,Z:1},local=hit.RelativeScale3D??{X:1,Y:1,Z:1};
 const radius=hit.CapsuleRadius*Math.min(scale.X*local.X,scale.Y*local.Y),halfHeight=hit.CapsuleHalfHeight*scale.Z*local.Z;
 assert.ok(Number.isFinite(radius)&&Number.isFinite(halfHeight),'Missing hit capsule dimensions '+actor.ref);
 const offset=rotateGameVector(xyz(Object.fromEntries(['X','Y','Z'].map(k=>[k,(hit.RelativeLocation?.[k]??0)*scale[k]]))),root.RelativeRotation);
 const axis=rotateGameVector(rotateGameVector({x:0,y:0,z:1},hit.RelativeRotation),root.RelativeRotation);
 return {position:Object.fromEntries(['x','y','z'].map(k=>[k,placement.worldPosition[k]+offset[k]])),radius,halfHeight:Math.max(radius,halfHeight),axis};
}
for(const d of s.read('dungeons').playable){
 const data=readJson('private/game-data/all-dungeons/'+d.key+'/extracted.json');assert.equal(data.steamBuild,s.manifest.steamBuild);
 const placements=gameDungeons[d.id].enemies.filter(p=>!p.encounterPhase),byGuid=new Map(placements.map(p=>[p.gameGuid,p]));
 const actors=[...s.objects.values()].filter(o=>byGuid.has(String(o.ActorInstanceGuid?.ActorGuid).toLowerCase())&&selectedServiceLevel(o.source,data.selectedLevels));
 assert.equal(actors.length,placements.length,'Missing or duplicate active actor in service export: '+d.id);
 const actorPlacement=o=>byGuid.get(String(o.ActorInstanceGuid.ActorGuid).toLowerCase());
 const empowered=actors.filter(o=>(s.properties(o.ref).CharacterTags??[]).includes('ActorTypeTags.DungeonModifiers.EmpoweredMinions.Selected')).map(actorPlacement).filter(p=>!catalog.find(e=>e.id===p.id)?.isBoss).map(p=>p.placementId).sort();
 assert.equal(new Set(empowered).size,empowered.length,'Duplicate empowered actors');
 const objects=s.read('map-objects').filter(o=>o.source.match(/(?:dungeons|Adventures)\/([^/]+)\//i)?.[1]===d.key&&selectedServiceLevel(o.source,data.selectedLevels));
 const map=o=>{
  const root=o.rootComponent.properties;assert.ok(!root.AttachParent,'Attached POI requires transform composition');
  const worldPosition=xyz(root.RelativeLocation),point=serviceMapPoint(worldPosition,frames[d.id],placements);
  if(point.candidates.length>1)report.floorAssignments.push({dungeon:d.id,actor:o.ref,selected:point.mapImageId,candidates:point.candidates});
  return {worldPosition,mapImageId:point.mapImageId,mapPosition:point.mapPosition};
 };
 campfires[d.id]=objects.filter(o=>o.type==='BP_RespawnPointInteractable_C').map(o=>({id:'campfire-game-'+s.object(o.ref).ActorInstanceGuid.ActorGuid.toLowerCase(),...map(o),source:o.ref}));
 const entrance=playerStartCenter(objects.filter(o=>o.type==='PlayerStart'),d.key);
 const startMap=serviceMapPoint(entrance.worldPosition,frames[d.id],placements);
 for(const position of entrance.spawnPoints)assert.equal(serviceMapPoint(position,frames[d.id],placements).mapImageId,startMap.mapImageId,'PlayerStarts span different map areas; review entrance display: '+d.key);
 report.entrances.push({dungeon:d.id,diameter:entrance.diameter,count:entrance.spawnPoints.length,mapImageId:startMap.mapImageId});
 starts[d.id]={worldPosition:entrance.worldPosition,mapImageId:startMap.mapImageId,mapPosition:startMap.mapPosition,sources:entrance.sources,spawnPoints:entrance.spawnPoints};
 if(startMap.candidates.length>1)report.floorAssignments.push({dungeon:d.id,actor:'PlayerStart centroid',selected:startMap.mapImageId,candidates:startMap.candidates});
 const row={empowered,ghorn:null,witch:null};
 for(const [kind,enumValue]of [['ghorn',0],['witch',2]]){
  const spawners=objects.filter(o=>o.type==='BP_DM_MiniBossSpawner_C'&&Number((o.properties.MiniBossType??'NewEnumerator0').match(/NewEnumerator(\d+)/)?.[1])===enumValue);
  if(!spawners.length)continue;
  const spawns=spawners.map((o,index)=>{
  const point=map(o),radius=o.properties.RemoveAddRadius,height=semantics.removalCylinderHeight;
  assert.ok(Number.isFinite(radius),'Missing removal radius');
  const members=actors.filter(a=>capsuleInCylinder(capsule(a,actorPlacement(a)),point.worldPosition,radius,height)).map(actorPlacement);
  assert.ok(!members.some(p=>catalog.find(e=>e.id===p.id)?.isBoss),'Spawner intersects boss: '+o.ref);
  const anchor=[...members].sort((a,b)=>Math.hypot(a.worldPosition.x-point.worldPosition.x,a.worldPosition.y-point.worldPosition.y)-Math.hypot(b.worldPosition.x-point.worldPosition.x,b.worldPosition.y-point.worldPosition.y))[0];
  return {placementId:'modifier:'+kind+(index?':'+s.object(o.ref).ActorInstanceGuid.ActorGuid.toLowerCase():''),packId:anchor?.packId??null,replacedEnemies:members.map(p=>p.placementId).sort(),...point,radius,height,source:o.ref};
  });
  const replacedEnemies=spawns.flatMap(p=>p.replacedEnemies);
  assert.equal(new Set(replacedEnemies).size,replacedEnemies.length,'Overlapping mini-boss replacement zones: '+d.id);
  assert.ok(spawns.some(p=>p.packId),'Modifier with no replacement anywhere requires an independent preset: '+d.id+' '+kind);
  row[kind]={...spawns[0],packId:spawns.find(p=>p.packId).packId,replacedEnemies:replacedEnemies.sort(),spawns};
 }
 presets.dungeons[d.id]=row;report.dungeons.push({id:d.id,campfires:campfires[d.id].length,empowered:empowered.length,ghorn:row.ghorn?.replacedEnemies.length??0,witch:row.witch?.replacedEnemies.length??0});
}
const rules=gameScoringRules(s,semantics);
assert.ok(rules.empoweredScoreMultiplier>0);
fs.writeFileSync(out+'/game-service-rules.js','// Generated from game effect definitions and reviewed planner overrides.\nexport const gameServiceRules='+JSON.stringify(rules)+';\n');
fs.writeFileSync(out+'/map-campfires.js','// Generated from installed-game respawn actors.\nexport const campfireBuildId='+JSON.stringify(s.manifest.steamBuild)+';\nexport const campfires='+JSON.stringify(campfires,null,2)+';\n');
fs.writeFileSync(out+'/map-starts.js','// Generated from installed-game PlayerStart actors; flag = party spawn centroid.\nexport const mapStartBuildId='+JSON.stringify(s.manifest.steamBuild)+';\nexport const mapStarts='+JSON.stringify(starts,null,2)+';\n');
fs.writeFileSync(out+'/modifier-placements.json',JSON.stringify(presets,null,2)+'\n');
fs.writeFileSync(out+'/game-modifier-positions.js','// Generated from installed-game mini-boss spawners.\nexport const modifierPositions='+JSON.stringify(Object.fromEntries(Object.entries(presets.dungeons).map(([id,row])=>[id,Object.fromEntries(['ghorn','witch'].filter(k=>row[k]).map(k=>[k,{worldPosition:row[k].worldPosition,mapImageId:row[k].mapImageId,mapPosition:row[k].mapPosition,replacedEnemies:row[k].replacedEnemies,spawns:row[k].spawns}]))])))+';\n');
fs.mkdirSync('tmp/game-services',{recursive:true});fs.writeFileSync('tmp/game-services/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.dungeons));
