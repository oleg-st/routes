import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {correctImportPacks} from '../log-import/pack-corrections.js';
import {createApproachFilter} from '../log-import/approach-filter.js';
import {reverseApproachEvidence} from '../log-import/reverse-approach.js';

const dungeonID='Level.ID.UrrakMarkets';
const dungeon=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id===dungeonID);
const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const packs=[...Map.groupBy(dungeon.enemies,p=>p.packId)].map(([id,placements],i)=>({id,number:`G${i+1}`,placements}));
const corrected=correctImportPacks(packs,{dungeonID,catalog});

test('Only known groups split; every placement is preserved once and input stays unchanged',()=>{
  const before=JSON.stringify(packs),result=correctImportPacks(packs,{dungeonID,catalog});
  assert.equal(JSON.stringify(packs),before);
  assert.deepEqual(result.flatMap(p=>p.placements.map(m=>m.placementId)).sort(),dungeon.enemies.map(m=>m.placementId).sort());
  for(const [number,sizes] of [['G21',[3,3]],['G48',[1,1,1,2]]]){
    const parts=result.filter(p=>p.sourcePackId===packs.find(p=>p.number===number).id);
    assert.deepEqual(parts.map(p=>p.placements.length).sort(),sizes);
    for(const part of parts){
      assert.equal(Object.values(part.counts).reduce((a,b)=>a+b,0),part.placements.length);
      assert.ok(part.placements.every(p=>p.packId===part.id));
    }
  }
  assert.equal(result.filter(p=>p.placements.some(m=>m.activation==='player-contact')).length,3);
  assert.equal(result.find(p=>p.number==='G19'),packs.find(p=>p.number==='G19'));
  assert.equal(correctImportPacks(packs,{dungeonID:'another-dungeon',catalog}),packs);
});

test('Buried flowers require player contact at 100; targeting or chain aggro cannot uncover them',()=>{
  const flower=corrected.find(p=>p.number==='G48 (flower 1)'),position=flower.placements[0].worldPosition;
  const player={type:'Player',key:'p',visibility:'visible',hp:1,t:1,x:position.x+200,y:position.y};
  const observations=[player,{...player,type:'NPC',key:'npc',activeSince:0}];
  const args={packs:[flower],observations,playerRadius:1000,chainRadius:1000};
  const evidence=createApproachFilter(args).check(flower.id,2,'flower');
  assert.equal(evidence.supported,false);assert.equal(evidence.reason,'no-prior-player-contact');
  assert.deepEqual(reverseApproachEvidence({packs:[flower],observations,radius:1000}),[]);
  const attack={...player,targetKey:'flower',range:6000,abilityGameID:1478};
  assert.equal(createApproachFilter({...args,attacks:[attack]}).check(flower.id,2,'flower').supported,false);
  const contact={...player,x:position.x+100};
  assert.equal(createApproachFilter({...args,observations:[contact]}).check(flower.id,2,'flower').witness.kind,'player-contact');
  assert.equal(createApproachFilter({...args,observations:[{...contact,x:position.x+101}]}).check(flower.id,2,'flower').supported,false);
  assert.equal(createApproachFilter({...args,observations:[{...contact,type:'NPC',activeSince:0}]}).check(flower.id,2,'flower').supported,false);
  assert.equal(reverseApproachEvidence({packs:[flower],observations:[contact],radius:1000})[0].closest.range,100);
});

test('Current custom grouping is respected; buried flags work in any dungeon and split contact-only members',()=>{
  const members=[{placementId:'a',id:'mob',worldPosition:{x:0,y:0},burried:true},{placementId:'b',id:'mob',worldPosition:{x:0,y:0}}];
  const result=correctImportPacks([{id:'p',number:'G1',placements:members}],{dungeonID:'another',dungeonData:'custom',catalog:new Map([['mob',{gameId:1}]])});
  assert.equal(result.length,2);
  assert.equal(result.find(p=>p.placements[0].placementId==='a').placements[0].activation,'player-contact');
  const legacy=correctImportPacks(packs,{dungeonID,catalog,dungeonData:'custom'});
  assert.equal(legacy,packs,'no legacy grouping overrides applied to current custom groups');
});

test('Attack on an established patrol member does not activate stationary G21 members',()=>{
  const parts=corrected.filter(p=>p.number.startsWith('G21 ('));
  const patrol=parts.find(p=>p.number.endsWith('(patrol)')),stationary=parts.find(p=>p.number.endsWith('(static)'));
  const p=patrol.placements[0].worldPosition;
  const filter=createApproachFilter({packs:parts.map(pack=>({...pack,memberKeys:pack.id===patrol.id?['looter']:[]})),
    observations:[],attacks:[{key:'player',targetKey:'looter',t:1,x:p.x,y:p.y,range:1e6}],playerRadius:1000,chainRadius:1000});
  assert.equal(filter.check(patrol.id,2,'raider').supported,true);
  assert.equal(filter.check(stationary.id,2,'butcher').supported,false);
});
