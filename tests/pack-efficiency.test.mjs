import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newRoute,dungeonPackEfficiencies,packEfficiencyColor,applyModifierPresets} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {modifierStats} from '../data/game-modifier-stats.js';

function fixture(){
  const enemies=new Map([
    ['low',{name:'Lost Soul',dungeonScore:1,baseHealth:100}],
    ['high',{name:'Hunter',dungeonScore:4,baseHealth:100}],
    ['boss',{name:'Boss',dungeonScore:0,baseHealth:100000,isBoss:true}],
    ['scenery',{name:'Scenery',dungeonScore:0}],
  ]);
  const dungeon={id:'test',name:'A new dungeon',requiredScore:20,enemies:[
    {id:'low',placementId:'a',packId:'low',mapImageId:'floor1'},
    {id:'high',placementId:'b',packId:'high',mapImageId:'floor2'},
    {id:'low',placementId:'c',packId:'mixed',mapImageId:'floor1'},
    {id:'high',placementId:'d',packId:'mixed',mapImageId:'floor2'},
    {id:'boss',placementId:'boss',packId:'boss'},
    {id:'scenery',placementId:'scenery',packId:'scenery'},
  ]};
  const route=newRoute(dungeon,'test');
  return {enemies,dungeon,route,calculate:()=>dungeonPackEfficiencies(dungeon,enemies,route)};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('Automatic ratios count all placements and floors; mixed packs sum HP and score',()=>{
  const f=fixture(),result=f.calculate();
  assert.equal(result.totalHealth,400);
  near(result.values.get('low'),.2);near(result.values.get('high'),.8);near(result.values.get('mixed'),.5);
  assert.equal(result.values.size,3);assert.deepEqual(result.range,{min:.2,max:.8});
  f.route.pulls[0].enemies=['a','c'];f.route.pulls[0].name='Selected route';
  assert.deepEqual(f.calculate(),result);
  f.dungeon.name='Renamed dungeon';f.enemies.get('high').name='Renamed mob';
  assert.deepEqual(f.calculate(),result);
});

test('Changing dataset HP or adding a pack automatically updates ratios and colors',()=>{
  const f=fixture(),before=f.calculate();
  f.enemies.get('high').baseHealth=200;
  const changed=f.calculate();assert.equal(changed.totalHealth,600);
  near(changed.values.get('low'),.3);near(changed.values.get('high'),.6);near(changed.values.get('mixed'),.5);
  assert.notEqual(packEfficiencyColor(before.values.get('mixed'),before.range),packEfficiencyColor(changed.values.get('mixed'),changed.range));
  f.enemies.set('new',{name:'New enemy',dungeonScore:10,baseHealth:100});
  f.dungeon.enemies.push({id:'new',placementId:'e',packId:'new'});
  const added=f.calculate();assert.equal(added.totalHealth,700);near(added.values.get('new'),3.5);
  assert.equal(added.range.max,3.5);
  assert.equal(packEfficiencyColor(added.values.get('new'),added.range),'rgb(34,197,94)');
  assert.notEqual(packEfficiencyColor(added.values.get('high'),added.range),'rgb(34,197,94)');
});

test('Chicken removes pack HP and score without shifting dungeon normalization',()=>{
  const f=fixture();f.route.excluded=['c'];
  const partial=f.calculate();assert.equal(partial.totalHealth,400);near(partial.values.get('mixed'),.8);
  near(partial.values.get('low'),.2);near(partial.values.get('high'),.8);
  f.route.excluded=['a','b','c','d'];
  const empty=f.calculate();assert.equal(empty.totalHealth,400);assert.equal(empty.values.size,0);assert.equal(empty.range,null);
});

test('Empowered adjusts score and HP; Shadow Lord does not change those attributes',()=>{
  const f=fixture();f.route.modifiers.empowered={active:true,enemies:['a']};
  const empowered=f.calculate();assert.equal(empowered.totalHealth,400);
  // Score: 3 * 1 = 3; base-difficulty HP: 100 + 100 = 200.
  near(empowered.values.get('low'),.3);near(empowered.values.get('high'),.8);
  f.route.shadow=true;
  near(f.calculate().values.get('low'),.3);
  f.route.modifiers.empowered.active=false;
  near(f.calculate().values.get('low'),.2);
});

test('Replacements remove original mobs and contribute their own HP and score',()=>{
  for(const [kind,{baseHealth:hp}] of Object.entries(modifierStats)){
    const f=fixture();f.route.modifiers[kind]={active:true,packId:'low'};
    const result=f.calculate();assert.equal(result.totalHealth,400);assert.equal(result.values.has('low'),false);
    near(result.values.get(`modifier:${kind}`),400/hp);
    near(result.values.get('high'),.8);near(result.values.get('mixed'),.5);
    f.route.excluded=[`modifier:${kind}`];assert.equal(f.calculate().totalHealth,400);
  }
});

test('Bosses and scenery are skipped; zero-score combat targets still cost HP',()=>{
  const f=fixture();f.enemies.get('scenery').baseHealth=100;
  const result=f.calculate();assert.equal(result.totalHealth,500);assert.equal(result.values.get('scenery'),0);
  assert.equal(result.values.has('boss'),false);
  assert.equal(packEfficiencyColor(0,result.range),'rgb(15,23,42)');
});

test('Invalid HP, score or dungeon requirement cannot produce misleading ratings',()=>{
  for(const health of [undefined,0,-1,NaN,Infinity]){
    const f=fixture();f.enemies.get('high').baseHealth=health;assert.equal(f.calculate().values.size,0);
  }
  for(const score of [undefined,-1,NaN,Infinity]){
    const f=fixture();f.enemies.get('high').dungeonScore=score;assert.equal(f.calculate().values.size,0);
  }
  for(const required of [0,-1,NaN,Infinity]){
    const f=fixture();f.dungeon.requiredScore=required;assert.equal(f.calculate().values.size,0);
  }
  const f=fixture();f.enemies.delete('high');assert.equal(f.calculate().values.size,0);
});

test('Color endpoints come from pack ratings; equal ratings and empty dungeons are stable',()=>{
  const result=fixture().calculate();
  assert.equal(packEfficiencyColor(.2,result.range),'rgb(15,23,42)');
  assert.equal(packEfficiencyColor(.8,result.range),'rgb(34,197,94)');
  assert.equal(packEfficiencyColor(0,result.range),'rgb(15,23,42)');
  assert.equal(packEfficiencyColor(100,result.range),'rgb(34,197,94)');
  const f=fixture();f.enemies.get('high').dungeonScore=1;
  const equal=f.calculate();assert.equal(equal.range.min,equal.range.max);
  assert.equal(packEfficiencyColor(equal.range.min,equal.range),'rgb(249,115,22)');
  f.dungeon.enemies=[];assert.deepEqual(f.calculate(),{values:new Map(),range:null,totalHealth:0});
  assert.equal(packEfficiencyColor(null,null),'#0f172a');
});

test('Every dungeon computes finite pack ratings from game data, including active modifiers',()=>{
  const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
  const enemies=new Map(read('enemies').map(e=>[e.id,e])),presets=read('modifier-placements');
  for(const dungeon of read('dungeons').map(correctDungeon)){
    const route=newRoute(dungeon,'test');applyModifierPresets(route,dungeon,presets);
    const baseline=dungeonPackEfficiencies(dungeon,enemies,route);
    for(const modified of [false,true]){
      route.shadow=modified;
      for(const [kind,mod] of Object.entries(route.modifiers))mod.active=modified&&(kind==='empowered'||!!mod.packId);
      const result=dungeonPackEfficiencies(dungeon,enemies,route);
      assert.equal(result.totalHealth,baseline.totalHealth,`${dungeon.name}: stable baseline HP`);
      assert.ok(result.values.size>0,dungeon.name);
      assert.ok([...result.values.values()].every(Number.isFinite),dungeon.name);
      assert.deepEqual(result.range,baseline.range,`${dungeon.name}: stable color scale`);
    }
  }
});

test('Sands ordinary packs keep their ratings when Empowered, replacements or Chicken change',()=>{
  const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
  const dungeon=correctDungeon(read('dungeons').find(d=>d.name==='Empyrean Sands'));
  const enemies=new Map(read('enemies').map(e=>[e.id,e]));
  const route=newRoute(dungeon,'test');applyModifierPresets(route,dungeon,read('modifier-placements'));
  route.shadow=true;
  const calculate=()=>dungeonPackEfficiencies(dungeon,enemies,route);
  const controls={'pack-308240c4':'placement-3034c49315fb36dd3116417317759423bbd90852a7bbeae552c3b38f7e9a8e15','pack-f53eada7':'placement-735293bb508989aea4a1e634b148440efc096d92e3bb54e4ac1440fb2e6565b6','pack-50964c76':'placement-3a84285bc8073601c0e1797ca571c7bd0146ee33ec7d2188b18734fea54429c5'};
  const placement=prefix=>controls[prefix];
  const gamePack=prefix=>dungeon.enemies.find(p=>p.placementId===placement(prefix)).packId;
  const baseline=calculate(),pack=gamePack('pack-308240c4');
  assert.equal(baseline.values.get(pack).toFixed(2),'4.51');
  route.modifiers.empowered.active=true;
  route.modifiers.ghorn.active=true;
  route.excluded=[placement('pack-f53eada7')];
  const modified=calculate();
  assert.equal(modified.totalHealth,baseline.totalHealth);
  assert.equal(modified.values.get(pack),baseline.values.get(pack));
  assert.equal(packEfficiencyColor(modified.values.get(pack),modified.range),packEfficiencyColor(baseline.values.get(pack),baseline.range));
  for(const difficulty of [68,72,90,110]){
    route.difficulty=difficulty;
    const scaled=calculate();
    near(scaled.values.get(pack),baseline.values.get(pack));
    assert.deepEqual(scaled.range,baseline.range);
    assert.equal(packEfficiencyColor(scaled.values.get(pack),scaled.range),packEfficiencyColor(baseline.values.get(pack),baseline.range));
  }
  const boosted=gamePack('pack-50964c76');
  assert.equal(modified.values.get(boosted).toFixed(2),'4.32');
  assert.notEqual(modified.values.get(boosted),baseline.values.get(boosted));
});
