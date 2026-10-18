import fs from 'node:fs';
import assert from 'node:assert/strict';
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
// prepare-game-services. Values below always come from the current export.
export function gameScoringRules(s){
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
 assert.ok(curve.Keys.length&&curve.Keys.every((k,i)=>k.Time===i+1),'Health difficulty table must have consecutive level samples');
 // Native GetDifficultyScales indexes the attribute-value array at difficulty;
 // UE attribute defaults arrays start with curve level 1 at index 0.
 const orb=defaults('GA_DungeonModifiers_ShadowLord_OrbSpawner');
 const shadowOrbsPerLord=s.scalable(orb.NumOrbsRequiredForLordSpawn);
 const shadowLordsByDungeon=Object.fromEntries(s.read('dungeons').playable.map(d=>[d.id,Math.trunc(s.scalable(d.info.LevelType.endsWith('::Adventure')?orb.NumLordsToSpawn_Adventure:orb.NumLordsToSpawn_Dungeon))]));
 assert.ok(shadowOrbsPerLord>0&&Object.values(shadowLordsByDungeon).every(n=>n>0));
 const polymorph=defaults('GA_RelicPower_PolymorphTargetWithSharedCharges');
 const markerHealthThresholds={medium:s.scalable(polymorph.HealthThresholdMedium),large:s.scalable(polymorph.HealthThresholdLarge)};
 const markerDefaultBaseHealth=s.curve('Default.BasicAttributeSet.BaseHealth');
 assert.ok(markerDefaultBaseHealth>0,'Missing default base health for Polymorph sizes');
 assert.ok(markerHealthThresholds.medium>0&&markerHealthThresholds.large>markerHealthThresholds.medium,'Invalid Polymorph size thresholds');
 return {empoweredScoreMultiplier:s.scalable(score.ModifierMagnitude.ScalableFloatMagnitude),empoweredHealthBonus:s.scalable(magnitude.Coefficient),modifierDifficultyCap:cap,difficultyHealthScales:curve.Keys.map(k=>k.Value),shadowOrbsPerLord,shadowLordsByDungeon,modifierAvailabilityByDungeon:gameModifierAvailability(s),markerHealthThresholds,markerDefaultBaseHealth};
}
