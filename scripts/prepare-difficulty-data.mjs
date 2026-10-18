// Installed-game difficulty selection, affixes and summoned NPC attributes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadGameCatalogSource,readJson,sha} from './game-catalog-source.mjs';
import {npcCatalogId} from './game-catalog-actors.mjs';
const assets='private/game-data/all-dungeons/difficulty-assets.txt';
fs.writeFileSync(assets,'/Game/dungeons/DT_DifficultyToLevel\n/Game/MatchMaking/DT_GameFinderLeagues\n');
const extraction=spawnSync('dotnet',['private/game-data/extractor/bin/Debug/net10.0/Extractor.dll','--assets',assets],{stdio:'inherit',windowsHide:true});
if(extraction.error)throw extraction.error;assert.equal(extraction.status,0,'Difficulty export failed');
for(const result of readJson(assets+'.status.json'))assert.ok(!result.Error&&!result.Diagnostics?.length,'Incomplete difficulty export');
const s=loadGameCatalogSource();
const levelFile='private/game-data/all-dungeons/dependencies/c48ce7a48162e26b0e57a39d89df15eedd3b248e1f9e30b28cdfec758b425066.json';
const leagueFile='private/game-data/all-dungeons/dependencies/5a7917ce3e1c57da05cc1d5701c81e93c52bd78e545668ad998226d79976e0d1.json';
const levels=readJson(levelFile).Objects.find(o=>o.Name==='DT_DifficultyToLevel').Rows;
const leagues=Object.values(readJson(leagueFile).Objects.find(o=>o.Name==='DT_GameFinderLeagues').Rows);
const eternal=leagues.find(l=>l.Type.endsWith('::Eternal')),pinnacle=leagues.find(l=>l.Type.endsWith('::Pinnacle'));
const offset=eternal.MinimumDifficulty-1,affixes=s.tables.find(t=>t.name==='DT_ModifersInDungeons').rows;
const tags={empowered:'EmpoweredMinions',ghorn:'WinterGiant',witch:'WinterWitch',shadow:'ShadowLord',stoneskin:'StoneSkin',ultimatum:'Ultimatum'};
const dungeons={};
for(const d of s.read('dungeons').playable){
 let choices;
 if(d.info.IsSeasonalPinnacleDungeon){
  // Difficulty gates for the extra Hard / Nightmare mechanics are game curve values.
  choices=[pinnacle.MinimumDifficulty,s.curve('AbilityUnlock.Pinnacle.Hard'),s.curve('AbilityUnlock.Pinnacle.Ultimate')].map((value,i)=>({value,label:['Normal','Hard','Nightmare'][i],modifiers:[]}));
 }else{
  const maximum=d.info.MaximumDifficulty??2147483647;
  choices=Object.entries(levels).filter(([level,row])=>Number(level)>offset&&Number(level)<=Math.min(maximum,offset+90)&&Object.values(row).includes(d.id)).map(([level])=>{
   // Gameplay tags are FNames: assignment tables spell StoneSkin as Stoneskin.
   const values=Object.values(affixes[d.key+'.'+level]??{}).map(tag=>tag.toLowerCase());
   assert.ok(values.length,'Missing affix assignment: '+d.key+'.'+level);
   return {value:Number(level),label:'E'+(Number(level)-offset),modifiers:Object.entries(tags).filter(([,tag])=>values.includes(('Modifiers.Dungeon.'+tag).toLowerCase())).map(([kind])=>kind)};
  });
 }
 assert.ok(choices.length&&choices.every(c=>Number.isInteger(c.value)),'Missing difficulties: '+d.id);
 dungeons[d.id]=choices;
}
for(const kind of ['stoneskin','ultimatum'])assert.ok(Object.values(dungeons).flat().some(c=>c.modifiers.includes(kind)),'Missing '+kind+' assignments');
const shadow=s.npcs.find(n=>n.properties.CharacterTags?.includes('ActorTypeTags.DungeonModifiers.ShadowLord'));
assert.ok(shadow,'Missing Shadow Lord NPC');
const value=key=>s.curve(shadow.characterId+'.'+key)??s.curve('Default.'+key);
const shadowBaseHealth=value('BasicAttributeSet.BaseHealth')*value('Custom.DefaultBaseHealthMultiplier');
assert.ok(shadowBaseHealth>0);
const healthSources=new Set();
const defaults=name=>{const o=[...s.objects.values()].find(o=>o.Name==='Default__'+name+'_C');assert.ok(o,'Missing '+name);healthSources.add(o.source);return s.properties(o.ref);};
const stone=defaults('GE_DungeonModifier_StoneSkin_EnemyMaxHealthbuff').Modifiers.find(m=>m.Attribute.AttributeName==='MaxHealth');
assert.ok(stone.ModifierOp.endsWith('AddFinal'));
const magnitude=stone.ModifierMagnitude.CustomMagnitude;
assert.match(magnitude.CalculationClassMagnitude.ObjectPath,/GEC_DM_CappedMaxHealth_Target\./);
assert.equal(s.scalable(magnitude.PreMultiplyAdditiveValue),0);
const ultimatum=defaults('GE_Ascension_BossBoost').Modifiers.find(m=>m.Attribute.AttributeName==='DifficultyHealthScale');
assert.ok(ultimatum.ModifierOp.endsWith('MultiplyCompound'));
const targets={};
for(const [kind,actor] of [['stoneskin','BP_DungeonModifier_StoneSkin'],['ultimatum','BP_Ascension_BossBoost']]){
 const rule=defaults(actor).ModifierDataList[0],{RequireTags,IgnoreTags}=rule.ApplicationTagRequirements;
 assert.equal(rule.BossMinionRule.split('::').at(-1),kind==='stoneskin'?'ExcludeBossMinions':'None');
 const matches=tags=>RequireTags.every(tag=>tags.some(t=>t===tag||t.startsWith(tag+'.')))&&!IgnoreTags.some(tag=>tags.some(t=>t===tag||t.startsWith(tag+'.')));
 targets[kind]=[...new Set(s.npcs.filter(n=>matches(n.properties.CharacterTags??[])).map(npcCatalogId))].sort();
}
const healthAffixRules={stoneSkinBonus:s.scalable(magnitude.Coefficient),stoneSkinFlatBonus:s.scalable(magnitude.PostMultiplyAdditiveValue),ultimatumMultiplier:s.scalable(ultimatum.ModifierMagnitude.ScalableFloatMagnitude),targets};
assert.ok(healthAffixRules.stoneSkinBonus>0&&healthAffixRules.ultimatumMultiplier>1);
fs.writeFileSync('data/game-difficulty.js','// Generated by scripts/prepare-difficulty-data.mjs from installed-game exports.\nexport const dungeonDifficulties='+JSON.stringify(dungeons)+';\nexport const shadowBaseHealth='+shadowBaseHealth+';\nexport const healthAffixRules='+JSON.stringify(healthAffixRules)+';\n');
fs.writeFileSync('scripts/difficulty-source.json',JSON.stringify({steamBuild:s.manifest.steamBuild,sources:[levelFile,leagueFile].map(file=>({file,sha256:sha(fs.readFileSync(file))})),eternalOffset:offset,shadowCharacterId:shadow.characterId,healthAffixSources:[...healthSources].map(source=>{const entry=s.manifest.results.find(r=>r.Source===source);assert.ok(entry,'Missing source '+source);return {source,sha256:entry.Sha256};})},null,2)+'\n');
