import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {projectGamePoint} from '../scripts/game-source-identity.mjs';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
const dungeons=read('dungeons'),enemies=read('enemies'),frames=read('game-map-frames'),sources=read('game-image-sources');

test('Game catalogs cover every active actor and expose unescaped localized names',()=>{
  assert.equal(read('manifest').source,'installed-game');
  const catalog=new Map(enemies.map(e=>[e.id,e]));
  for(const d of dungeons){
    assert.doesNotMatch(d.name,/\\/);
    assert.equal(d.source.kind,'game');
    for(const p of d.enemies){
      const e=catalog.get(p.id);
      assert.ok(e?.gameId&&e.name&&e.source.blueprint,p.id);
      assert.ok(Number.isFinite(e.baseHealth)&&e.baseHealth>0,p.id);
      assert.ok(Number.isFinite(e.dungeonScore),p.id);
    }
  }
});

test('Every map frame comes from a game map box and projects its corners correctly',()=>{
  assert.equal(dungeons.flatMap(d=>d.mapImages).length,17);
  for(const d of dungeons)for(const map of d.mapImages){
    const frame=frames[d.id][map.id], [lo,hi]=frame.bounds;
    assert.match(frame.source,/^\/[^/]+\/.+\.\d+$/);
    const a=projectGamePoint(lo,frame),b=projectGamePoint(hi,frame);
    for(const [actual,expected] of [[a.x,0],[a.y,1],[b.x,1],[b.y,0]])assert.ok(Math.abs(actual-expected)<1e-10);
    for(const p of d.enemies.filter(p=>p.mapImageId===map.id))assert.deepEqual(p.mapPosition,projectGamePoint(p.worldPosition,frame));
  }
});

test('Catalog map and portrait assets use our game texture export',()=>{
  for(const item of [...dungeons,...enemies,...read('heroes')])for(const image of item.mapImages??item.images??[]){
    const source=sources[image.path];assert.ok(source,image.path);
    assert.match(source.source.replaceAll('\\','/'),/^private\/game-data\/planner\/images\//);
    assert.equal(image.sourceSha256,source.sha256);
    assert.equal(createHash('sha256').update(fs.readFileSync(image.path)).digest('hex'),image.sha256);
  }
  assert.doesNotMatch(fs.readFileSync('index.html','utf8'),/id="dungeon-data"/);
  assert.ok(!JSON.parse(fs.readFileSync('package.json')).dependencies['@crockery/fellowship-data']);
});
