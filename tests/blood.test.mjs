import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bloodRules,placementBloodDrop,positionsBlood} from '../blood.js';
import {newRoute,newPull,bloodTimeline,effectivePositions,applyModifierPresets} from '../route-model.js';
import {mapViews,mapBloodTowers,mapCoordinates} from '../map-views.js';
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
const dungeon=dungeons.find(d=>d.id===bloodRules.dungeonId);
const presets=JSON.parse(fs.readFileSync('data/modifier-placements.json'));
const mob=id=>dungeon.enemies.find(p=>p.id===id);

test('Regath drops count blood content, independent of kill score and Empowered',()=>{
  const route=newRoute(dungeon),caster=mob('mc-bloodcaster');
  assert.deepEqual(Object.fromEntries(Object.entries(bloodRules.drops).map(([id,d])=>[id,d.blood])),{
    'mc-bloodcaster':5,'mc-bloodgrunt':1,'mc-bloodguard':2,'mc-bloodhound':1,'mc-bloodsummoner':8,
    'st-smallbloodelemental':3,'st-bigbloodelemental':12,
  });
  assert.equal(placementBloodDrop(caster,route).orbs,1);
  route.modifiers.empowered={active:true,enemies:[caster.placementId]};route.shadow=true;
  assert.equal(positionsBlood([caster,caster,undefined,mob('mc-bloodsummoner')],route),13);
  route.excluded=[caster.placementId];
  assert.equal(placementBloodDrop(caster,route),null);
  assert.equal(positionsBlood([caster,mob('mc-bloodsummoner')],route),8);
  assert.equal(placementBloodDrop({...caster,modifier:'witch'},newRoute(dungeon)),null);
  assert.equal(placementBloodDrop(caster,newRoute(dungeons[0])),null);
});

test('Regath includes blood from reused SandTomb enemies in mobs and pull totals',()=>{
  const route=newRoute(dungeon),echo=mob('st-smallbloodelemental'),heart=mob('st-bigbloodelemental');
  assert.equal(placementBloodDrop(echo,route).blood,3);
  assert.equal(placementBloodDrop(heart,route).blood,12);
  route.pulls[0].enemies=[mob('mc-bloodcaster'),mob('mc-bloodsummoner'),echo].map(p=>p.placementId);
  assert.deepEqual(bloodTimeline(route,dungeon),[{blood:16,total:16}]);
  route.excluded=[echo.placementId];
  assert.deepEqual(bloodTimeline(route,dungeon),[{blood:13,total:13}]);
  const sandTomb=dungeons.find(d=>d.id==='Level.ID.SandTomb');
  assert.equal(placementBloodDrop(echo,newRoute(sandTomb)),null,'Regath blood objective stays dungeon-specific');
});

test('Blood timeline follows pull order, removal, duplicates, Chicken and modifier replacements',()=>{
  const route=newRoute(dungeon),caster=mob('mc-bloodcaster'),oracle=mob('mc-bloodsummoner');
  route.pulls=[{...newPull(0),enemies:[caster.placementId]}, {...newPull(1),enemies:[oracle.placementId,caster.placementId,'missing']}];
  assert.deepEqual(bloodTimeline(route,dungeon),[{blood:5,total:5},{blood:8,total:13}]);
  route.pulls[1].enemies=[oracle.placementId];route.pulls.reverse();
  assert.deepEqual(bloodTimeline(route,dungeon),[{blood:8,total:8},{blood:5,total:13}]);
  route.excluded=[oracle.placementId];
  assert.deepEqual(bloodTimeline(route,dungeon),[{blood:0,total:0},{blood:5,total:5}]);
  route.pulls.pop();assert.deepEqual(bloodTimeline(route,dungeon),[{blood:0,total:0}]);
  const modified=newRoute(dungeon);applyModifierPresets(modified,dungeon,presets);
  modified.pulls[0].enemies=dungeon.enemies.map(p=>p.placementId);
  for(const kind of ['ghorn','witch'])modified.modifiers[kind].active=true;
  assert.equal(bloodTimeline(modified,dungeon)[0].blood,positionsBlood(effectivePositions(modified,dungeon),modified));
  assert.ok(bloodTimeline(modified,dungeon)[0].blood<positionsBlood(dungeon.enemies,modified));
});

test('Three charging towers project through every Regath map and are absent elsewhere',()=>{
  assert.equal(bloodRules.bloodPerTower,20);
  assert.equal(new Set(bloodRules.towers.map(t=>t.id)).size,3);
  for(const view of mapViews(dungeon)){
    const towers=mapBloodTowers(dungeon,view);
    const expected=bloodRules.towers.filter(t=>view.id===t.mapImageId||view.sources?.[t.mapImageId]);
    assert.equal(towers.length,expected.length);
    for(const [i,t]of towers.entries()){
      assert.deepEqual(t.point,mapCoordinates(expected[i],view));
      assert.ok(t.point.every(Number.isFinite));
      assert.ok(t.point[0]>=0&&t.point[0]<=view.width&&t.point[1]>=0&&t.point[1]<=view.height,view.name);
    }
  }
  for(const d of dungeons.filter(d=>d!==dungeon))for(const view of mapViews(d))assert.deepEqual(mapBloodTowers(d,view),[]);
});
