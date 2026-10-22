import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {mapViews, mapCoordinates} from '../map-views.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {newRoute,encodeRoute} from '../route-model.js';
import {expandDungeons} from '../data/compact-data.js';
import {enemyAbilities} from '../data/ability-corrections.js';

test('Published site omits layer controls and private images while preserving saved drawing frames', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-site.mjs'], {encoding:'utf8'});
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.ok(!fs.existsSync('dist/private'));
  assert.ok(!fs.existsSync('dist/data/game-dungeons.js'),'Runtime uses one dungeon dataset without a second geometry copy');
  for(const name of ['custom-dungeons.js','buried-placements.js','patrol-corrections.js','game-image-sources.json','game-catalog-evidence.json','game-map-frames.json'])
    assert.ok(!fs.existsSync(`dist/data/${name}`),`Authoring or retired data must not be published: ${name}`);
  assert.equal(fs.readFileSync('dist/local-map-views.js','utf8'),"export {mapViews} from './map-views.js';\n");
  assert.doesNotMatch(fs.readFileSync('dist/app.js','utf8'),/background-user\.(?:png|avif)|Retouched/);
  assert.ok(!fs.existsSync('dist/images/dungeons/full'));
  assert.equal(fs.readdirSync('dist/images/dungeons/maps').length,5);
  assert.doesNotMatch(fs.readFileSync('dist/index.html','utf8'), /id="(?:floor-panel|floors|floor-panel-option|show-floor-panel)"/);
  for(const file of ['combined-layouts.js']){
    assert.doesNotMatch(fs.readFileSync(`dist/data/${file}`,'utf8'), /private\/|images\/dungeons\/maps\//);
  }
  assert.doesNotMatch(fs.readFileSync('dist/data/full-maps.js','utf8'), /private\/|Referenced|images\/dungeons\/full/);
  const published = await import('../dist/map-views.js');
  const publishedRoutes = await import('../dist/route-model.js');
  const dungeons = JSON.parse(fs.readFileSync('data/dungeons.json')).map(correctDungeon);
  const publicCorrect=(await import('../dist/data/placement-corrections.js')).correctDungeon;
  const publicDungeons=expandDungeons(JSON.parse(fs.readFileSync('dist/data/dungeons.json'))).map(publicCorrect);
  const sourceAbilities=JSON.parse(fs.readFileSync('data/abilities.json'));
  const publicAbilities=JSON.parse(fs.readFileSync('dist/data/abilities.json'));
  const publicEnemies=new Map(JSON.parse(fs.readFileSync('dist/data/enemies.json')).map(enemy=>[enemy.id,enemy]));
  const abilityFields=['id','parentId','name','description','castInterruptibility','baseCooldownSeconds','liveStatus'];
  const abilityView=ability=>Object.fromEntries(abilityFields.filter(key=>key in ability).map(key=>[key,ability[key]]));
  const bytes=directory=>fs.readdirSync(directory).reduce((sum,file)=>sum+fs.statSync(`${directory}/${file}`).size,0);
  // Eleven dungeons include Xul and distinct paths for offset patrol columns.
  assert.ok(bytes('dist/data')<5_000_000,'Published data stays within its 5 MB budget');
  assert.ok(bytes('dist/data')<bytes('data')*.4,'Published data must be at least 60% smaller');
  const enemies = new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(enemy=>[enemy.id,enemy]));
  for (const dungeon of dungeons) {
    const publicDungeon=publicDungeons.find(d=>d.id===dungeon.id);
    assert.deepEqual(publicDungeon.enemies,dungeon.enemies,'Patrols, IDs and coordinates round-trip exactly');
    const transferRoute=newRoute(dungeon,dungeon.routeBuildId??'test');transferRoute.pulls[0].enemies=dungeon.enemies.slice(0,5).map(e=>e.placementId);
    const transferred=await publishedRoutes.decodeRoute(await encodeRoute(transferRoute,dungeon),publicDungeons,publicEnemies);
    assert.deepEqual(transferred.pulls[0].enemies,transferRoute.pulls[0].enemies);
    assert.equal(publicDungeon.requiredScore,dungeon.requiredScore);
    for(const id of new Set(dungeon.enemies.map(enemy=>enemy.id))){
      const source=enemies.get(id),compact=publicEnemies.get(id);
      for(const key of ['id','name','dungeonScore','baseHealth','isBoss','canBeControlled'])assert.deepEqual(compact[key],source[key]);
      const image=source.images?.find(image=>image.size==='200')||source.images?.[0];
      assert.equal(compact.images[0]?.path,image?.path);
      assert.deepEqual(enemyAbilities(publicAbilities,id),enemyAbilities(sourceAbilities,id).map(abilityView));
    }
    const local = mapViews(dungeon), views = published.mapViews(publicDungeon);
    assert.equal(views.length,1);
    assert.ok(fs.existsSync('dist/'+views[0].path));
    assert.ok(views.every(view => view.name !== 'Referenced' && !view.path.startsWith('private/')));
    if (dungeon.mapImages.length === 1) continue;
    assert.equal(views[0].name, 'Full map');
    assert.equal(local[1].name, 'Referenced');
    const route=newRoute(dungeon,dungeon.routeBuildId??'test');
    route.drawings=[{id:'reference-note',mapId:local[1].id,kind:'note',points:[[100,100]],color:'#abcdef',text:'Shared reference note'}];
    for(const layer of dungeon.mapImages){
      route.drawings.push({id:layer.id,mapId:layer.id,kind:'note',points:[[layer.width/2,layer.height/2]],color:'#abcdef',text:'Original layer note'});
    }
    const imported=publishedRoutes.validateRoute(route,publicDungeons,publicEnemies);
    assert.deepEqual(published.drawingOnMap(imported.drawings[0],views[0],publicDungeon).points,[[100,100]]);
    for(const drawing of imported.drawings){
      assert.deepEqual(published.drawingOnMap(drawing,views[0],publicDungeon), (await import('../map-views.js')).drawingOnMap(drawing,local[0],dungeon));
    }
    for (const enemy of dungeon.enemies.filter(enemy => enemy.mapPosition)) {
      assert.deepEqual(published.mapCoordinates(enemy, views[0]), mapCoordinates(enemy, local[0]));
    }
  }
});
