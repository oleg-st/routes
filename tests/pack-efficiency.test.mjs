import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newRoute,packEfficiency,packEfficiencyColor,applyModifierPresets} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
const dungeons=read('dungeons').map(correctDungeon),enemies=new Map(read('enemies').map(e=>[e.id,e]));
const reference=read('shadow-reference'),presets=read('modifier-placements');
const sands=dungeons.find(d=>d.name==='Empyrean Sands');
const members=prefix=>sands.enemies.filter(p=>p.packId.startsWith(prefix));
const efficiency=(ps,route,dungeon=sands)=>packEfficiency(ps,dungeon,enemies,route,reference);

test('Sands labels match reference values with Shadow Lord and Empowered enabled',()=>{
  const route=newRoute(sands,'test');applyModifierPresets(route,sands,presets);
  route.shadow=true;route.modifiers.empowered.active=true;
  for(const [prefix,expected] of [
    ['pack-308240c4','4.51'],['pack-1f16bbc8','4.01'],['pack-3c99198d','4.18'],
    ['pack-f53eada7','3.33'],['pack-1d867be7','2.86'],['pack-41186334','3.07'],
    ['pack-e0d4e852','2.76'],['pack-084447e7','3.04'],['pack-50964c76','4.32'],
    ['pack-a3e5f5aa','4.16'],['pack-4c987346','2.62'],['pack-5d3a0b52','3.62'],
  ]){
    const ps=members(prefix);assert.ok(ps.length,prefix);
    assert.equal(efficiency(ps,route).toFixed(2),expected,prefix);
  }
});

test('Pack efficiency weights HP and is independent of route selection',()=>{
  const route=newRoute(sands,'test'),ps=members('pack-1f16bbc8');
  assert.equal(efficiency(ps,route).toFixed(2),'4.01');
  assert.notEqual(efficiency(ps,route),(4.51+3.44)/2);
  route.pulls[0].enemies=ps.map(p=>p.placementId);
  assert.equal(efficiency(ps,route).toFixed(2),'4.01');
});

test('Chicken removes score and HP; an entirely excluded pack has no label',()=>{
  const route=newRoute(sands,'test'),ps=members('pack-1f16bbc8');
  route.excluded=ps.filter(p=>enemies.get(p.id).name==='Sandsworn Husk').map(p=>p.placementId);
  assert.equal(efficiency(ps,route).toFixed(2),'4.51');
  route.excluded=ps.map(p=>p.placementId);
  assert.equal(efficiency(ps,route),null);
});

test('Empowered uses partial kill score and doubles HP; Shadow Lord changes the numerator',()=>{
  const route=newRoute(sands,'test'),soul=sands.enemies.find(p=>enemies.get(p.id).name==='Lost Soul');
  route.modifiers.empowered={active:true,enemies:[soul.placementId]};
  // Lost Soul: normal score 1; empowered score 2, rather than 3.
  assert.equal(efficiency([soul],route),4.29);
  route.shadow=true;
  assert.equal(efficiency([soul],route),4.29*.75);
});

test('Reference covers score-bearing trash in every dungeon, including spelling aliases',()=>{
  for(const dungeon of dungeons){
    const route=newRoute(dungeon,'test');
    for(const p of dungeon.enemies){
      const enemy=enemies.get(p.id);
      if(enemy.isBoss||!enemy.dungeonScore)continue;
      assert.ok(Number.isFinite(efficiency([p],route,dungeon)),`${dungeon.name}: ${enemy.name}`);
    }
  }
  const route=newRoute(sands,'test');
  assert.equal(efficiency([],route),null);
  assert.equal(efficiency([{id:'unknown',placementId:'missing'}],route),null);
});

test('Replacement minibosses use reference normalization and HP',()=>{
  const route=newRoute(sands,'test');applyModifierPresets(route,sands,presets);
  for(const kind of ['ghorn','witch']){
    route.modifiers[kind].active=true;
    const pos={id:`modifier:${kind}`,placementId:`modifier:${kind}`,modifier:kind};
    const expected=20*4.58*6973/3/({ghorn:25102,witch:21337}[kind]);
    assert.equal(efficiency([pos],route),expected);
  }
});

test('Colors use the whole dungeon reference range, with outliers excluded',()=>{
  assert.equal(packEfficiencyColor(2.62,sands),'rgb(15,23,42)');
  assert.equal(packEfficiencyColor(4.58,sands),'rgb(34,197,94)');
  assert.equal(packEfficiencyColor(100,sands),'rgb(34,197,94)');
  assert.equal(packEfficiencyColor(-1,sands),'rgb(15,23,42)');
  const markets=dungeons.find(d=>d.name==='Urrak Markets');
  assert.equal(packEfficiencyColor(3.9,markets),'rgb(34,197,94)');
  assert.equal(packEfficiencyColor(45.85,markets),'rgb(34,197,94)');
});
