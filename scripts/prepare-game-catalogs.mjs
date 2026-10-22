// Runtime catalogs built from installed-game exports, without third-party inputs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGameCatalogSource,readJson,sha,gamePlannerRoot} from './game-catalog-source.mjs';
import {activeCatalogIds,npcCatalogId as idOf,selectCatalogNpcs} from './game-catalog-actors.mjs';
const out=process.env.GAME_CATALOG_OUTPUT??'data';fs.mkdirSync(out,{recursive:true});
const s=loadGameCatalogSource(),registry=s.read('dungeons'),imageRecords=s.read('images').images;
const byImage=new Map(imageRecords.map(r=>[r.source,r])),textures=new Map();
for(const r of s.read('textures-manifest').results){if(!r.Output)continue;const t=readJson(gamePlannerRoot+'/'+r.Output);textures.set(t.Package.toLowerCase(),{...t,image:byImage.get(r.Source)});}
const jobs=new Map(),imageSources={},warnings=[];
function picture(ref,id,type,size='200',destination){
 const raw=ref?.ObjectPath??ref?.AssetPathName;if(!raw)return null;
 const t=textures.get(raw.slice(0,raw.lastIndexOf('.')).toLowerCase());assert.ok(t?.image?.output,'Missing decoded image '+raw);
 const input=gamePlannerRoot+'/'+t.image.output,hash=t.image.sha256;
 assert.equal(sha(fs.readFileSync(input)),hash,'Changed decoded image');
 destination??=`images/game/${hash.slice(0,24)}.avif`;
 jobs.set(destination,{source:input,destination,...(type==='dungeon-map'?{quality:85,subsampling:'4:4:4'}:{})});
 imageSources[destination]={source:input,sha256:hash,gameAsset:t.Package};
 return{id,type,size,path:destination,sourcePath:input,sourceSha256:hash,width:t.Width,height:t.Height,gameAsset:t.Package};
}
const activeIds=activeCatalogIds({root:process.env.GAME_DATA_ROOT??'private/game-data/all-dungeons',
 overlay:readJson('tmp/game-planner-overlay/overlay.json'),steamBuild:s.manifest.steamBuild,dungeonKeys:registry.playable.map(d=>d.key)});
