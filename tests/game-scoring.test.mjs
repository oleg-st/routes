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
 const adventure={id:'Level.ID.DesertDunes',requiredScore:100},dungeon={id:'Level.ID.SandTomb',requiredScore:100};
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
 const d={id:'Level.ID.DesertDunes',requiredScore:100,enemies:[{id:'emissary',placementId:'s'},{id:'mob',placementId:'m'}]},r=newRoute(d,'test');
 const catalog=new Map([['emissary',{dungeonScore:1,shadowOrbEligible:false}],['mob',{dungeonScore:3}]]);
 r.pulls[0].enemies=['s','m'];const score=scorePull(r.pulls[0],d,catalog,r);
 assert.equal(score.score,4);assert.equal(score.orbScore,3);
});
test('Empowered adds capped HP while ordinary HP continues scaling',()=>{
 assert.equal(rules.modifierDifficultyCap,62);
 assert.equal(difficultyHealthScale(0),1);assert.equal(difficultyHealthScale(62),172.32);
 const enemy={baseHealth:100};
 assert.equal(enemyHealth(enemy,{empowered:true,difficulty:62}),34464);
 const above=enemyHealth(enemy,{empowered:true,difficulty:75});
 assert.equal(above,100*(250.61+172.32));
 assert.ok(above<2*enemyHealth(enemy,{difficulty:75}));
 assert.equal(enemyHealth({baseHealth:null}),null);
 assert.throws(()=>difficultyHealthScale(1.5),/integer/);
});
test('Observed same-type HP contrasts support the cap on both sides of difficulty 62',()=>{
 // Independent log observations; small differences include captured attribute
 // precision/runtime effects. No expected value is derived from the model.
 const observations=[{difficulty:48,normal:1117881,empowered:2235674},{difficulty:75,normal:2458985,empowered:4149656},{difficulty:75,normal:1747503,empowered:2949086}];
 for(const r of observations){const predicted=enemyHealth({baseHealth:1},{empowered:true,difficulty:r.difficulty})/enemyHealth({baseHealth:1},{difficulty:r.difficulty});assert.ok(Math.abs(predicted/(r.empowered/r.normal)-1)<.00005);}
});

test('Stone Skin adds capped base HP independently of Empowered; Ultimatum scales ordinary HP',()=>{
 const enemy={baseHealth:100};
 const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
 near(enemyHealth(enemy,{difficulty:62,stoneskin:true}),100*172.32*1.3+1);
 near(enemyHealth(enemy,{difficulty:75,stoneskin:true}),100*250.61+100*172.32*.3+1);
 near(enemyHealth(enemy,{difficulty:75,empowered:true,stoneskin:true}),100*250.61+100*172.32*1.3+1);
 near(enemyHealth(enemy,{difficulty:75,ultimatum:true}),100*250.61*1.1);
 assert.equal(enemyHealth({baseHealth:null},{stoneskin:true,ultimatum:true}),null);
});
test('Efficiency uses the same capped-health formula when difficulty is supplied',()=>{
 const enemy={baseHealth:100,dungeonScore:1},d={requiredScore:10,enemies:[{id:'a',placementId:'a',packId:'p'}]},r=newRoute(d,'test');r.modifiers.empowered={active:true,enemies:['a']};
 const result=dungeonPackEfficiencies(d,new Map([['a',enemy]]),r,{difficulty:75});
 assert.equal(result.totalHealth,25061);
 assert.ok(Math.abs(result.values.get('p')-.3/(1+172.32/250.61))<1e-12);
});
test('Runtime and published inputs no longer contain historical shadow-reference data',()=>{
 assert.ok(!dataNames.includes('shadow-reference'));assert.ok(!fs.existsSync('data/shadow-reference.json'));
});
