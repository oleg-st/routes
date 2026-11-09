import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {verifyPublicData} from '../scripts/verify-public-data.mjs';
test('Public boundary catches leaked exports and internal references',t=>{
  const parent=path.resolve('tmp');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'public-boundary-'));
  t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true});});
  fs.writeFileSync(root+'/runtime.json','{"name":"Clean"}');assert.equal(verifyPublicData(root),1);
  fs.writeFileSync(root+'/runtime.json','{"source":"/Game/Fixture"}');assert.throws(()=>verifyPublicData(root),/Internal source reference/);
  fs.writeFileSync(root+'/runtime.json','{}');fs.writeFileSync(root+'/ability-details.json','{}');assert.throws(()=>verifyPublicData(root),/Private dataset/);
});
test('Repository runtime datasets contain no private game exports',()=>{
  assert.ok(verifyPublicData('data')>0);
  const abilities=JSON.parse(fs.readFileSync('data/abilities.json'));
  const enemyIds=new Set(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>e.id));
  assert.ok(abilities.every(a=>enemyIds.has(a.parentId)&&a.name&&a.liveStatus!=='inactive'));
});
