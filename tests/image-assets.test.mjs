import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {usedImages} from '../scripts/image-assets.mjs';
import {combinedRasterSize,originalFor,compressionProfile,imageSizeLimits,resizeImageMetadata} from '../scripts/avif-assets.mjs';
import {combinedLayouts} from '../data/combined-layouts.js';
import {fullMaps} from '../data/full-maps.js';

test('Portrait limits follow catalog roles while map profiles never resize', () => {
  const limits = imageSizeLimits();
  for (const enemy of JSON.parse(fs.readFileSync('data/enemies.json'))) for (const image of enemy.images || []) {
    assert.ok(compressionProfile(image.path, limits).maxSize >= (enemy.isBoss ? 256 : 128));
  }
  for (const hero of JSON.parse(fs.readFileSync('data/heroes.json'))) for (const image of hero.images || []) {
    assert.equal(compressionProfile(image.path, limits).maxSize, 128);
  }
  assert.equal(compressionProfile('images/modifiers/winter-giant.avif', limits).maxSize, 64);
  for (const file of ['images/dungeons/combined/a.avif', 'images/dungeons/maps/a.avif', 'private/images/dungeons/maps/a.avif']) {
    const profile = compressionProfile(file, new Map([[file, 128]]));
    assert.equal(profile.maxSize, undefined);
    assert.equal(profile.quality, 85);
    assert.equal(profile.subsampling, '4:4:4');
  }
  const image = {width: 512, height: 256};
  resizeImageMetadata(image, 128);
  assert.deepEqual(image, {width: 128, height: 64});
  resizeImageMetadata(image, 256);
  assert.deepEqual(image, {width: 128, height: 64});
});

test('Active image originals come from game exports or our combined maps',()=>{
  for(const file of usedImages({includeLayers:true}))
    assert.match(originalFor(file),/^private\/(?:game-data\/|images-combined\/)/,file);
  assert.throws(()=>originalFor('images/enemies/obsolete-source.avif'),/Missing private original/);
});

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
    if (fs.existsSync(map.path)) assert.equal(fs.readFileSync(map.path).subarray(0,3).toString('hex'), 'ffd8ff');
  }
  assert.ok(!used.some(file => file.startsWith('images/dungeons/full/')));
  assert.ok(!used.some(file => file.startsWith('private/')));
  const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));
  for(const dungeon of dungeons)for(const map of dungeon.mapImages){
    assert.match(map.path,dungeon.mapImages.length>1?/^private\/images\/dungeons\/maps\//:/^images\/dungeons\/maps\//);
    if (!map.path.startsWith('private/')) assert.ok(fs.existsSync(map.path));
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
    const referenced = Object.values(fullMaps).find(map => fs.existsSync(map.path));
    const retouchedPath='private/images-combined/desertdunes-background-user.avif';
    if(fs.existsSync(retouchedPath)){
      const png=await fetch(`${origin}/${retouchedPath}`);
      assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/avif');
      await png.arrayBuffer();
    }
    if (referenced) {
      const jpeg = await fetch(`${origin}/${referenced.path}`);
      assert.equal(jpeg.status, 200);
      assert.equal(jpeg.headers.get('content-type'), 'image/jpeg');
      await jpeg.arrayBuffer();
    }
    const layer=JSON.parse(fs.readFileSync('data/dungeons.json')).flatMap(dungeon=>dungeon.mapImages).find(map=>map.path.startsWith('private/')&&fs.existsSync(map.path));
    if (layer) {
      const layerResponse=await fetch(`${origin}/${layer.path}`);
      assert.equal(layerResponse.status,200);
      assert.equal(layerResponse.headers.get('content-type'),'image/avif');
      await layerResponse.arrayBuffer();
    }
    for (const url of ['/private/images-combined/map-background-project-user.json','/private/images-combined/desertdunes-background-v6.png','/private/images/dungeons/maps/unlisted.avif', '/private/images-referenced/a.jpg', '/private/images-archive/a.webp', '/images/..%2fprivate/images-referenced/a.jpg', '/images/%2e%2e%5cprivate/images-referenced/a.jpg', '/scripts/prepare-images.mjs']) {
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
