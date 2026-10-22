import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gameKillScore,enemyHealth,difficultyHealthScale,orbCount,shadowTarget} from '../game-scoring.js';
import {newRoute,scorePull,dungeonPackEfficiencies} from '../route-model.js';
import {gameServiceRules as rules} from '../data/game-service-rules.js';
import {dataNames} from '../data/runtime-loader.js';
test('KillScore applies effects before native ceiling and respects excluded actors',()=>{
 assert.equal(gameKillScore({dungeonScore:1.1}),2);
 assert.equal(gameKillScore({dungeonScore:1.1},true),4);
 assert.equal(gameKillScore({dungeonScore:0}),0);
 assert.equal(gameKillScore({dungeonScore:20,countsTowardsDungeonScore:false},true),0);
 assert.equal(gameKillScore({dungeonScore:NaN}),null);
 for(const name of ['Lost Soul','Heskyr Brood','Stalking Grim','Gravescythe','Renamed'])assert.equal(gameKillScore({name,dungeonScore:3},true),9);
});
test('Orb boundaries use rounded percentages for 60 and 90 orb dungeons',()=>{
 const adventure={id:'Level.ID.DesertDunes',requiredScore:100},dungeon={id:'Level.ID.FrozenKingdom',requiredScore:100};
 assert.equal(shadowTarget(adventure),60);assert.equal(shadowTarget(dungeon),90);
 assert.equal(shadowTarget({...dungeon,name:'Renamed'}),90);
 assert.equal(orbCount(0,adventure),0);assert.equal(orbCount(1.4999,adventure),0);assert.equal(orbCount(1.5,adventure),1);
 assert.equal(orbCount(.4999,dungeon),0);assert.equal(orbCount(.5,dungeon),1);
 assert.equal(orbCount(99.4999,adventure),59);assert.equal(orbCount(99.5,adventure),60);
 assert.equal(orbCount(99.4999,dungeon),89);assert.equal(orbCount(99.5,dungeon),90);
 assert.equal(orbCount(50,adventure),30);assert.equal(orbCount(50,dungeon),45);
 assert.equal(orbCount(200,adventure),120,'Potential thresholds are distinct from pickup/ability-end simulation');
 assert.throws(()=>shadowTarget({id:'unexported'}),/Missing game/);
});
test('Orb totals agree with sequential Blueprint thresholds throughout every dungeon',()=>{
 for(const dungeon of JSON.parse(fs.readFileSync('data/dungeons.json'))){
  let next=Math.fround(1/shadowTarget(dungeon)),count=0;
  for(let score=0;score<=dungeon.requiredScore*2;score++){
   while(Math.round(score/dungeon.requiredScore*100)>=Math.round(next*100)){count++;next+=Math.fround(1/shadowTarget(dungeon));}
   assert.equal(orbCount(score,dungeon),count,dungeon.name+' '+score);
  }
 }
});
test('Emissary deaths do not feed orbs, while ordinary kill score is retained',()=>{
 const d={id:'Level.ID.DesertDunes',requiredScore:100,enemies:[{id:'emissary',placementId:'s'},{id:'mob',placementId:'m'}]},r=newRoute(d,d.routeBuildId??'test');
 const catalog=new Map([['emissary',{dungeonScore:1,shadowOrbEligible:false}],['mob',{dungeonScore:3}]]);
 r.pulls[0].enemies=['s','m'];const score=scorePull(r.pulls[0],d,catalog,r);
 assert.equal(score.score,4);assert.equal(score.orbScore,3);
});
test('New health curve is sampled by level, including its sparse zero tail',()=>{
 assert.equal(rules.modifierDifficultyCap,62);
 assert.equal(difficultyHealthScale(0),1);assert.equal(difficultyHealthScale(21),32.5);assert.equal(difficultyHealthScale(52),351.49);
 assert.equal(rules.difficultyHealthScales.length,151);
 for(const difficulty of [53,62,100,150,151,999])assert.equal(difficultyHealthScale(difficulty),0);
 assert.equal(enemyHealth({baseHealth:100},{empowered:true,difficulty:21}),6500);
 assert.equal(enemyHealth({baseHealth:null}),null);assert.throws(()=>difficultyHealthScale(1.5),/integer/);
});


test('Stone Skin and Empowered add base HP independently; Ultimatum scales ordinary HP',()=>{
 const e={baseHealth:100},near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8);
 near(enemyHealth(e,{difficulty:21,stoneskin:true}),3250*1.3+1);
 near(enemyHealth(e,{difficulty:52,stoneskin:true}),35149*1.3+1);
 near(enemyHealth(e,{difficulty:52,empowered:true,stoneskin:true}),35149*2.3+1);
 near(enemyHealth(e,{difficulty:52,ultimatum:true}),35149*1.1);
 assert.equal(enemyHealth({baseHealth:null},{stoneskin:true}),null);
});
test('Efficiency uses the same capped-health formula when difficulty is supplied',()=>{
 const enemy={baseHealth:100,dungeonScore:1},d={requiredScore:10,enemies:[{id:'a',placementId:'a',packId:'p'}]},r=newRoute(d,d.routeBuildId??'test');r.modifiers.empowered={active:true,enemies:['a']};
 const result=dungeonPackEfficiencies(d,new Map([['a',enemy]]),r,{difficulty:21});
 assert.equal(result.totalHealth,3250);
 assert.ok(Math.abs(result.values.get('p')-.3/2)<1e-12);
});
test('Runtime and published inputs no longer contain historical shadow-reference data',()=>{
 assert.ok(!dataNames.includes('shadow-reference'));assert.ok(!fs.existsSync('data/shadow-reference.json'));
});
