import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createDraft,draftRecipe,recipeModule,validateDraft,draftBounds} from '../scripts/map-editor/model.mjs';
import {loadEditorCatalog} from '../scripts/map-editor/catalog.mjs';
const dungeon={id:'Level.ID.NewMap',mapImages:[{id:'Level.ID.NewMap:a'},{id:'Level.ID.NewMap:b'}]};
test('Editor starts from game coordinate frames and exports independent geometry/artwork transforms',async()=>{
  const draft=createDraft(dungeon,{'Level.ID.NewMap:a':{calibration:{sx:100,sy:-100,ox:0,oy:100}},'Level.ID.NewMap:b':{calibration:{sx:200,sy:-200,ox:100,oy:100}}});
  assert.deepEqual(draft.layers[1].at,[1024,0]);assert.equal(draft.layers[1].scale,2);
  draft.layers[1].at=[250,75];draft.layers[1].outline=[[20,20],[500,30],[300,400]];
  const recipe=draftRecipe(draft,dungeon);assert.equal(recipe.referenceFrame,undefined);assert.deepEqual(recipe.layers[1].at,[250,75]);
  const module=await import('data:text/javascript;base64,'+Buffer.from(recipeModule(draft,dungeon)).toString('base64'));
  assert.deepEqual(module.default,recipe);assert.ok(draftBounds(draft).every(Number.isFinite));
});
test('Editor refuses missing layers, invalid transforms and degenerate contours before save/export',()=>{
  const draft=createDraft(dungeon);draft.layers[0].scale=NaN;assert.throws(()=>validateDraft(draft,dungeon),/transform/);
  draft.layers[0].scale=1;draft.layers[0].outline=[[0,0],[1,1],[2,2]];assert.throws(()=>validateDraft(draft,dungeon),/zero area/);
  draft.layers[0].outline=[[0,0],[500,0],[500,400]];draft.layers[1].suffix='a';assert.throws(()=>validateDraft(draft,dungeon),/transform/);
});
test('Cutouts export as sharp masks for both terrain and context; old drafts remain valid',async()=>{
  const draft=createDraft(dungeon);delete draft.layers[0].exclude;assert.equal(validateDraft(draft,dungeon),draft);
  const hole=[[100,100],[300,100],[300,250],[100,250]];draft.layers[1].exclude=[hole];
  const recipe=draftRecipe(draft,dungeon);assert.deepEqual(recipe.layers[1].exclude,[hole]);
  assert.equal(recipe.layers[1].seamFeather,0);assert.equal(recipe.layers[1].contextSeamFeather,0);
  const restored=await import('data:text/javascript;base64,'+Buffer.from(recipeModule(draft,dungeon)).toString('base64'));
  assert.deepEqual(restored.default.layers[1].exclude,[hole]);
  draft.layers[1].exclude=[[[0,0],[10,10]]];assert.throws(()=>validateDraft(draft,dungeon),/Cutout/);
});
test('A new plugin map is available directly from a new raw build without stale public markers',t=>{
  const parent=path.resolve('tmp/map-editor-catalog-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'case-'));
  t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
  const prefix='private/game-data/planner/',source='fellowship/Plugins/GameFeatures/Adventures/Future/Content/T_Map_Future.uasset';
  write(prefix+'dungeons.json',{steamBuild:'new',playable:[{id:'Level.ID.Future',key:'Future',info:{DisplayName:{TableId:'Names',Key:'Future'}}}]});
  write(prefix+'map-objects.json',[{type:'BP_DungeonMapAreaBox_C',source:'fellowship/Plugins/GameFeatures/Adventures/Future/Content/Future.umap',properties:{DungeonAreaTexture:{ObjectPath:'/Future/T_Map_Future.0',ObjectName:"Texture2D'T_Map_Future'"}},rootComponent:{properties:{RelativeLocation:{X:10,Y:20,Z:0},BoxExtent:{X:50,Y:100,Z:100}}}}]);
  write(prefix+'images.json',{images:[{source,output:'images/new.png',sha256:'h',width:4096,height:2048}]});
  write(prefix+'textures-manifest.json',{results:[{Source:source,Output:'texture.json'}]});
  write(prefix+'texture.json',{Package:'/Future/T_Map_Future'});write(prefix+'localization.json',[{table:'Names',rows:[['Future','New dungeon']]}]);
  write('data/manifest.json',{buildId:'old'});
  const catalog=loadEditorCatalog(root);assert.equal(catalog.build,'new');assert.equal(catalog.dungeons[0].name,'New dungeon');
  assert.equal(catalog.dungeons[0].mapImages[0].id,'Level.ID.Future:T_Map_Future');assert.deepEqual(catalog.dungeons[0].enemies,[]);
  assert.ok(catalog.frames['Level.ID.Future']['Level.ID.Future:T_Map_Future']);
});
