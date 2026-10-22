import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compareGameStates,patchReportText,diffRecords,captureTextureState,captureSummonDiscovery,indexNpcVariants,sha} from '../scripts/game-patch-state.mjs';
import {backupFiles,restoreFiles,freshExtraction,inside} from '../scripts/game-patch-files.mjs';
import {readDifficultyTables,availableDifficultyLevels,difficultyAssets} from '../scripts/game-difficulty-source.mjs';
import {dungeonIdentity,selectMapFrame,resolveIdentity} from '../scripts/game-source-identity.mjs';

function fixture(t){
  const parent=path.resolve('tmp/patch-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'case-'));
  t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const write=(name,value)=>{const file=inside(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  return {root,write};
}
const state=()=>({schemaVersion:1,build:'old',issues:[],guards:[],nativeSha256:'native',sources:{'/unknown/asset':'hash'},npcs:{old:{gameId:1}},abilities:{},tables:{Scaling:{HP:2}},mapAreas:[],dungeons:{old:{key:'old',info:{score:10},actors:{guid:{enemyId:'old',worldPosition:{x:0,y:0,z:0}}},selectedLevels:['base'],patrolsSha256:'p',behaviorSha256:'b',navmesh:{default:'n'}}}});
test('Patch report detects moved actors, new maps/NPCs, scaling and unknown source changes',()=>{
  const before=state(),after=state();after.build='new';after.dungeons.old.actors.guid.worldPosition.x=123;
  after.dungeons.new={...structuredClone(after.dungeons.old),key:'new'};after.npcs.new={gameId:2};
  after.tables.Scaling.HP=3;after.sources['/unknown/asset']='changed';after.nativeSha256='changed';after.guards=['Review new code'];
  const report=compareGameStates(before,after);
  assert.deepEqual(report.dungeonDiff.added,['new']);assert.equal(report.dungeons.old.moved[0].guid,'guid');
  assert.equal(report.dungeons.old.added.length,0);assert.deepEqual(report.npcs.added,['new']);
  assert.deepEqual(report.tableRows.Scaling.changed,['HP']);assert.deepEqual(report.sources.changed,['/unknown/asset']);
  assert.ok(report.nativeChanged);assert.match(patchReportText(report),/REVIEW REQUIRED: Review new code/);
  assert.deepEqual(diffRecords({a:{x:1,y:2}},{a:{y:2,x:1}}).changed,[]);
});
test('Texture-only changes are reported separately; old baselines do not imply all textures are new',()=>{
  const before=state(),after=state();
  before.textures={map:{bulkSha256:'old'},removed:{bulkSha256:'x'}};
  after.textures={map:{bulkSha256:'new'},portrait:{bulkSha256:'y'}};
  const report=compareGameStates(before,after);
  assert.deepEqual(report.textures,{added:['portrait'],removed:['removed'],changed:['map']});
  assert.deepEqual(report.sources.changed,[]);
  assert.match(patchReportText(report),/Textures \(raw and decoded\): \+1 \/ -1 \/ changed 1/);
  delete before.textures;
  assert.equal(compareGameStates(before,after).textures,null);
  assert.match(patchReportText(compareGameStates(before,after)),/comparison unavailable/);
});

test('NPC variants sharing a character ID remain independently comparable',()=>{
  const before=state(),after=state();
  before.npcVariants=indexNpcVariants([{characterId:'dragon',blueprint:'A',gameId:1},{characterId:'dragon',blueprint:'B',gameId:2}]);
  after.npcVariants=structuredClone(before.npcVariants);after.npcVariants.A.gameId=3;
  assert.deepEqual(compareGameStates(before,after).npcVariants.changed,['A']);
  delete before.npcVariants;assert.equal(compareGameStates(before,after).npcVariants,null);
});

test('Summon discovery validates catalogue, completeness and bytecode hashes before comparison',t=>{
  const {root,write}=fixture(t),source='private/game-data/all-dungeons/behavior-scripts/spawn.json';
  assert.equal(captureSummonDiscovery(root,'new'),null);
  write('private/game-data/planner/manifest.json','catalogue');write(source,'bytecode');
  const report={steamBuild:'new',catalogManifestSha256:sha('catalogue'),blueprints:1,exported:1,errors:[],hashes:{spawn:sha('bytecode')},files:{spawn:source}};
  const save=()=>write('private/reports/summon-discovery.json',JSON.stringify(report));save();
  assert.deepEqual(captureSummonDiscovery(root,'new'),report.hashes);
  assert.throws(()=>captureSummonDiscovery(root,'old'),/mixed-build/);
  write(source,'changed');assert.throws(()=>captureSummonDiscovery(root,'new'),/hash mismatch/);write(source,'bytecode');
  report.exported=0;save();assert.throws(()=>captureSummonDiscovery(root,'new'),/Incomplete/);
  report.exported=1;report.catalogManifestSha256='stale';save();assert.throws(()=>captureSummonDiscovery(root,'new'),/Stale/);
  const before=state(),after=state();before.summonDiscovery={spawn:'old'};after.summonDiscovery={spawn:'new'};
  assert.deepEqual(compareGameStates(before,after).summonDiscovery.changed,['spawn']);
  delete before.summonDiscovery;assert.equal(compareGameStates(before,after).summonDiscovery,null);
});
test('Texture capture verifies raw pixels, decoded images, metadata and build, including HDR without PNG',t=>{
  const {root,write}=fixture(t),prefix='private/game-data/planner/';
  const metadata={Source:'Game/Map.uasset',BulkFile:'map.bin',BulkSha256:sha('pixels'),Width:64,Height:32,PixelFormat:'HDR'};
  const bytes=JSON.stringify(metadata),digest=sha(bytes);
  const result={Source:metadata.Source,Output:'texture/map.json',Sha256:digest,Diagnostics:[]};
  const image={source:metadata.Source,status:'raw-hdr'};
  write(prefix+'textures-manifest.json',JSON.stringify({steamBuild:'old',results:[result]}));
  const saveImages=build=>write(prefix+'images.json',JSON.stringify({steamBuild:build,images:[image]}));
  saveImages('old');write(prefix+'texture/map.json',bytes);write(prefix+'texture/map.bin','pixels');
  assert.equal(captureTextureState(root,'old')['game/map.uasset'].imageSha256,null);
  write(prefix+'texture/map.bin','changed');assert.throws(()=>captureTextureState(root,'old'),/hash mismatch/);
  write(prefix+'texture/map.bin','pixels');
  Object.assign(image,{output:'images/map.png',sha256:sha('decoded'),metadataSha256:digest});
  saveImages('old');write(prefix+'images/map.png','decoded');
  assert.equal(captureTextureState(root,'old')['game/map.uasset'].imageSha256,sha('decoded'));
  write(prefix+'images/map.png','changed');assert.throws(()=>captureTextureState(root,'old'),/hash mismatch/);
  write(prefix+'images/map.png','decoded');image.metadataSha256='stale';saveImages('old');
  assert.throws(()=>captureTextureState(root,'old'),/Stale decoded/);
  saveImages('new');assert.throws(()=>captureTextureState(root,'old'),/Mixed texture builds/);
});
test('New dungeons and moved actors use current bounds while retaining GUID identities',()=>{
  const registry={dungeons:{}},identity=dungeonIdentity(registry,'new');
  assert.deepEqual(identity,{actors:{},legacyPlacementIds:[]});assert.equal(dungeonIdentity(registry,'new'),identity);
  const a=resolveIdentity(identity.actors,'1234-abcd');
  const frame=(min,max)=>({bounds:[{x:min,y:0,z:0},{x:max,y:100,z:100}],calibration:{sx:100,sy:-100,ox:0,oy:max}});
  const frames={first:frame(0,100),second:frame(200,300)};
  assert.equal(selectMapFrame({x:250,y:50,z:50},frames,'first').mapImageId,'second');
  assert.equal(resolveIdentity(identity.actors,'1234-abcd').placementId,a.placementId);
  assert.throws(()=>selectMapFrame({x:500,y:50,z:50},frames,'first'),/map area/);
  assert.equal(selectMapFrame({x:500,y:50,z:50},frames,'second',{allowOutside:true}).mapImageId,'second','Patrols extrapolate from the current actor floor');
  assert.throws(()=>selectMapFrame({x:50,y:50,z:50},{a:frames.first,b:frames.first}),/ambiguous/);
  assert.equal(selectMapFrame({x:50,y:50,z:50},{a:frames.first,b:frames.first,second:frames.second},'second',{allowOutside:true}).mapImageId,'second','Ambiguous patrol overlap retains its actor floor');
});
test('Failed fresh extraction restores old raw exports and native defaults; retains failed candidate',async t=>{
  const {root,write}=fixture(t);write('private/game-data/all-dungeons/old.json','old');write('private/game-data/planner/manifest.json','old manifest');write('private/game-data/native-mappings.json','old native');
  const archive=inside(root,'archive');
  await assert.rejects(freshExtraction(root,archive,async()=>{
    assert.ok(!fs.existsSync(inside(root,'private/game-data/all-dungeons/old.json')));
    write('private/game-data/all-dungeons/new.json','partial');write('private/game-data/native-mappings.json','new native');throw Error('parser changed');
  }),/parser changed/);
  assert.equal(fs.readFileSync(inside(root,'private/game-data/all-dungeons/old.json'),'utf8'),'old');
  assert.equal(fs.readFileSync(inside(root,'private/game-data/native-mappings.json'),'utf8'),'old native');
  assert.ok(fs.existsSync(inside(archive,'failed/private/game-data/all-dungeons/new.json')));
});
test('Successful fresh extraction does not retain removed maps and keeps old raw archive',async t=>{
  const {root,write}=fixture(t);write('private/game-data/all-dungeons/removed/raw.json','old');const archive=inside(root,'archive');
  await freshExtraction(root,archive,async()=>write('private/game-data/all-dungeons/new/raw.json','new'));
  assert.ok(!fs.existsSync(inside(root,'private/game-data/all-dungeons/removed/raw.json')));
  assert.ok(fs.existsSync(inside(archive,'raw-before/private/game-data/all-dungeons/removed/raw.json')));
});
test('Published rollback restores old bytes, deletes introduced files and leaves other files intact',t=>{
  const {root,write}=fixture(t);write('data/a.json','old');write('other.txt','keep');
  const backup=inside(root,'backup');backupFiles(root,backup,['data']);write('data/a.json','new');write('data/introduced.json','new');
  restoreFiles(root,backup);assert.equal(fs.readFileSync(inside(root,'data/a.json'),'utf8'),'old');
  assert.ok(!fs.existsSync(inside(root,'data/introduced.json')));assert.equal(fs.readFileSync(inside(root,'other.txt'),'utf8'),'keep');
  assert.throws(()=>inside(root,'../escape'),/inside/);
});
test('Difficulty table lookup follows extractor status outputs and fails on diagnostics',t=>{
  const {root,write}=fixture(t),status=difficultyAssets.map((Source,i)=>({Source,Output:'new-'+i+'.json',Diagnostics:[]}));
  write('difficulty-assets.txt.status.json',JSON.stringify(status));
  for(const [i,Source]of difficultyAssets.entries())write('dependencies/new-'+i+'.json',JSON.stringify({Objects:[{Name:Source.split('/').at(-1),Rows:{value:i}}]}));
  assert.equal(readDifficultyTables(root).DT_GameFinderLeagues.rows.value,1);
  status[0].Diagnostics=['unsupported property'];write('difficulty-assets.txt.status.json',JSON.stringify(status));
  assert.throws(()=>readDifficultyTables(root),/Incomplete difficulty export/);
});
test('Difficulty range follows new league bounds beyond E90 and respects dungeon maximum',()=>{
  const levels={41:{d:'d'},140:{d:'d'},155:{d:'d'},170:{d:'d'},180:{d:'other'}};
  assert.deepEqual(availableDifficultyLevels(levels,{MinimumDifficulty:41,MaximumDifficulty:200},{id:'d',info:{MaximumDifficulty:160}}),[41,140,155]);
});
