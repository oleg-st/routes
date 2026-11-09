import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LoroDoc} from 'loro-crdt';
import {modifierAvailable} from '../game-scoring.js';
import {gameServiceRules as rules} from '../data/game-service-rules.js';
import {newRoute,validateRoute,applyModifierPresets,toggleModifier,scoreRoute} from '../route-model.js';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
const dungeons=read('dungeons'),enemies=new Map(read('enemies').map(e=>[e.id,e])),presets=read('modifier-placements');
test('Current rotation exposes exactly the exported modifier availability',()=>{
 assert.deepEqual(Object.keys(rules.modifierAvailabilityByDungeon).sort(),dungeons.map(d=>d.id).sort());
 assert.ok(Object.entries(rules.modifierAvailabilityByDungeon).filter(([id])=>id!=='Level.ID.SandTomb').every(([,v])=>v.empowered&&v.shadow&&v.witch));
 assert.deepEqual(rules.modifierAvailabilityByDungeon['Level.ID.SandTomb'],{witch:false,ghorn:false,empowered:false,shadow:false});
 assert.deepEqual(Object.entries(rules.modifierAvailabilityByDungeon).filter(([,v])=>!v.ghorn).map(([id])=>id),['Level.ID.FrozenKingdom','Level.ID.PirateRaid','Level.ID.SandTomb','Level.ID.SnowPeak']);
 assert.equal(modifierAvailable('Level.ID.SandTomb','witch'),false);
});
test('Legacy imports disable unavailable modifiers while preserving ordinary route content',()=>{
 for(const dungeon of dungeons){
  const route=newRoute(dungeon,dungeon.routeBuildId??'test');applyModifierPresets(route,dungeon,presets);
  route.shadow=true;
  for(const mod of Object.values(route.modifiers))if(mod.packId||mod.enemies?.length)mod.active=true;
  route.pulls[0].enemies=[dungeon.enemies[0].placementId];
  const loaded=validateRoute(route,dungeons,enemies);
  assert.deepEqual(loaded.pulls,route.pulls);
  assert.equal(loaded.shadow,modifierAvailable(dungeon.id,'shadow'));
  for(const kind of ['witch','ghorn','empowered'])assert.equal(loaded.modifiers[kind].active,route.modifiers[kind].active&&modifierAvailable(dungeon.id,kind));
 }
 const dungeon=dungeons.find(d=>d.id==='Level.ID.SnowPeak'),route=newRoute(dungeon,dungeon.routeBuildId??'test');
 applyModifierPresets(route,dungeon,presets);
 toggleModifier(route,'ghorn');assert.equal(route.modifiers.ghorn.active,false);
 toggleModifier(route,'witch');assert.equal(route.modifiers.witch.active,true);
});
test('Commands and restored CRDT cannot enable an unavailable Ghorn',t=>{
 const dungeon=dungeons.find(d=>d.id==='Level.ID.FrozenKingdom'),options={dungeon,enemies,role:'player'};
 const route=newRoute(dungeon,dungeon.routeBuildId);applyModifierPresets(route,dungeon,presets);route.modifiers.ghorn.active=true;
 const doc=createRouteDocument(route,options);t.after(()=>doc.dispose());
 assert.equal(route.modifiers.ghorn.active,true);assert.equal(doc.snapshot().modifiers.ghorn.active,false);
 const before=doc.canonical();assert.throws(()=>doc.execute({type:'set-modifier',kind:'ghorn',patch:{active:true}}),/unavailable/);assert.equal(doc.canonical(),before);
 const packet=doc.exportSnapshot(),raw=new LoroDoc();raw.import(packet.bytes);raw.getMap('modifiers').get('ghorn').set('active',true);raw.commit();
 const restored=restoreRouteDocument({...packet,bytes:raw.export({mode:'snapshot'})},options);t.after(()=>restored.dispose());t.after(()=>raw.free());
 assert.equal(restored.snapshot().modifiers.ghorn.active,false);
});
