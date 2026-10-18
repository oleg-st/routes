import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LoroDoc} from 'loro-crdt';
import {gameModifierAvailability} from '../scripts/game-scoring-source.mjs';
import {modifierAvailable} from '../game-scoring.js';
import {gameServiceRules as rules} from '../data/game-service-rules.js';
import {newRoute,validateRoute,applyModifierPresets,toggleModifier,scoreRoute} from '../route-model.js';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
const dungeons=read('dungeons'),enemies=new Map(read('enemies').map(e=>[e.id,e])),presets=read('modifier-placements');

test('Availability uses exact dungeon keys and the union of difficulty rows',()=>{
 const source={tables:[{name:'DT_ModifersInDungeons',rows:{
  'Test.1':{Modifier1:'Modifiers.Dungeon.EmpoweredMinions'},
  'Test.12':{Modifier4:'Modifiers.Dungeon.ShadowLord'},
  'TestExtra.1':{Modifier1:'Modifiers.Dungeon.WinterWitch'},
 }}],read:()=>({playable:[{id:'test',key:'Test'},{id:'missing',key:'Missing'}]})};
 assert.deepEqual(gameModifierAvailability(source),{
  test:{witch:false,ghorn:false,empowered:true,shadow:true},
  missing:{witch:false,ghorn:false,empowered:false,shadow:false},
 });
 assert.throws(()=>gameModifierAvailability({...source,tables:[]}),/Missing dungeon modifier/);
 assert.equal(modifierAvailable('unknown','shadow'),false);
});

test('Published availability matches the installed game table', {skip:!fs.existsSync('private/game-data/planner/tables.json')},()=>{
 const source={tables:JSON.parse(fs.readFileSync('private/game-data/planner/tables.json')),read:()=>JSON.parse(fs.readFileSync('private/game-data/planner/dungeons.json'))};
 assert.deepEqual(rules.modifierAvailabilityByDungeon,gameModifierAvailability(source));
});

test('Known game assignments distinguish Pinnacle, dungeons and adventure mini-bosses',()=>{
 assert.deepEqual(Object.entries(rules.modifierAvailabilityByDungeon).filter(([,v])=>!v.shadow).map(([id])=>id),
  ['DemonicRitual','FrozenKingdom','PirateRaid','SandTomb','VikingVillageAttack'].map(k=>'Level.ID.'+k));
 assert.deepEqual(rules.modifierAvailabilityByDungeon['Level.ID.SandTomb'],{witch:false,ghorn:false,empowered:false,shadow:false});
 assert.equal(modifierAvailable('Level.ID.DesertDunes','witch'),false);
 assert.equal(modifierAvailable('Level.ID.DesertDunes','ghorn'),true);
 assert.equal(modifierAvailable('Level.ID.ShipGraveyard','witch'),true);
 assert.equal(modifierAvailable('Level.ID.ShipGraveyard','ghorn'),false);
 assert.equal(Object.values(rules.modifierAvailabilityByDungeon).filter(v=>v.empowered).length,14);
 assert.deepEqual(Object.keys(rules.modifierAvailabilityByDungeon).sort(),dungeons.map(d=>d.id).sort());
});

test('Legacy imports disable unavailable modifiers while preserving ordinary route content',()=>{
 for(const dungeon of dungeons){
  const route=newRoute(dungeon,'test');applyModifierPresets(route,dungeon,presets);
  route.shadow=true;
  for(const mod of Object.values(route.modifiers))if(mod.packId||mod.enemies?.length)mod.active=true;
  route.pulls[0].enemies=[dungeon.enemies[0].placementId];
  const loaded=validateRoute(route,dungeons,enemies);
  assert.deepEqual(loaded.pulls,route.pulls);
  assert.equal(loaded.shadow,modifierAvailable(dungeon.id,'shadow'));
  for(const kind of ['witch','ghorn','empowered'])assert.equal(loaded.modifiers[kind].active,route.modifiers[kind].active&&modifierAvailable(dungeon.id,kind));
 }
 const dungeon=dungeons.find(d=>d.id==='Level.ID.ShipGraveyard'),route=newRoute(dungeon,'test');
 applyModifierPresets(route,dungeon,presets);
 toggleModifier(route,'ghorn');assert.equal(route.modifiers.ghorn.active,false);
 toggleModifier(route,'witch');assert.equal(route.modifiers.witch.active,true);
});

test('Commands reject unavailable activation and restored old CRDT state cannot enable it',t=>{
 const dungeon=dungeons.find(d=>d.id==='Level.ID.SandTomb'),options={dungeon,enemies,role:'player'};
 const route=newRoute(dungeon,'test');route.shadow=true;route.modifiers.empowered={active:true,enemies:[dungeon.enemies[0].placementId]};
 const doc=createRouteDocument(route,options);t.after(()=>doc.dispose());
 assert.equal(route.shadow,true,'Import does not mutate the caller');
 assert.equal(doc.snapshot().shadow,false);assert.equal(doc.snapshot().modifiers.empowered.active,false);
 const before=doc.canonical();
 assert.throws(()=>doc.execute({type:'set-meta',patch:{shadow:true}}),/unavailable/);
 for(const kind of ['witch','ghorn','empowered'])assert.throws(()=>doc.execute({type:'set-modifier',kind,patch:{active:true}}),/unavailable/);
 assert.equal(doc.canonical(),before);
 const packet=doc.exportSnapshot(),raw=new LoroDoc();raw.import(packet.bytes);
 raw.getMap('meta').set('shadow',true);raw.getMap('modifiers').get('empowered').set('active',true);raw.commit();
 const restored=restoreRouteDocument({...packet,bytes:raw.export({mode:'snapshot'})},options);t.after(()=>restored.dispose());
 assert.equal(restored.snapshot().shadow,false);assert.equal(restored.snapshot().modifiers.empowered.active,false);
 assert.deepEqual(scoreRoute(restored.snapshot(),dungeon,enemies),scoreRoute(doc.snapshot(),dungeon,enemies));
});
