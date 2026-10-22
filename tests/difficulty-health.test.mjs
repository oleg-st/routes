import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LoroDoc} from 'loro-crdt';
import {difficultyOptions,applyDifficulty,defaultDifficulty,formatHealth,difficultyHealthModifiers} from '../difficulty.js';
import {newRoute,applyModifierPresets,encodeRoute,decodeRoute,routeHealth,shadowHealth,positionsHealth,placementHealth,enemyHealth,dungeonPackEfficiencies,hasRouteChanges} from '../route-model.js';
import {difficultyHealthScale} from '../game-scoring.js';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
import {correctDungeon} from '../data/placement-corrections.js';
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json')).map(correctDungeon);
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const presets=JSON.parse(fs.readFileSync('data/modifier-placements.json'));
function fixture(id='Level.ID.ElfMines',match=()=>true){
 const dungeon=dungeons.find(d=>d.id===id),route=newRoute(dungeon,dungeon.routeBuildId??'test');
 route.difficulty=difficultyOptions(id).find(match).value;applyDifficulty(route);applyModifierPresets(route,dungeon,presets);
 return {dungeon,route};
}
test('Each dungeon offers only its game difficulties, within the new E1–E32 rotation',()=>{
 for(const d of dungeons){const options=difficultyOptions(d.id);assert.ok(options.length);assert.equal(new Set(options.map(o=>o.value)).size,options.length);assert.ok(options.every(o=>o.value>20&&o.value<=52));}
 assert.deepEqual(difficultyOptions('Level.ID.ElfMines').slice(0,3).map(c=>c.label),['E2','E5','E8']);
 assert.deepEqual(difficultyOptions('Level.ID.SandTomb'),[]);
});
test('Difficulty synchronizes, restores, undoes, and allows manual affix commands',()=>{
 const {route,dungeon}=fixture(),a=createRouteDocument(route,{dungeon,enemies});
 const b=restoreRouteDocument(a.exportSnapshot(),{dungeon,enemies,role:'player'});
 const selected=difficultyOptions(dungeon.id).find(c=>c.modifiers.includes('empowered'));
 a.execute({type:'set-difficulty',value:selected.value});b.import(a.exportSnapshot());
 assert.equal(b.snapshot().difficulty,selected.value);assert.equal(b.snapshot().modifiers.empowered.active,true);
 a.execute({type:'set-modifier',kind:'empowered',patch:{active:false}});
 a.execute({type:'set-meta',patch:{shadow:true}});
 b.import(a.exportSnapshot());
 assert.equal(b.snapshot().difficulty,selected.value);assert.equal(b.snapshot().modifiers.empowered.active,false);assert.equal(b.snapshot().shadow,true);
 a.undo();a.undo();
 assert.throws(()=>a.execute({type:'set-difficulty',value:21}),/unavailable/);
 a.undo();assert.equal(a.snapshot().difficulty,route.difficulty);a.redo();assert.equal(a.snapshot().difficulty,selected.value);
 a.execute({type:'clear-route'});assert.equal(a.snapshot().difficulty,selected.value);assert.deepEqual(a.snapshot().modifiers.empowered.enemies,route.modifiers.empowered.enemies.sort());
 a.dispose();b.dispose();
});
test('Custom affixes retain difficulty, affect HP, and survive reload and compact sharing',async()=>{
 const {route,dungeon}=fixture('Level.ID.ElfMines',c=>c.modifiers.includes('empowered'));
 route.pulls[0].enemies=[...route.modifiers.empowered.enemies];
 const doc=createRouteDocument(route,{dungeon,enemies}),before=routeHealth(doc.snapshot(),dungeon,enemies).mobs;
 doc.execute({type:'set-modifier',kind:'empowered',patch:{active:false}});
 doc.execute({type:'set-meta',patch:{shadow:!route.shadow}});
 const custom=doc.snapshot();
 assert.ok(routeHealth(custom,dungeon,enemies).mobs<before);
 const decoded=await decodeRoute(await encodeRoute(custom,dungeon),dungeons,enemies);
 const loaded=createRouteDocument(decoded,{dungeon,enemies});
 const restored=restoreRouteDocument(doc.exportSnapshot(),{dungeon,enemies});
 for(const state of [decoded,loaded.snapshot(),restored.snapshot()]){
  assert.equal(state.difficulty,route.difficulty);assert.equal(state.modifiers.empowered.active,false);assert.equal(state.shadow,custom.shadow);
 }
 doc.execute({type:'clear-route'});assert.equal(doc.snapshot().shadow,custom.shadow);assert.equal(doc.snapshot().modifiers.empowered.active,false);
 doc.execute({type:'set-difficulty',value:null});assert.equal(doc.snapshot().shadow,custom.shadow);assert.equal(doc.snapshot().modifiers.empowered.active,false);
 doc.execute({type:'set-difficulty',value:route.difficulty});assert.equal(doc.snapshot().modifiers.empowered.active,true);assert.equal(doc.snapshot().shadow,route.shadow);
 doc.dispose();loaded.dispose();restored.dispose();
});
test('Old difficulty-derived documents keep their displayed defaults until an affix is edited',()=>{
 const {route,dungeon}=fixture('Level.ID.ElfMines',c=>c.modifiers.includes('empowered'));
 const original=createRouteDocument(route,{dungeon,enemies}),packet=original.exportSnapshot(),legacy=new LoroDoc();
 legacy.import(packet.bytes);legacy.getMap('meta').delete('manualAffixes');
 legacy.getMap('modifiers').get('empowered').set('active',false);legacy.commit();
 const doc=restoreRouteDocument({...packet,bytes:legacy.export({mode:'snapshot'})},{dungeon,enemies,role:'player'});
 assert.equal(doc.snapshot().modifiers.empowered.active,true);
 doc.execute({type:'set-meta',patch:{shadow:!route.shadow}});
 assert.equal(doc.snapshot().modifiers.empowered.active,true);assert.equal(doc.snapshot().shadow,!route.shadow);
 doc.execute({type:'set-modifier',kind:'empowered',patch:{active:false}});
 assert.equal(doc.snapshot().modifiers.empowered.active,false);
 doc.undo();doc.undo();assert.equal(doc.snapshot().modifiers.empowered.active,true);assert.equal(doc.snapshot().shadow,route.shadow);
 original.dispose();doc.dispose();legacy.free();
});
test('Compact route round trip retains difficulty and dirty state sees difficulty changes',async()=>{
 const {route,dungeon}=fixture();assert.equal(hasRouteChanges(route),true);
 const restored=await decodeRoute(await encodeRoute(route,dungeon),dungeons,enemies);
 assert.equal(restored.difficulty,route.difficulty);assert.deepEqual(restored.modifiers,route.modifiers);
 const saved=structuredClone(route);route.difficulty=difficultyOptions(dungeon.id)[1].value;applyDifficulty(route);
 assert.equal(hasRouteChanges(route,saved),true);
});
test('Changing replacement difficulty preserves the selected pack and can be undone',()=>{
 const {route,dungeon}=fixture('Level.ID.ElfMines',c=>c.modifiers.includes('ghorn'));
 route.pulls[0].enemies=['modifier:ghorn'];
 const doc=createRouteDocument(route,{dungeon,enemies});
 doc.execute({type:'set-difficulty',value:difficultyOptions(dungeon.id).find(c=>!c.modifiers.includes('ghorn')).value});
 assert.ok(route.modifiers.ghorn.replacedEnemies.every(id=>doc.snapshot().pulls[0].enemies.includes(id)));
 assert.equal(doc.snapshot().modifiers.ghorn.active,false);
 doc.undo();assert.deepEqual(doc.snapshot().pulls[0].enemies,['modifier:ghorn']);assert.equal(doc.snapshot().modifiers.ghorn.active,true);
 doc.dispose();
});
test('Route HP counts bosses, Chicken and replacements, excludes replaced actors and deduplicates',()=>{
 const {route,dungeon}=fixture('Level.ID.ElfMines',c=>c.modifiers.includes('ghorn'));
 const boss=dungeon.enemies.find(p=>enemies.get(p.id)?.isBoss),mob=dungeon.enemies.find(p=>!enemies.get(p.id)?.isBoss&&!route.modifiers.ghorn.replacedEnemies.includes(p.placementId));
 route.pulls[0].enemies=[boss.placementId,boss.placementId,mob.placementId,...route.modifiers.ghorn.replacedEnemies,'modifier:ghorn'];
 const beforeChicken=routeHealth(route,dungeon,enemies);
 route.excluded=[mob.placementId];
 const result=routeHealth(route,dungeon,enemies);
 assert.notEqual(result.total,beforeChicken.total,'Chicken substitutes its own HP in route totals and DPS');
 const expected=enemyHealth(enemies.get(boss.id),{difficulty:route.difficulty})+placementHealth(mob,enemies.get(mob.id),route)+enemyHealth({baseHealth:25102.40974},{difficulty:route.difficulty});
 assert.equal(result.total,expected);assert.equal(result.dps,expected/dungeon.timerSeconds);
 route.pulls[0].enemies.push('unknown');assert.equal(routeHealth(route,dungeon,enemies).total,null);
});
test('Shadow spawn HP is attached to the spawning pull and included once in route totals',()=>{
 const {route,dungeon}=fixture('Level.ID.ElfMines',c=>c.modifiers.includes('shadow'));
 route.pulls[0].enemies=dungeon.enemies.map(p=>p.placementId);
 const result=routeHealth(route,dungeon,enemies);
 assert.equal(result.shadow,2*shadowHealth(route));assert.equal(result.pulls[0].shadow,result.shadow);
 assert.equal(result.total,result.mobs+result.shadow);
});
test('Efficiency and grouped HP use selected difficulty and the empowered cap',()=>{
 const dungeon={id:'test',requiredScore:10,enemies:[{id:'a',placementId:'a',packId:'a'}]},catalog=new Map([['a',{baseHealth:100,dungeonScore:1}]]),route=newRoute(dungeon,dungeon.routeBuildId??'test');
 route.difficulty=50;route.modifiers.empowered={active:true,enemies:['a']};
 const hp=positionsHealth(dungeon.enemies,catalog,route);
 assert.equal(hp,enemyHealth(catalog.get('a'),{difficulty:50,empowered:true}));
 assert.equal(hp,2*enemyHealth(catalog.get('a'),{difficulty:50}));
 assert.deepEqual(dungeonPackEfficiencies(dungeon,catalog,route),dungeonPackEfficiencies(dungeon,catalog,route,{difficulty:50}));
 assert.equal(positionsHealth([...dungeon.enemies,...dungeon.enemies],catalog,route),hp);
 route.excluded=['a'];
 const chickenHP=placementHealth(dungeon.enemies[0],catalog.get('a'),route);
 assert.notEqual(chickenHP,hp,'Chicken substitutes its own template');
 route.modifiers.empowered.active=false;
 assert.equal(positionsHealth(dungeon.enemies,catalog,route),chickenHP,'Original Empowered HP is not transferred');
});
test('Health formatting uses readable suffixes and does not turn unknown values into zero',()=>{
 assert.equal(formatHealth(744440),'744.44k');assert.equal(formatHealth(1350000),'1.35m');assert.equal(formatHealth(null),'—');assert.equal(formatHealth(0),'0');assert.equal(formatHealth(999999),'1.00m');
});

