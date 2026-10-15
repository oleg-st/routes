// Model/WASM smoke test in independent browser contexts; no room/UI integration yet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle = await build({entryPoints: ['collaboration/route-document.js'], bundle: true, write: false,
  platform: 'browser', format: 'iife', globalName: 'RouteTogether', target: 'es2022',
  alias: {'loro-crdt': 'loro-crdt/base64'}});
const dungeons = JSON.parse(fs.readFileSync('data/dungeons.json')), enemies = JSON.parse(fs.readFileSync('data/enemies.json'));
const dungeon = dungeons.find(d => d.mapImages.length === 1);
const server = spawn(process.execPath, ['scripts/server.mjs'], {env: {...process.env, PORT: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.stdout.on('data', data => {
      const url = String(data).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {clearTimeout(timeout); resolve(url);}
    });
    server.once('error', error => {clearTimeout(timeout); reject(error);});
    server.once('exit', code => {clearTimeout(timeout); reject(new Error(`Server exited: ${code}`));});
  });
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const contexts = await Promise.all(Array.from({length: 3}, () => browser.newContext()));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    // Empty same-origin test surface avoids starting the solo editor.
    await page.route(`${origin}/crdt-model-test`, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Route Together model test</title>'}));
    await page.goto(`${origin}/crdt-model-test`);
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.evaluate(({dungeon, enemies}) => {
      window.modelOptions = {dungeon, enemies: new Map(enemies.map(e => [e.id, e])), role: 'player'};
      window.pack = packet => ({...packet, bytes: Array.from(packet.bytes)});
      window.unpack = packet => ({...packet, bytes: new Uint8Array(packet.bytes)});
    }, {dungeon, enemies});
  }
  const [a, b, spectator] = pages;
  const initial = await a.evaluate(() => {
    window.doc = RouteTogether.createRouteDocument({dungeonId: modelOptions.dungeon.id, name: 'Browser route'}, modelOptions);
    doc.execute({type: 'add-pull', id: 'pull'});
    doc.execute({type: 'add-drawing', id: 'note', kind: 'note', mapId: modelOptions.dungeon.mapImages[0].id, points: [[10, 20]]});
    return pack(doc.exportSnapshot());
  });
  await b.evaluate(packet => {window.doc = RouteTogether.restoreRouteDocument(unpack(packet), modelOptions);}, initial);
  await spectator.evaluate(packet => {
    window.doc = RouteTogether.restoreRouteDocument(unpack(packet), {...modelOptions, role: 'spectator'});
    window.localUpdates = 0; doc.subscribeLocalUpdates(() => localUpdates++);
  }, initial);
  await a.evaluate(() => doc.execute({type: 'edit-text', group: 'drawings', id: 'note', index: 0, deleteCount: 0, text: 'A🧭'}));
  await b.evaluate(() => doc.execute({type: 'edit-text', group: 'drawings', id: 'note', index: 0, deleteCount: 0, text: 'Б🐉'}));
  const packets = await Promise.all([a, b].map(page => page.evaluate(() => pack(doc.exportUpdate()))));
  for (const page of pages) for (const packet of packets) await page.evaluate(packet => doc.import(unpack(packet)), packet);
  const states = await Promise.all(pages.map(page => page.evaluate(() => ({peerId: doc.peerId, state: doc.canonical(), text: doc.snapshot().drawings[0].text}))));
  assert.equal(new Set(states.map(state => state.peerId)).size, 3);
  assert.equal(new Set(states.map(state => state.state)).size, 1);
  assert.ok(states[0].text.includes('A🧭') && states[0].text.includes('Б🐉'));
  const blocked = await spectator.evaluate(() => {
    const before = doc.canonical();
    try {doc.execute({type: 'clear-route'}); return false;} catch (error) {
      return /Spectators/.test(error.message) && doc.canonical() === before && localUpdates === 0;
    }
  });
  assert.equal(blocked, true); assert.deepEqual(errors, []);
  console.log('Browser CRDT: 2 players + 1 spectator; independent peers, text convergence, read-only role and no update echo passed.');
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {const stopped = once(server, 'exit'); server.kill(); await stopped;}
}
