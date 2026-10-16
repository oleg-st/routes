import test from 'node:test';
import assert from 'node:assert/strict';
import {createApproachFilter} from '../log-import/approach-filter.js';
const packs=[{id:'pack',placements:[{worldPosition:{x:1000,y:0}}]}];
const player=(key,t,x)=>({key,type:'Player',t,x,y:0});
const make=(observations,attacks=[])=>createApproachFilter({packs,observations,attacks,playerRadius:100,chainRadius:100});
test('Any player can run ahead and pull, regardless of the tank or group center',()=>{
  const f=make([player('tank',10,0),player('healer',12,990)]);
  assert.equal(f.check('pack',13,'mob').witness.key,'healer');
});
test('A later visit cannot justify an earlier pull',()=>{
  assert.equal(make([player('player',20,990)]).check('pack',10,'mob').supported,false);
});
test('Invisible players cannot body-pull; direct attacks, visible allies and NPC chain aggro remain eligible',()=>{
  const hidden={...player('hidden',10,990),visibility:'invisible'};
  assert.equal(make([hidden]).check('pack',11,'mob').supported,false);
  assert.equal(make([{...hidden,visibility:'unknown'}]).check('pack',11,'mob').supported,false);
  assert.equal(make([hidden,player('ally',10,990)]).check('pack',11,'mob').witness.key,'ally');
  const attack={key:'hidden',targetKey:'mob',t:10,x:990,y:0,range:100,abilityGameID:1478};
  assert.equal(make([hidden],[attack]).check('pack',10,'mob').witness.kind,'player-attack-or-cast');
  const npc={key:'other',type:'NPC',t:10,x:990,y:0,activeSince:9};
  assert.equal(make([hidden,npc]).check('pack',11,'mob').witness.kind,'npc-chain');
});
test('An already-active mob can chain pull, but a dead or inactive mob cannot',()=>{
  const npc={key:'other',type:'NPC',t:10,x:980,y:0,activeSince:5,deathTime:12};
  assert.equal(make([npc]).check('pack',11,'mob').witness.kind,'npc-chain');
  assert.equal(make([{...npc,activeSince:15}]).check('pack',11,'mob').supported,false);
  assert.equal(make([{...npc,deathTime:9}]).check('pack',11,'mob').supported,false);
});
test('A mob at its own first observation cannot justify its own aggro',()=>{
  const npc={key:'mob',type:'NPC',t:10,x:1000,y:0,activeSince:10};
  assert.equal(make([npc]).check('pack',10,'mob').supported,false);
});
test('A targeted attack can reach beyond body range; wrong target, range, or later time cannot',()=>{
  const attack={key:'ranged',targetKey:'mob',t:10,x:500,y:0,range:600,abilityGameID:7};
  assert.equal(make([player('ranged',10,500)],[attack]).check('pack',10,'mob').witness.kind,'player-attack-or-cast');
  assert.equal(make([], [attack]).check('pack',10,'other').supported,false);
  assert.equal(make([], [{...attack,range:400}]).check('pack',10,'mob').supported,false);
  assert.equal(make([], [attack]).check('pack',9,'mob').supported,false);
});
test('Reaching one member or the actual patrol path supports a complete pack',()=>{
  const f=createApproachFilter({packs:[{id:'pack',placements:[{worldPosition:{x:5000,y:0},patrolPath:[{x:0,y:0},{x:1000,y:0}]}]}],observations:[player('player',1,500)],playerRadius:10,chainRadius:10});
  assert.equal(f.check('pack',2,'mob').supported,true);
});
test('Chickenize pulls the original pack at cast time, before the Chicken appears',()=>{
  const cast={key:'player',targetKey:'original-acolyte',t:10,x:500,y:0,range:600,abilityGameID:1478};
  const f=make([], [cast]);
  assert.equal(f.check('pack',10,'original-acolyte').witness.abilityGameID,1478);
  assert.equal(f.check('pack',9,'original-acolyte').supported,false);
  assert.equal(f.check('pack',11,'replacement-chicken').supported,false);
});
test('Whole-pack feasibility checks the earliest member; later members cannot supply circular evidence',()=>{
  const f=make([{key:'first-member',type:'NPC',t:10,x:1000,y:0,activeSince:10}]);
  assert.equal(f.check('pack',11,'second-member').supported,true);
  // Both members have to be assigned: the earliest member still fails.
  assert.equal(f.check('pack',10,'first-member').supported,false);
});

test('Prepared radius ranges preserve earliest player/chain witnesses at each threshold',()=>{
  const observations=[player('near-late',30,950),player('far-early',10,-1000),player('middle',20,-150),
    {key:'npc',type:'NPC',t:15,x:-250,y:0,activeSince:5},
    {...player('hidden',1,1000),visibility:'invisible'}];
  const prepared=createApproachFilter({packs,observations,playerRadius:100,chainRadius:100,maxPlayerRadius:2000,maxChainRadius:2000});
  for(const radius of [100,1000,1200,1300,2000]){
    const fixed=createApproachFilter({packs,observations,playerRadius:radius,chainRadius:radius});
    for(const time of [9,10,15,16,20,30]){
      assert.deepEqual(prepared.check('pack',time,'mob',{playerRadius:radius,chainRadius:radius}),fixed.check('pack',time,'mob'));
    }
  }
  assert.throws(()=>prepared.check('pack',30,'mob',{playerRadius:2100,chainRadius:2100}),/prepared range/);
});
test('A ranged cast on an established member pulls the whole pack, without expanding body radius',()=>{
  const attack={key:'player',targetKey:'anchored-soul',t:20,x:-1653,y:0,range:3000,abilityGameID:1843};
  const f=createApproachFilter({packs:[{...packs[0],memberKeys:['anchored-soul']}],observations:[],attacks:[attack],playerRadius:1000,chainRadius:1000});
  assert.equal(f.check('pack',25,'acolyte').supported,true);
  assert.equal(f.check('pack',25,'acolyte').witness.targetKey,'anchored-soul');
  assert.equal(f.check('pack',19,'earlier-mob').supported,false);
  const unassigned=createApproachFilter({packs,observations:[],attacks:[attack],playerRadius:1000,chainRadius:1000});
  assert.equal(unassigned.check('pack',25,'acolyte').supported,false);
});
