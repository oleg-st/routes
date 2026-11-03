import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isSleeping} from '../scripts/game-sleep-state.mjs';
import {gameDungeons} from '../data/game-dungeons.js';
import {placementName} from '../data/placement-corrections.js';
import {requiresPlayerContact} from '../log-import/activation.js';

test('Sleep requires the actor sleep phase, not blindness or a dormant spawn',()=>{
  assert.equal(isSleeping({behavior:{customIdlePhase:'/Game/Abilities/NPC/Shared/Idle/Sleep/DA_Phase_Idle_Sleep.0'}}),true);
  for(const behavior of [{},{spawnState:'Dormant'},{noPlayerDetectionConfigured:true},
    {customIdlePhase:'/Game/Abilities/NPC/Shared/Idle/Shackled/DA_Phase_Idle_Shackled.0'},
    {customIdlePhase:'/Game/Abilities/NPC/Shared/Idle/Fighting/DA_Phase_Idle_Fighting.0'}]){
    assert.equal(isSleeping({behavior}),false);
  }
});

test('Peak distinguishes sleeping Grims from awake members of the same species',()=>{
  const peak=gameDungeons['Level.ID.SnowPeak'].enemies;
  const grims=peak.filter(p=>p.id==='mc-bloodhound');
  assert.equal(grims.filter(p=>p.sleeping).length,11);
  assert.equal(grims.filter(p=>!p.sleeping).length,3);
  for(const p of grims){
    assert.equal(placementName(p,{name:'Stalking Grim'}),'Stalking Grim');
    assert.equal(requiresPlayerContact(p),false,'Sleep must not become Dormant contact activation');
  }
  const published=JSON.parse(fs.readFileSync('data/dungeons.json'));
  for(const d of published)assert.deepEqual(d.enemies,gameDungeons[d.id].enemies);
});

test('Published sleep flags match each active game actor', {skip:!fs.existsSync('tmp/game-planner-overlay/overlay.json')},()=>{
  const overlay=JSON.parse(fs.readFileSync('tmp/game-planner-overlay/overlay.json'));
  for(const [key,actors] of Object.entries(overlay.activeActorKeys)){
    const source=JSON.parse(fs.readFileSync(`private/game-data/all-dungeons/${key}/extracted.json`));
    const active=new Set(actors),placements=gameDungeons['Level.ID.'+key].enemies;
    for(const mob of source.mobs.filter(m=>active.has(m.actorKey))){
      const p=placements.find(p=>p.gameGuid===mob.actorGuid.toLowerCase());
      assert.ok(p,mob.actorKey);
      assert.equal(p.sleeping===true,isSleeping(mob),mob.actorKey);
    }
  }
});
