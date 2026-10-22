import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {correctImportPacks} from '../log-import/pack-corrections.js';
import {createApproachFilter} from '../log-import/approach-filter.js';
import {reverseApproachEvidence} from '../log-import/reverse-approach.js';

const dungeonID='Level.ID.UrrakMarkets';
const dungeon=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id===dungeonID);
const catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const flowerPlacement=dungeon.enemies.find(p=>p.dormant);
const corrected=correctImportPacks([{id:'flower',number:'G48',placements:[flowerPlacement]}],{catalog});

test('Buried flowers require player contact at 100; targeting or chain aggro cannot uncover them',()=>{
  const flower=corrected[0],position=flower.placements[0].worldPosition;
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

test('Dormant splitting preserves each member once, counts, and the input',()=>{
  const members=[{placementId:'a',id:'mob',gameGuid:'a',dormant:true},{placementId:'b',id:'mob',gameGuid:'b'}];
  const packs=[{id:'p',number:'G1',placements:members}],before=JSON.stringify(packs);
  const result=correctImportPacks(packs,{catalog:new Map([['mob',{gameId:1}]])});
  assert.equal(result.length,2);assert.equal(JSON.stringify(packs),before);
  assert.deepEqual(result.flatMap(p=>p.placements.map(m=>m.placementId)).sort(),['a','b']);
  assert.equal(result[0].placements[0].activation,'player-contact');
  for(const part of result){assert.equal(part.counts[1],1);assert.ok(part.placements.every(p=>p.packId===part.id));}
  const awake=[{id:'awake',placements:[members[1]]}];
  assert.equal(correctImportPacks(awake,{catalog:new Map()}),awake);
});

test('Attack on an established patrol member does not activate stationary G21 members',()=>{
  const parts=['patrol','static'].map(id=>({id,number:`G21 (${id})`,placements:[{id:'mob',placementId:id,worldPosition:{x:100,y:100}}]}));
  const patrol=parts.find(p=>p.number.endsWith('(patrol)')),stationary=parts.find(p=>p.number.endsWith('(static)'));
  const p=patrol.placements[0].worldPosition;
  const filter=createApproachFilter({packs:parts.map(pack=>({...pack,memberKeys:pack.id===patrol.id?['looter']:[]})),
    observations:[],attacks:[{key:'player',targetKey:'looter',t:1,x:p.x,y:p.y,range:1e6}],playerRadius:1000,chainRadius:1000});
  assert.equal(filter.check(patrol.id,2,'raider').supported,true);
  assert.equal(filter.check(stationary.id,2,'butcher').supported,false);
});
