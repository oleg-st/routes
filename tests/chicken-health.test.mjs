import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gameServiceRules as rules} from '../data/game-service-rules.js';
import {newRoute,placementHealth,routeHealth,dungeonPackEfficiencies} from '../route-model.js';
import {difficultyOptions,difficultyHealthModifiers} from '../difficulty.js';
import {enemyHealth,polymorphChicken} from '../game-scoring.js';

// Initial maxHitPoints from 25 distinct NPC instances in ten local log exports.
// Difficulty was independently matched against >= 3 ordinary NPC types per fight.
const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/chicken-health.json',import.meta.url)));
const sourceForSize={small:2999,medium:5998,large:10496.5};
function fixture({dungeonId='Level.ID.DesertDunes',difficulty=75,baseHealth=8063.4113}={}){
 const pos={id:'original',placementId:'mob',packId:'pack'},enemy={baseHealth,dungeonScore:5};
 const dungeon={id:dungeonId,requiredScore:100,timerSeconds:100,enemies:[pos]};
 const route=newRoute(dungeon,'test');route.difficulty=difficulty;route.excluded=['mob'];route.pulls[0].enemies=['mob'];
 return {pos,enemy,dungeon,route,enemies:new Map([[pos.id,enemy]])};
}

test('All three chicken templates reproduce initial maximum HP in ten independent log fights',()=>{
 assert.equal(observed.length,25);assert.equal(new Set(observed.map(r=>r.report+':'+r.fight)).size,10);
 assert.deepEqual([...new Set(observed.map(r=>r.size))].sort(),['large','medium','small']);
 for(const row of observed){
  assert.ok(row.controlTypes>=3);
  const f=fixture({...row,baseHealth:sourceForSize[row.size]});
  assert.equal(placementHealth(f.pos,f.enemy,f.route),row.maxHP,`${row.report}/${row.fight}: ${row.instance}, ${row.size}`);
  if(row.currentTierMatches){
   f.enemy.baseHealth=row.sourceBaseHealth;
   assert.equal(placementHealth(f.pos,f.enemy,f.route),row.maxHP,'Current source template also selects the observed chicken size');
  }
 }
 assert.equal(observed.filter(r=>r.currentTierMatches===false).length,0);
});

test('Sands fight 5 uses chicken HP in pull, route, DPS and efficiency; Empowered is not inherited',()=>{
 const expected=[1555786,2344957];
 const rows=observed.filter(r=>r.report==='c4nFLaThdAxtVpYv'&&r.fight===5);
 assert.deepEqual(rows.map(r=>r.maxHP),expected);
 for(const [i,row]of rows.entries()){
  const f=fixture({...row,baseHealth:row.sourceBaseHealth});
  f.route.modifiers.empowered={active:true,enemies:['mob']};
  const result=routeHealth(f.route,f.dungeon,f.enemies);
  assert.equal(result.total,expected[i]);assert.equal(result.pulls[0].mobs,expected[i]);assert.equal(result.dps,expected[i]/100);
  f.route.modifiers.empowered.active=false;
  assert.equal(placementHealth(f.pos,f.enemy,f.route),expected[i]);
  const second={id:'other',placementId:'other',packId:'pack'};f.dungeon.enemies.push(second);
  f.enemies.set('other',{baseHealth:1000,dungeonScore:5});
  const ordinary=enemyHealth(f.enemies.get('other'),{difficulty:75});
  const ratings=dungeonPackEfficiencies(f.dungeon,f.enemies,f.route);
  assert.equal(ratings.values.get('pack'),(5/100)/((expected[i]+ordinary)/ratings.totalHealth));
 }
});

test('Chicken size uses base health at effective thresholds, independent of difficulty or Empowered',()=>{
 for(const [multiplier,size]of [[1.999,'small'],[2,'medium'],[3.299,'medium'],[3.3,'large'],[3.5,'large']]){
  const f=fixture({baseHealth:rules.markerDefaultBaseHealth*multiplier});
  assert.equal(polymorphChicken(f.enemy).id,rules.polymorphChickens[size].id);
 }
 const f=fixture();f.enemy.isBoss=true;
 assert.equal(polymorphChicken(f.enemy),null);
 assert.equal(placementHealth(f.pos,f.enemy,f.route),enemyHealth(f.enemy,{difficulty:75}));
 delete f.enemy.isBoss;delete f.enemy.baseHealth;assert.equal(placementHealth(f.pos,f.enemy,f.route),null);
 delete f.route.difficulty;assert.equal(placementHealth(f.pos,f.enemy,f.route),null);
});

test('Provisional threshold reproduces Corsair and Reaver logs and changes only three current NPC types',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../data/enemies.json',import.meta.url)));
 const changed=catalog.filter(e=>!e.isBoss&&e.baseHealthMultiplier>=3.3&&e.baseHealthMultiplier<3.5);
 assert.deepEqual(changed.map(e=>e.id).sort(),['mc-wanderingghostguard','pr-swashbuckler','sg-ghostorc']);
 for(const e of changed)assert.equal(polymorphChicken(e).id,rules.polymorphChickens.large.id);
 const reaver=catalog.find(e=>e.id==='dd-desertwarrior');
 assert.equal(polymorphChicken(reaver).id,rules.polymorphChickens.medium.id);
 const corsairRows=observed.filter(r=>r.report==='3dQ12FNLgv9b7KnG'&&r.fight===37);
 assert.equal(corsairRows.length,2);
 for(const row of corsairRows){const f=fixture({...row,baseHealth:row.sourceBaseHealth});assert.equal(placementHealth(f.pos,f.enemy,f.route),3484453);}
 const reaverRow=observed.find(r=>r.report==='aVpJGQxmhLygPKXc'&&r.fight===74&&Math.abs(r.sourceBaseHealth-reaver.baseHealth)<1);
 assert.ok(reaverRow);const f=fixture({...reaverRow,baseHealth:reaver.baseHealth});
 assert.equal(placementHealth(f.pos,f.enemy,f.route),1437710);
});

test('Chicken uses its own Stone Skin eligibility, including when the original was a boss minion',()=>{
 const difficulty=difficultyOptions('Level.ID.DesertDunes').find(c=>c.modifiers.includes('stoneskin')).value;
 const f=fixture({difficulty});f.pos.isBossMinion=true;
 assert.equal(difficultyHealthModifiers(f.route,f.pos.id,{isBossMinion:true}).stoneskin,false);
 const stats=polymorphChicken(f.enemy);assert.equal(difficultyHealthModifiers(f.route,stats.id).stoneskin,true);
 const expected=Math.trunc(enemyHealth({...stats,baseHealth:Math.ceil(stats.baseHealth)},{difficulty,stoneskin:true}));
 assert.equal(placementHealth(f.pos,f.enemy,f.route),expected);
 assert.ok(expected>placementHealth(f.pos,f.enemy,{...f.route,dungeonId:'no-affixes'}));
});
