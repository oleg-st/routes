import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {placementName} from '../data/placement-corrections.js';
import {requiresPlayerContact} from '../log-import/activation.js';
const gameDungeons=Object.fromEntries(JSON.parse(fs.readFileSync('data/dungeons.json')).map(d=>[d.id,d]));
test('Peak distinguishes sleeping Grims from awake members of the same species',()=>{
  const peak=gameDungeons['Level.ID.SnowPeak'].enemies;
  const grims=peak.filter(p=>p.id==='mc-bloodhound');
  assert.equal(grims.filter(p=>p.sleeping).length,11);
  assert.equal(grims.filter(p=>!p.sleeping).length,3);
  for(const p of grims){
    assert.equal(placementName(p,{name:'Stalking Grim'}),'Stalking Grim');
    assert.equal(requiresPlayerContact(p),false,'Sleep must not become Dormant contact activation');
  }
});
