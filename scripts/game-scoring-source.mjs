import fs from 'node:fs';
import assert from 'node:assert/strict';
import {npcCatalogId} from './game-catalog-actors.mjs';
export function gameModifierAvailability(s){
 const table=s.tables.find(t=>t.name==='DT_ModifersInDungeons');
 assert.ok(table&&Object.keys(table.rows).length,'Missing dungeon modifier assignments');
 const tags={witch:'WinterWitch',ghorn:'WinterGiant',empowered:'EmpoweredMinions',shadow:'ShadowLord'};
 // Availability means assigned at any exported difficulty, not active at every difficulty.
 // Map actors alone are not evidence: dormant spawners also exist in other dungeons.
 return Object.fromEntries(s.read('dungeons').playable.map(d=>{
  const assigned=new Set(Object.entries(table.rows).filter(([key])=>key.startsWith(d.key+'.')).flatMap(([,row])=>Object.values(row)));
  return [d.id,Object.fromEntries(Object.entries(tags).map(([kind,tag])=>[kind,assigned.has('Modifiers.Dungeon.'+tag)]))];
 }));
}
// Interpreted formulas are guarded by reviewed Blueprint/native hashes in
// prepare-game-services. Values come from the current export, with any explicit
// provisional planner override preserved as separate provenance in the result.
export function gameScoringRules(s,semantics={}){
 const defaults=name=>{const o=[...s.objects.values()].find(o=>o.Name==='Default__'+name+'_C');assert.ok(o,'Missing '+name);return s.properties(o.ref);};
 const effect=defaults('GE_DungeonModifiers_EmpoweredMinions_EmpoweredEnemyBuff');
 const score=effect.Modifiers.find(m=>m.Attribute.AttributeName==='KillScore');
 const hp=effect.Modifiers.find(m=>m.Attribute.AttributeName==='MaxHealth');
 assert.ok(score.ModifierOp.endsWith('MultiplyCompound'));
 assert.ok(hp.ModifierOp.endsWith('AddFinal'));
 const magnitude=hp.ModifierMagnitude.CustomMagnitude;
 assert.match(magnitude.CalculationClassMagnitude.ObjectPath,/GEC_DM_CappedMaxHealth_Target\./);
 assert.equal(s.scalable(magnitude.PreMultiplyAdditiveValue),0);assert.equal(s.scalable(magnitude.PostMultiplyAdditiveValue),0);
 const raw=s.manifest.results.find(r=>r.Source.toLowerCase().endsWith('/config/defaultgame.ini'));
 assert.ok(raw,'Missing DefaultGame.ini');
 const ini=fs.readFileSync('private/game-data/planner/'+raw.Output,'utf8');
 const section=ini.split('[/Script/fellowship.CRFellowshipModifierSubsystem]')[1]?.split(/\r?\n\[/)[0];
 const cap=Number(section?.match(/^MaxModifierDifficultyScaleLimit\s*=\s*(-?\d+)/m)?.[1]);assert.ok(Number.isInteger(cap),'Missing modifier difficulty limit');
 const curve=s.tables.find(t=>t.name==='CT_CharacterScalingBaseAttributes').rows['Default.BasicAttributeSet.DifficultyHealthScale'];
 assert.ok(curve.Keys.length&&curve.Keys[0].Time===1&&curve.Keys.every((k,i)=>Number.isInteger(k.Time)&&(!i||k.Time>curve.Keys[i-1].Time)),'Invalid health difficulty curve');
 assert.ok(curve.InterpMode.endsWith('RCIM_Linear'),'Review changed health curve interpolation');
 // Attribute defaults sample the curve at every integer level. Sparse keys
 // (the new zero tail at levels 54–151) do not remove indexes from that array.
 const difficultyHealthScales=Array.from({length:curve.Keys.at(-1).Time},(_,i)=>s.curve('Default.BasicAttributeSet.DifficultyHealthScale',i+1));
 // Native GetDifficultyScales indexes the attribute-value array at difficulty;
 // UE attribute defaults arrays start with curve level 1 at index 0.
 const orb=defaults('GA_DungeonModifiers_ShadowLord_OrbSpawner');
 const shadowOrbsPerLord=s.scalable(orb.NumOrbsRequiredForLordSpawn);
 const shadowLordsByDungeon=Object.fromEntries(s.read('dungeons').playable.map(d=>[d.id,Math.trunc(s.scalable(d.info.LevelType.endsWith('::Adventure')?orb.NumLordsToSpawn_Adventure:orb.NumLordsToSpawn_Dungeon))]));
 assert.ok(shadowOrbsPerLord>0&&Object.values(shadowLordsByDungeon).every(n=>n>0));
 const polymorph=defaults('GA_RelicPower_PolymorphTargetWithSharedCharges');
 const chickenLimitsByDungeon=Object.fromEntries(s.read('dungeons').playable.map(d=>[d.id,s.scalable(d.info.LevelType.endsWith('::Adventure')?polymorph.MaximumChargeCount_Adventure:polymorph.MaximumChargeCount_Dungeon)]));
 assert.ok(Object.values(chickenLimitsByDungeon).every(n=>Number.isInteger(n)&&n>0),'Missing Polymorph shared charge limits');
 const markerHealthThresholds={medium:s.scalable(polymorph.HealthThresholdMedium),large:s.scalable(polymorph.HealthThresholdLarge)};
 const thresholdOverride=semantics.polymorphLargeThresholdOverride;
 if(thresholdOverride){
  // Keep the installed-game value intact in the export. This is an explicit,
  // provisional planner estimate until the server-side discrepancy is resolved.
  assert.equal(String(s.manifest.steamBuild),thresholdOverride.steamBuild,'Review provisional Polymorph threshold after a game update');
  assert.equal(markerHealthThresholds.large,thresholdOverride.exportedValue,'Exported Polymorph threshold changed; review the provisional override');
  assert.ok(Number.isFinite(thresholdOverride.value)&&thresholdOverride.value>markerHealthThresholds.medium,'Invalid provisional Polymorph threshold');
  markerHealthThresholds.large=thresholdOverride.value;
 }
 const markerDefaultBaseHealth=s.curve('Default.BasicAttributeSet.BaseHealth');
 assert.ok(markerDefaultBaseHealth>0,'Missing default base health for Polymorph sizes');
 assert.ok(markerHealthThresholds.medium>0&&markerHealthThresholds.large>markerHealthThresholds.medium,'Invalid Polymorph size thresholds');
 const polymorphChickens=Object.fromEntries(['small','medium','large'].map(size=>{
  const ref=polymorph['ChickenClass'+size[0].toUpperCase()+size.slice(1)]?.ObjectPath?.split('.')[0].toLowerCase();
  const npc=s.npcs.find(n=>n.ref.split('.')[0].toLowerCase()===ref);
  assert.ok(npc,'Missing Polymorph chicken template: '+size);
  const value=key=>s.curve(npc.characterId+'.'+key)??s.curve('Default.'+key);
  const baseHealth=value('BasicAttributeSet.BaseHealth')*value('Custom.DefaultBaseHealthMultiplier');
  assert.ok(baseHealth>0,'Missing Polymorph chicken HP: '+size);
  return [size,{id:npcCatalogId(npc),baseHealth}];
 }));
 return {empoweredScoreMultiplier:s.scalable(score.ModifierMagnitude.ScalableFloatMagnitude),empoweredHealthBonus:s.scalable(magnitude.Coefficient),modifierDifficultyCap:cap,difficultyHealthScales,shadowOrbsPerLord,shadowLordsByDungeon,modifierAvailabilityByDungeon:gameModifierAvailability(s),chickenLimitsByDungeon,markerHealthThresholds,markerDefaultBaseHealth,polymorphChickens,...(thresholdOverride?{polymorphLargeThresholdOverride:thresholdOverride}:{})};
}