test('Selected Stone Skin and Ultimatum affect eligible HP, route totals, DPS and efficiency',async()=>{
 for(const kind of ['stoneskin','ultimatum']){
  const {route,dungeon}=fixture('Level.ID.DesertDunes',c=>c.modifiers.includes(kind));
  const boss=dungeon.enemies.find(p=>enemies.get(p.id).isBoss);
  const mob=dungeon.enemies.find(p=>difficultyHealthModifiers(route,p.id).stoneskin||(!enemies.get(p.id).isBoss&&!p.modifier));
  route.modifiers.empowered.active=false;route.modifiers.ghorn.active=false;route.modifiers.witch.active=false;
  route.pulls[0].enemies=[mob.placementId,boss.placementId];
  const normalMob=enemyHealth(enemies.get(mob.id),{difficulty:route.difficulty}),normalBoss=enemyHealth(enemies.get(boss.id),{difficulty:route.difficulty});
  const expectedMob=normalMob+(difficultyHealthModifiers(route,mob.id).stoneskin?enemies.get(mob.id).baseHealth*difficultyHealthScale(route.difficulty)*.3+1:0);
  const expectedBoss=normalBoss*(difficultyHealthModifiers(route,boss.id).ultimatum?1.1:1);
  assert.equal(placementHealth(mob,enemies.get(mob.id),route),expectedMob);
  assert.equal(placementHealth(boss,enemies.get(boss.id),route),expectedBoss);
  const health=routeHealth(route,dungeon,enemies);
  assert.equal(health.mobs,expectedMob+expectedBoss);assert.equal(health.total,health.mobs+health.shadow);assert.equal(health.dps,health.total/dungeon.timerSeconds);
  const plain={...route,dungeonId:'test'},ratings=dungeonPackEfficiencies(dungeon,enemies,route),baseline=dungeonPackEfficiencies(dungeon,enemies,plain);
  if(difficultyHealthModifiers(route,mob.id).stoneskin)assert.ok(ratings.values.get(mob.packId)<baseline.values.get(mob.packId));
  else assert.deepEqual(ratings,baseline);
  const restored=await decodeRoute(await encodeRoute(route,dungeon),dungeons,enemies);
  assert.equal(restored.difficulty,route.difficulty);assert.deepEqual(difficultyHealthModifiers(restored,mob.id),difficultyHealthModifiers(route,mob.id));
  assert.deepEqual(difficultyHealthModifiers(route,'dm-wintergiant'),{stoneskin:false,ultimatum:false});
  assert.deepEqual(difficultyHealthModifiers(route,'dm-winterwitch'),{stoneskin:false,ultimatum:false});
  assert.equal(difficultyHealthModifiers(route,mob.id,{isBossMinion:true}).stoneskin,false);
  delete route.difficulty;assert.deepEqual(difficultyHealthModifiers(route,mob.id),{stoneskin:false,ultimatum:false});assert.equal(routeHealth(route,dungeon,enemies).total,null);
 }
});
test('Unselected difficulty preserves manual affixes, skips HP and survives export and undo',async()=>{
 const {route,dungeon}=fixture('Level.ID.ElfMines',c=>c.modifiers.includes('empowered'));
 const doc=createRouteDocument(route,{dungeon,enemies});
 doc.execute({type:'set-difficulty',value:null});
 const manual=doc.snapshot();assert.equal(manual.difficulty,undefined);assert.equal(manual.modifiers.empowered.active,true);
 doc.execute({type:'set-modifier',kind:'empowered',patch:{active:false}});assert.equal(doc.snapshot().modifiers.empowered.active,false);
 const noCatalogue={get(){throw Error('Must not read health without difficulty');}};
 assert.equal(positionsHealth(dungeon.enemies,noCatalogue,manual),null);
 assert.deepEqual(routeHealth(manual,dungeon,noCatalogue),{pulls:[{mobs:null,shadow:null,total:null}],mobs:null,shadow:null,total:null,dps:null});
 assert.equal(shadowHealth(manual),null);
 const restored=await decodeRoute(await encodeRoute(manual,dungeon),dungeons,enemies);assert.equal(restored.difficulty,undefined);assert.equal(restored.modifiers.empowered.active,true);
 doc.undo();doc.undo();assert.equal(doc.snapshot().difficulty,route.difficulty);
 doc.redo();assert.equal(doc.snapshot().difficulty,undefined);
 doc.dispose();
 const fresh=newRoute(dungeon,dungeon.routeBuildId??'test');assert.equal(fresh.difficulty,undefined);assert.equal(hasRouteChanges(fresh),false);
});
