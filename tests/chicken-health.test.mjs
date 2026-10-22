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
 const route=newRoute(dungeon,dungeon.routeBuildId??'test');route.difficulty=difficulty;route.excluded=['mob'];route.pulls[0].enemies=['mob'];
 return {pos,enemy,dungeon,route,enemies:new Map([[pos.id,enemy]])};
}





test('Chicken size uses base health at effective thresholds, independent of difficulty or Empowered',()=>{
 for(const [multiplier,size]of [[1.999,'small'],[2,'medium'],[3.299,'medium'],[3.3,'medium'],[3.5,'large']]){
  const f=fixture({baseHealth:rules.markerDefaultBaseHealth*multiplier});
  assert.equal(polymorphChicken(f.enemy).id,rules.polymorphChickens[size].id);
 }
 const f=fixture();f.enemy.isBoss=true;
 assert.equal(polymorphChicken(f.enemy),null);
 assert.equal(placementHealth(f.pos,f.enemy,f.route),enemyHealth(f.enemy,{difficulty:75}));
 delete f.enemy.isBoss;delete f.enemy.baseHealth;assert.equal(placementHealth(f.pos,f.enemy,f.route),null);
 delete f.route.difficulty;assert.equal(placementHealth(f.pos,f.enemy,f.route),null);
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
