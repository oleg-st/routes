import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {difficultyOptions} from '../difficulty.js';
import {difficultyHealthScale} from '../game-scoring.js';
import {mapViews,mapPatrols,mapCoordinates} from '../map-views.js';
const dungeons=JSON.parse(fs.readFileSync(new URL('../data/dungeons.json',import.meta.url)));

test('Seasonal Xul retains all current actors, three layers and valid Pinnacle health tiers',()=>{
  const d=dungeons.find(d=>d.id==='Level.ID.SandTomb');assert.ok(d);
  assert.equal(d.enemies.length,221);assert.equal(new Set(d.enemies.map(p=>p.packId)).size,75);
  assert.equal(d.requiredScore,260);assert.equal(d.timerSeconds,1700);assert.equal(d.mapImages.length,3);
  const choices=difficultyOptions(d.id);
  assert.deepEqual(choices.map(c=>[c.label,c.value]),[['Normal',30],['Hard',35],['Nightmare',41]]);
  assert.ok(choices.every(c=>!c.modifiers.length&&difficultyHealthScale(c.value)>0));
  const map=mapViews(d)[0];assert.equal(map.kind,'combined');
  assert.ok(d.enemies.every(p=>mapCoordinates(p,map).every(Number.isFinite)));
});

test('Crown includes the always-loaded Environment Centurion and its patrol',()=>{
  const d=dungeons.find(d=>d.id==='Level.ID.TreeVillage');assert.equal(d.enemies.length,128);
  const p=d.enemies.find(p=>p.gameGuid==='5f5fa738-40331fc6-15365a86-5bd1f933');assert.ok(p);
  assert.equal(p.id,'nf-druidguardian');assert.ok(p.patrolPath.length>1);assert.ok(p.mapPatrolPath.length>1);
  assert.equal(d.enemies.filter(e=>e.packId===p.packId).length,1);
  assert.ok(mapPatrols([p],mapViews(d)[0]).length>0);
});
