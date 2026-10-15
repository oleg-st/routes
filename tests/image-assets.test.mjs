import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {usedImages} from '../scripts/image-assets.mjs';
import {combinedRasterSize} from '../scripts/avif-assets.mjs';
import {combinedLayouts} from '../data/combined-layouts.js';
import {fullMaps} from '../data/full-maps.js';

test('Combined raster keeps native source density and independent logical coordinates', () => {
  const dungeon = {mapImages: [{id: 'a', width: 2048, height: 1024}, {id: 'b', width: 2048, height: 1024}]};
  const layout = {width: 8192, height: 2048, artworkSources: {a: {width: 4096, height: 2048}, b: {width: 4096, height: 2048}}};
  assert.deepEqual(combinedRasterSize(layout, dungeon), {width: 4096, height: 1024});
  assert.equal(layout.width, 8192);
  const dungeons = JSON.parse(fs.readFileSync('data/dungeons.json'));
  for (const [id, map] of Object.entries(combinedLayouts)) {
    const dungeon = dungeons.find(d => d.id === id);
    const size = combinedRasterSize(map, dungeon);
    assert.equal(map.pixelWidth, size.width);
    assert.equal(map.pixelHeight, size.height);
    for (const [sourceId, transform] of Object.entries(map.artworkSources)) {
      const original = dungeon.mapImages.find(image => image.id === sourceId);
      assert.ok(transform.width * size.width / map.width <= original.width + .001);
      assert.ok(transform.height * size.height / map.height <= original.height + .001);
    }
  }
});

test('Public images are AVIF; Referenced uses private original JPEGs', () => {
  const used = usedImages();
  assert.ok(used.length > 0);
  for (const file of used) {
    assert.ok(file.endsWith('.avif'), file);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.toString('ascii', 4, 8), 'ftyp', file);
    assert.ok(bytes.subarray(8, 40).includes(Buffer.from('avif')), file);
  }
  for (const file of fs.readdirSync('images', {recursive: true, withFileTypes: true})) {
    if (file.isFile()) assert.ok(file.name.endsWith('.avif'), file.name);
  }
  for (const map of Object.values(fullMaps)) {
    assert.match(map.path, /^private\/images-referenced\/[^/]+\.jpg$/);
    assert.ok(usedImages({includeReferenced:true}).includes(map.path));
    assert.ok(!used.includes(map.path));
    assert.equal(fs.readFileSync(map.path).subarray(0,3).toString('hex'), 'ffd8ff');
  }
  assert.ok(!used.some(file => file.startsWith('images/dungeons/full/')));
  assert.ok(!used.some(file => file.startsWith('private/')));
  const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
  for(const dungeon of dungeons)for(const map of dungeon.mapImages){
    assert.match(map.path,dungeon.mapImages.length>1?/^private\/images\/dungeons\/maps\//:/^images\/dungeons\/maps\//);
    assert.ok(fs.existsSync(map.path));
    assert.ok(usedImages({includeLayers:true}).includes(map.path));
  }
});

test('Server serves AVIF MIME and rejects private paths including encoded traversal', async () => {
  const server = spawn(process.execPath, ['scripts/server.mjs'], {env: {...process.env, PORT: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
  try {
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      server.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {clearTimeout(timeout); resolve(match[0]);}
      });
      server.once('error', error => {clearTimeout(timeout); reject(error);});
      server.once('exit', code => {clearTimeout(timeout); reject(new Error(`Server exited: ${code}`));});
    });
    const response = await fetch(`${origin}/${usedImages()[0]}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/avif');
    await response.arrayBuffer();
    const jpeg = await fetch(`${origin}/${Object.values(fullMaps)[0].path}`);
    assert.equal(jpeg.status, 200);
    assert.equal(jpeg.headers.get('content-type'), 'image/jpeg');
    await jpeg.arrayBuffer();
    const layer=JSON.parse(fs.readFileSync('data/dungeons.json'))[0].mapImages[0];
    const layerResponse=await fetch(`${origin}/${layer.path}`);
    assert.equal(layerResponse.status,200);
    assert.equal(layerResponse.headers.get('content-type'),'image/avif');
    await layerResponse.arrayBuffer();
    for (const url of ['/private/images/dungeons/maps/unlisted.avif', '/private/images-referenced/a.jpg', '/private/images-archive/a.webp', '/images/..%2fprivate/images-referenced/a.jpg', '/images/%2e%2e%5cprivate/images-referenced/a.jpg', '/scripts/prepare-images.mjs']) {
      const result = await fetch(origin + url);
      assert.equal(result.status, 403, url);
      await result.text();
    }
  } finally {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
});
