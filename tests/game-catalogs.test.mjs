import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
const dungeons=read('dungeons'),enemies=read('enemies');
test('Cithrel does not inherit Noor abilities through their shared attribute character ID',()=>{
  const abilities=read('abilities'),cithrel=abilities.filter(a=>a.parentId==='fk-bosselfdragon');
  assert.ok(cithrel.some(a=>a.name==='Draconic Frenzy'));
  assert.equal(cithrel.length,9);
  for(const a of cithrel)assert.doesNotMatch(a.id,/BossRangerCaptain/);
  assert.ok(abilities.some(a=>a.parentId==='fk-bossrangercaptain'&&a.name==="Betrayer's Arrow"));
});
test('NPC ability catalogs exclude reverse references and other NPC namespaces while retaining real shared casts',()=>{
  const abilities=read('abilities'),has=(id,blueprint)=>abilities.some(a=>a.parentId===id&&a.id.split(':').at(-1)===blueprint);
  for(const id of ['nf-bossferalist','nf-druidferalist'])assert.equal(has(id,'GA_PR_BossPirateCaptain_Spin'),false);
  assert.ok(has('pr-bosspiratecaptain','GA_PR_BossPirateCaptain_Spin'));
  assert.equal(has('dm-wintergiant','GA_DM_WinterGiantFriendly_BossChannelDamage'),false);
  assert.equal(has('dr-slaughtervine','GA_DR_SlaughtervineArchephyte_AwakenMinions'),false);
  assert.equal(has('st-bossarbiter','GA_ST_BossArbiterIllusion_Circle'),false);
  assert.equal(has('st-bossarbiter','GA_ST_BloodOrb_SharedHealth'),false);
  for(const id of ['fk-elf-shardling','ic-elf-shardling'])assert.ok(has(id,'GA_FK_Elf_Shardling_DeathExplosion'));
  assert.ok(has('dr-cultistsickle-praying','GA_DR_CultistSickle_InitiateRangedAttack'));
  assert.ok(has('st-smallbloodelemental','GA_ST_BigBloodElemental_MeleeAutoAttack'));
});
test('Game catalogs cover every active actor and expose unescaped localized names',()=>{
  assert.ok(read('manifest').buildId);
  const catalog=new Map(enemies.map(e=>[e.id,e]));
  for(const d of dungeons){
    assert.doesNotMatch(d.name,/\\/);
    for(const p of d.enemies){
      const e=catalog.get(p.id);
      assert.ok(e?.gameId&&e.name,p.id);
      assert.ok(Number.isFinite(e.baseHealth)&&e.baseHealth>0,p.id);
      assert.ok(Number.isFinite(e.dungeonScore),p.id);
    }
  }
});