const selected=selectCatalogNpcs(s.npcs,activeIds);
const bossesWithoutTag=new Set(['vv-bosskaldursonfire','vv-bosskaldursonice']); // Paired encounter; game Blueprint omits Boss tag.
const enemies=selected.map(n=>{
 const id=idOf(n),p=n.properties,tags=p.CharacterTags??[];
 const value=k=>s.curve(n.characterId+'.'+k)??s.curve('Default.'+k);
 const multiplier=value('Custom.DefaultBaseHealthMultiplier'),base=value('BasicAttributeSet.BaseHealth');
 const effects=p.PassiveGameplayEffects??[];
 const ccImmune=effects.some(e=>/\/(?:GE_CCImmune|GE_Shared_Immunity_AllCC)\./.test(e.ObjectPath));
 const isBoss=tags.includes('ActorTypeTags.Boss')||bossesWithoutTag.has(id);
 assert.ok(n.gameId&&n.name&&n.portrait,'Incomplete combat catalog '+id);
 if(n.characterId!==n.blueprint.replace(/^BP_NPC_/,''))warnings.push({id,kind:'character-id-differs-from-blueprint',characterId:n.characterId});
 return{id,gameId:n.gameId,name:n.name,dungeonScore:value('CRNpcAttributeSet.KillScore'),countsTowardsDungeonScore:p.CountTowardsDungeonScore!==false,shadowOrbEligible:!tags.includes('ActorTypeTags.DungeonModifiers.ShadowLord'),baseHealth:base!==null&&multiplier!==null?base*multiplier:null,
 baseHealthMultiplier:multiplier,spiritPointValue:value('CRNpcAttributeSet.SpiritPointValue'),isBoss,canBeControlled:!ccImmune,
 classification:tags.includes('ActorTypeTags.Elite')?'elite':'normal',armorType:n.armorType?.split('::').at(-1)??null,
 images:[picture(n.portrait,id,'enemy')],source:{blueprint:n.source,characterId:n.characterId,gameIdRegistry:'CRAICharacter.csv',baseAttributes:'CT_CharacterBaseAttributes'}};
}).sort((a,b)=>a.id.localeCompare(b.id));
assert.equal(new Set(enemies.map(e=>e.id)).size,enemies.length,'Duplicate enemy ID');
for(const id of activeIds)assert.ok(enemies.some(e=>e.id===id),'Missing active enemy '+id);
// Geometry is filled by prepare-game-data after these fresh catalogs/frames.
// Do not carry placements forward from a previous generated dungeon file.
const frames={},dungeons=[];
// UI labels for areas whose game assets omit a label or repeat "Global".
const areaLabels={T_Map_MythicForest_Global:'Overview',T_Map_UrrakMarkets_Global:'Overview',T_Map_SF_01:'Forest',T_Map_SF_Lair:'Lair',T_ST_Map_End_01:'Sanctum',T_ST_Map_Exterior_01:'Exterior',T_ST_Map_Interior_01:'Interior'};
for(const d of registry.playable){
 const maps=s.read('map-objects').filter(o=>o.type==='BP_DungeonMapAreaBox_C'&&o.source.match(/(?:dungeons|Adventures)\/([^/]+)\//i)?.[1]===d.key);
 assert.ok(maps.length,'No map areas for '+d.key);frames[d.id]={};
 const mapImages=maps.map(o=>{
  const p=o.rootComponent.properties,loc=p.RelativeLocation,scale=p.RelativeScale3D??{X:1,Y:1,Z:1},e=Object.fromEntries(['X','Y','Z'].map(k=>[k,p.BoxExtent[k]*scale[k]]));
  assert.ok(!p.AttachParent&&!Object.values(p.RelativeRotation??{}).some(v=>Math.abs(v)>1e-6),'Unsupported attached/rotated map '+o.ref);
  const texture=o.properties.DungeonAreaTexture,tex=texture.ObjectName.split("'")[1],id=d.id+':'+tex;
  frames[d.id][id]={calibration:{sx:2*e.Y,sy:-2*e.X,ox:loc.Y-e.Y,oy:loc.X+e.X},bounds:[{x:loc.X-e.X,y:loc.Y-e.Y,z:loc.Z-e.Z},{x:loc.X+e.X,y:loc.Y+e.Y,z:loc.Z+e.Z}],source:o.ref};
  const destination=`${maps.length>1?'private/':''}images/dungeons/maps/${d.key.toLowerCase()}-${tex.toLowerCase()}-game.avif`;
  return {...picture(texture,id,'dungeon-map','full',destination),name:areaLabels[tex]??o.properties.DungeonAreaName??'Overview',gameFrame:{calibration:frames[d.id][id].calibration,bounds:frames[d.id][id].bounds}};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const info=d.info;
 dungeons.push({id:d.id,routeBuildId:s.manifest.steamBuild,name:s.text(info.DisplayName),description:s.text(info.LevelDescription),kind:info.LevelType.endsWith('::Adventure')?'adventure':'capstone',minimumDifficulty:info.MinimumDifficulty,
 requiredScore:info.RequiredDungeonScoreToComplete,timerSeconds:info.DungeonQualifierTime,mapImages,loadingScreenImages:[],enemies:[],source:{kind:'game',steamBuild:s.manifest.steamBuild,levelInfo:d.source}});
}
// Hero roles are local UI categories; names, colors and portraits come from game assets.
const heroRoles={warmaster:'tank',meiko:'tank',mara:'tank',lisa:'healer',vigor:'healer',sune:'healer'};
const heroes=Object.entries(s.tables.find(t=>t.name==='DT_CharacterInfoTable').rows).filter(([,r])=>r.IsLive).map(([key,r])=>{
 const p=s.properties(r.CharacterMetaData),id=key.toLowerCase();return{id,name:s.text(p.HeroName),role:heroRoles[id]??'dps',classColor:'#'+p.ClassColor.Hex.slice(0,6),images:[picture(p.PortraitTexture,id,'hero')]};
}).sort((a,b)=>a.id.localeCompare(b.id));
const clean=v=>v.replaceAll(/[^a-z0-9]/gi,'').toLowerCase();
const ownerKeys=[...enemies.flatMap(e=>[{id:e.id,key:clean(e.id)},{id:e.id,key:clean(e.source.characterId)}]),...heroes.map(h=>({id:h.id,key:clean(h.id)}))].sort((a,b)=>b.key.length-a.key.length);
const abilityByName=new Map(s.abilities.map(a=>[a.blueprint.toLowerCase(),a]));
const abilityRows=new Map(),abilities=new Map(),grants=new Map();
// Follow actual Blueprint/default/phase/effect references, including shared casts.
for(const n of selected){
 const found=new Set(),seen=new Set();
 function scan(value){
  if(!value||typeof value!=='object')return;
  const ref=value.ObjectPath??value.AssetPathName;
  if(typeof ref==='string'&&/\/(?:GA_|GE_|DA_|AIBC_|AC_)/.test(ref)&&!seen.has(ref.toLowerCase())){
   seen.add(ref.toLowerCase());const name=ref.split('/').at(-1).split('.')[0];
   if(name.startsWith('GA_'))found.add(name.toLowerCase());
   let o=s.object(ref);if(!o&&value.AssetPathName)o=[...s.objects.values()].find(o=>o.Package?.toLowerCase()===ref.split('.')[0].toLowerCase()&&o.Name.startsWith('Default__'));
   if(o?.ClassDefaultObject)o=s.object(o.ClassDefaultObject);
   if(o)scan(s.properties(o.ref));
  }
  for(const child of Object.values(value))if(typeof child==='object')scan(child);
 }
 scan({BehaviorComponent:n.properties.BehaviorComponentClass,Abilities:n.properties.Abilities,Effects:n.properties.PassiveGameplayEffects,Idle:n.properties.CustomIdlePhase});
 grants.set(idOf(n),found);
}
for(const table of s.tables.filter(t=>t.type==='DataTable'))for(const [rowName,row]of Object.entries(table.rows)){
 if(!row.GameplayAbilityAsset)continue;
 const asset=row.GameplayAbilityAsset.AssetPathName,name=asset?.split('.').at(-1)?.replace(/_C$/,'')??rowName.replace(/_C$/,'');
 if(!name?.startsWith('GA_'))continue;
 const a=abilityByName.get(name.toLowerCase()),p=a?.properties??{};
 const owner=ownerKeys.find(o=>clean(name.replace(/^GA_/,'' )).startsWith(o.key))??ownerKeys.find(o=>clean(table.name.replace(/^DT_(?:NPC_)?/,'' )).startsWith(o.key));
 const owners=new Set([...grants].filter(([,names])=>names.has(name.toLowerCase())).map(([id])=>id));if(owner)owners.add(owner.id);
 if(!owners.size)continue;
 const cast=p['Casting Data'],channel=p['Channeling Data'];
 const description=s.text(row.DynamicDescription?.Text)||s.text(row.DetailedDescription)||s.text(row.TutorialDescription)||null;
 for(const parentId of owners)abilities.set(parentId+':'+name,{id:owners.size>1?parentId+':'+name:name,parentId,name:s.text(row.Name),description,
 baseCooldownSeconds:s.scalable(p.CooldownDuration??p.Cooldown),castInterruptibility:cast?.Interruptible===true?'always':cast?.Interruptible===false?'never':'unknown',
 liveStatus:row.EnabledInGame?'live':'inactive',images:[],sourcePath:a?.source??table.source,
 actionProfile:{castTimeSeconds:s.scalable(cast?.CastingDuration),channelTimeSeconds:s.scalable(channel?.ChannelingDuration)},descriptionTokens:row.DynamicDescription?.Tokens??[]});
}
// Keep public icon URLs stable, but rebuild every pixel from game-owned textures.
const modifierInfo=s.tables.find(t=>t.name==='DT_ModifierInfo').rows;
const relicAbilities=s.tables.find(t=>t.name==='DT_AbilityData_RelicPowers').rows;
const checkpoint=Object.values(s.tables.find(t=>t.name==='DT_DungeonMapItems').rows).find(r=>r.MapItemCategory.TagName==='DungeonMap.ItemCategory.Checkpoint');
for(const [destination,ref]of [
 ['images/modifiers/empowered-minions.avif',modifierInfo.EmpoweredMinions.UIIcon],
 ['images/modifiers/shadow-lord.avif',modifierInfo.ShadowLord.UIIcon],
 ['images/modifiers/winter-giant.avif',modifierInfo.WinterGiant.UIIcon],
 ['images/modifiers/winter-witch.avif',modifierInfo.WinterWitch.UIIcon],
 ['images/pois/bonfire.avif',checkpoint.MapIcon],
 ['images/hero-items/relic-b-crit-portal-hero-item-200.avif',relicAbilities.GA_RelicPower_Portal.UIIconTexture.ResourceObject],
 ['images/hero-items/relic-b-expertise-groupinvisibility-hero-item-200.avif',relicAbilities.GA_RelicPower_PartyInvisibility.UIIconTexture.ResourceObject],
 ['images/relics/ga-relicpower-polymorphtargetwithsharedcharges-relic-200.avif',relicAbilities.GA_RelicPower_PolymorphTargetWithSharedCharges.UIIconTexture.ResourceObject],
])assert.ok(picture(ref,destination,'ui','200',destination),'Missing UI icon '+destination);
function write(name,data){fs.writeFileSync(out+'/'+name+'.json',JSON.stringify(data,null,2)+'\n');}
write('enemies',enemies);write('dungeons',dungeons);write('heroes',heroes);write('abilities',[...abilities.values()].sort((a,b)=>a.id.localeCompare(b.id)));
write('game-map-frames',frames);write('game-image-sources',imageSources);
write('manifest',{schemaVersion:1,buildId:s.manifest.steamBuild,source:'installed-game',data:{enemies:enemies.length,dungeons:dungeons.length,heroes:heroes.length,abilities:abilities.size},sourceManifestSha256:sha(fs.readFileSync(gamePlannerRoot+'/manifest.json'))});
fs.mkdirSync('private/reports',{recursive:true});
fs.writeFileSync('private/reports/game-catalog-evidence.json',JSON.stringify({steamBuild:s.manifest.steamBuild,warnings,nativeMapFrames:Object.values(frames).reduce((n,areas)=>n+Object.keys(areas).length,0),bossTagExceptions:[...bossesWithoutTag]},null,2)+'\n');
fs.writeFileSync(out+'/game-modifier-stats.js','// Generated from installed-game NPC attribute curves.\nexport const modifierStats='+JSON.stringify(Object.fromEntries([['ghorn','dm-wintergiant'],['witch','dm-winterwitch']].map(([kind,id])=>{const e=enemies.find(e=>e.id===id);return[kind,{baseHealth:e.baseHealth,dungeonScore:e.dungeonScore,sourceId:id}];})))+';\n');
fs.mkdirSync('tmp/game-catalog-migration',{recursive:true});fs.writeFileSync('tmp/game-catalog-migration/image-jobs.json',JSON.stringify([...jobs.values()]));
console.log(JSON.stringify({enemies:enemies.length,abilities:abilities.size,heroes:heroes.length,dungeons:dungeons.length,images:jobs.size,warnings}));
