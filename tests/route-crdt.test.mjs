import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRouteDocument, restoreRouteDocument} from '../collaboration/route-document.js';
import {migrateRoute} from '../collaboration/route-migration.js';
import {COMMAND_TYPES} from '../collaboration/route-commands.js';
import {newRoute, newPull, movePull, validateRoute, scoreRoute, encodeRoute, decodeRoute} from '../route-model.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {mapViews} from '../map-views.js';
const read = name => JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const dungeons = read('dungeons').map(correctDungeon), enemies = new Map(read('enemies').map(e => [e.id, e]));
const dungeon = dungeons.find(d => d.name === "Sailor's Abyss"), mapId = mapViews(dungeon)[0].id;
const options = {dungeon, enemies, role: 'player'};
const mobs = dungeon.enemies.filter(p => !enemies.get(p.id)?.isBoss).slice(0, 8).map(p => p.placementId);
const boss = dungeon.enemies.find(p => enemies.get(p.id)?.isBoss).placementId;
const clone = (doc, role = 'player') => restoreRouteDocument(doc.exportSnapshot(), {...options, role});
function seed(t, count = 3) {
  const doc = createRouteDocument({id: 'test-route', dungeonId: dungeon.id, buildId: 'test', name: 'Route'}, options);
  for (let i = 0; i < count; i++) doc.execute({type: 'add-pull', id: `pull-${i}`});
  t.after(() => doc.dispose());
  return doc;
}
function peer(t, doc, role) {const result = clone(doc, role); t.after(() => result.dispose()); return result;}
function sync(...docs) {
  const packets = docs.map(doc => doc.exportUpdate());
  for (const doc of docs) for (const packet of [...packets].reverse()) {doc.import(packet); doc.import(packet);}
  const expected = docs[0].canonical();
  for (const doc of docs) assert.equal(doc.canonical(), expected);
}
function addDrawing(doc, kind = 'line', key = 'drawing') {
  return doc.execute({type: 'add-drawing', id: key, mapId, kind, points: kind === 'note' ? [[10, 20]] : [[10, 20], [30, 40]],
    pointIds: kind === 'note' ? ['point-0'] : ['point-0', 'point-1'], text: ''});
}
function assertUnchanged(doc, fn, pattern) {
  const before = doc.canonical(), version = doc.version();
  assert.throws(fn, pattern);
  assert.equal(doc.canonical(), before); assert.deepEqual(doc.version(), version);
}

test('Concurrent inserts and moves converge without duplicate pull IDs; colors stay at positions', t => {
  const a = seed(t), b = peer(t, a), colors = a.snapshot().pulls.map(p => p.color);
  a.execute({type: 'move-pull', pullId: 'pull-0', afterId: 'pull-2'});
  b.execute({type: 'move-pull', pullId: 'pull-0', beforeId: 'pull-1'});
  sync(a, b);
  assert.equal(a.snapshot().pulls.filter(p => p.id === 'pull-0').length, 1);
  assert.deepEqual(a.snapshot().pulls.map(p => p.color), colors);
  a.execute({type: 'add-pull', id: 'from-a', beforeId: 'pull-1'});
  b.execute({type: 'add-pull', id: 'from-b', beforeId: 'pull-1'});
  sync(a, b);
  assert.equal(a.snapshot().pulls.length, 5);
  assert.deepEqual(a.snapshot().pulls.map(p => p.name), ['Pull 1', 'Pull 2', 'Pull 3', 'Pull 4', 'Pull 5']);
});

test('Different pull moves, missing anchors and conflicting relative intentions converge', t => {
  const a = seed(t, 4), b = peer(t, a);
  a.execute({type: 'move-pull', pullId: 'pull-3', beforeId: 'pull-1'});
  b.execute({type: 'move-pull', pullId: 'pull-2', afterId: 'pull-1'});
  sync(a, b);
  a.execute({type: 'move-pull', pullId: 'pull-0', afterId: 'pull-1'});
  b.execute({type: 'move-pull', pullId: 'pull-1', afterId: 'pull-0'});
  sync(a, b);
  a.execute({type: 'move-pull', pullId: 'pull-0', beforeId: 'missing', afterId: 'also-missing'});
  assert.equal(a.snapshot().pulls.at(-1).id, 'pull-0');
  assertUnchanged(a, () => a.execute({type: 'move-pull', pullId: 'pull-0', beforeId: 'pull-0'}), /anchor/);
});

test('Pull deletion wins over move, assignment and rename, including after snapshot restoration', t => {
  const a = seed(t), b = peer(t, a);
  a.execute({type: 'delete-pull', pullId: 'pull-1'});
  b.execute({type: 'move-pull', pullId: 'pull-1', beforeId: 'pull-0'});
  b.execute({type: 'assign-mobs', pullId: 'pull-1', mobIds: [mobs[0]]});
  b.execute({type: 'update-pull', pullId: 'pull-1', patch: {name: 'Late edit'}});
  sync(a, b);
  const restored = peer(t, a); sync(restored, b);
  assert.ok(!restored.snapshot().pulls.some(p => p.id === 'pull-1' || p.enemies.includes(mobs[0])));
  assertUnchanged(restored, () => restored.execute({type: 'add-pull', id: 'pull-1'}), /used/);
});

test('One mob has one assignment; independent pull fields and route fields survive', t => {
  const a = seed(t), b = peer(t, a);
  a.execute({type: 'assign-mobs', pullId: 'pull-0', mobIds: [mobs[0]]});
  b.execute({type: 'assign-mobs', pullId: 'pull-1', mobIds: [mobs[0]]});
  a.execute({type: 'update-pull', pullId: 'pull-0', patch: {name: 'Boss'}});
  b.execute({type: 'update-pull', pullId: 'pull-0', patch: {color: '#abcdef'}});
  a.execute({type: 'set-meta', patch: {name: 'Team route'}});
  b.execute({type: 'set-meta', patch: {shadow: true}});
  sync(a, b);
  const view = a.snapshot();
  assert.equal(view.pulls.flatMap(p => p.enemies).filter(id => id === mobs[0]).length, 1);
  assert.equal(view.pulls[0].name, 'Boss'); assert.equal(view.pulls[0].color, '#abcdef');
  assert.equal(view.name, 'Team route'); assert.equal(view.shadow, true);
});

test('Legacy colors, manual names, scoring and compact view remain compatible with solo moves', t => {
  const route = newRoute(dungeon, 'test'); route.pulls.push(newPull(1), newPull(2));
  route.pulls[1].name = 'Boss'; route.pulls[1].customName = true; route.pulls[1].enemies = [mobs[0]];
  route.drawings = [{id: 'saved-note', kind: 'note', mapId, color: '#abcdef', text: 'Привет 🧭', points: [[1, 2]]}];
  const a = migrateRoute(route, {dungeons, enemies}); t.after(() => a.dispose());
  a.execute({type: 'move-pull', pullId: route.pulls[1].id, beforeId: route.pulls[0].id});
  movePull(route, 1, 0);
  assert.deepEqual(a.snapshot().pulls, route.pulls);
  assert.deepEqual(scoreRoute(a.snapshot(), dungeon, enemies, read('shadow-reference')), scoreRoute(route, dungeon, enemies, read('shadow-reference')));
  assert.equal(a.snapshot().drawings[0].id, 'saved-note');
  const restored = peer(t, a); assert.equal(restored.canonical(), a.canonical());
  assert.notEqual(restored.peerId, a.peerId);
  a.execute({type: 'delete-pull', pullId: route.pulls[0].id}); route.pulls.splice(0, 1);
  assert.deepEqual(a.snapshot().pulls.map(p => p.color), route.pulls.map(p => p.color));
});

test('All annotations can be created concurrently; independent marker properties merge', t => {
  const a = seed(t), b = peer(t, a);
  for (const [doc, prefix] of [[a, 'a'], [b, 'b']]) {
    for (const kind of ['line', 'portal', 'invis', 'note']) addDrawing(doc, kind, `${prefix}-${kind}`);
    doc.execute({type: 'add-marker', id: `${prefix}-marker`, mapId, position: [4, 5]});
  }
  sync(a, b); assert.equal(a.snapshot().drawings.length, 8); assert.equal(a.snapshot().markers.length, 2);
  a.execute({type: 'update-marker', markerId: 'a-marker', patch: {position: [60, 70]}});
  b.execute({type: 'update-marker', markerId: 'a-marker', patch: {color: '#fedcba', icon: 'skull'}});
  sync(a, b);
  const marker = a.snapshot().markers.find(m => m.id === 'a-marker');
  assert.deepEqual(marker.position, [60, 70]); assert.equal(marker.color, '#fedcba'); assert.equal(marker.icon, 'skull');
});

test('Concurrent note, pull note and marker label text preserves both users input', t => {
  const a = seed(t); addDrawing(a, 'note', 'note');
  a.execute({type: 'add-marker', id: 'marker', mapId, position: [1, 2]});
  const b = peer(t, a);
  for (const [group, id] of [['pulls', 'pull-0'], ['drawings', 'note'], ['markers', 'marker']]) {
    a.execute({type: 'edit-text', group, id, index: 0, deleteCount: 0, text: 'A🧭'});
    b.execute({type: 'edit-text', group, id, index: 0, deleteCount: 0, text: 'Б🐉'});
  }
  sync(a, b);
  for (const text of [a.snapshot().pulls[0].note, a.snapshot().drawings[0].text, a.snapshot().markers[0].label]) {
    assert.ok(text.includes('A🧭')); assert.ok(text.includes('Б🐉'));
  }
  a.execute({type: 'set-text', group: 'drawings', id: 'note', text: 'hello world'}); sync(a, b);
  a.execute({type: 'set-text', group: 'drawings', id: 'note', text: 'hello brave world'});
  b.execute({type: 'set-text', group: 'drawings', id: 'note', text: 'hello world!'});
  sync(a, b); assert.equal(a.snapshot().drawings[0].text, 'hello brave world!');
});

test('Line insertion and editing another point merge; coordinates are independent per point', t => {
  const a = seed(t); addDrawing(a); const b = peer(t, a);
  a.execute({type: 'insert-point', drawingId: 'drawing', id: 'mid', beforeId: 'point-1', position: [20, 30]});
  b.execute({type: 'move-point', drawingId: 'drawing', pointId: 'point-1', position: [100, 200]});
  sync(a, b);
  assert.deepEqual(a.snapshot().drawings[0].points, [[10, 20], [20, 30], [100, 200]]);
  a.execute({type: 'move-point', drawingId: 'drawing', pointId: 'point-0', position: [5, 6]});
  b.execute({type: 'move-point', drawingId: 'drawing', pointId: 'point-1', position: [7, 8]});
  sync(a, b); assert.deepEqual(a.snapshot().drawings[0].points, [[5, 6], [20, 30], [7, 8]]);
  a.execute({type: 'delete-point', drawingId: 'drawing', pointId: 'mid'});
  b.execute({type: 'move-point', drawingId: 'drawing', pointId: 'mid', position: [999, 999]});
  sync(a, b); assert.deepEqual(a.snapshot().drawings[0].pointIds, ['point-0', 'point-1']);
});

test('Deleted paths, notes and markers cannot reappear through late edits or restores', t => {
  const a = seed(t); addDrawing(a); addDrawing(a, 'note', 'note');
  a.execute({type: 'add-marker', id: 'marker', mapId, position: [1, 2]});
  const b = peer(t, a);
  a.execute({type: 'delete-drawing', drawingId: 'drawing'}); a.execute({type: 'delete-drawing', drawingId: 'note'});
  a.execute({type: 'delete-marker', markerId: 'marker'});
  b.execute({type: 'move-point', drawingId: 'drawing', pointId: 'point-0', position: [3, 4]});
  b.execute({type: 'set-text', group: 'drawings', id: 'note', text: 'late'});
  b.execute({type: 'update-marker', markerId: 'marker', patch: {position: [3, 4]}});
  sync(a, b); const c = peer(t, a); sync(c, b);
  assert.deepEqual(c.snapshot().drawings, []); assert.deepEqual(c.snapshot().markers, []);
});

test('Spectator rejects every command without local operations but receives and exports updates', t => {
  const a = seed(t), b = peer(t, a, 'spectator'), local = [], changes = [];
  b.subscribeLocalUpdates(packet => local.push(packet)); b.subscribe(event => changes.push(event));
  for (const type of [...COMMAND_TYPES, 'undo', 'redo', 'import-route']) {
    assertUnchanged(b, () => b.execute({type}), /Spectators/);
  }
  assert.throws(() => createRouteDocument({dungeonId: dungeon.id}, {...options, role: 'spectator'}), /Spectators/);
  assert.throws(() => migrateRoute(newRoute(dungeon, 'test'), {dungeons, enemies, role: 'spectator'}), /Spectators/);
  a.execute({type: 'set-meta', patch: {name: 'Visible to spectator'}});
  b.import(a.exportUpdate(b.version()));
  assert.equal(a.canonical(), b.canonical()); assert.equal(local.length, 0); assert.ok(changes.length);
  const copy = peer(t, b, 'spectator'); assert.equal(copy.canonical(), b.canonical());
  assert.equal(copy.role, 'spectator');
  const view = b.snapshot(); view.name = 'Local JS mutation'; view.pulls.length = 0;
  assert.equal(b.canonical(), a.canonical());
});

test('Malformed commands and Unicode boundaries fail atomically, metadata and UI fields are protected', t => {
  const a = seed(t); addDrawing(a);
  a.execute({type: 'set-text', group: 'pulls', id: 'pull-0', text: '🧭'});
  const commands = [
    {type: 'set-meta', patch: {name: 'changed', routeId: 'other'}},
    {type: 'set-meta', patch: {zoom: 5}},
    {type: 'set-meta', patch: {shadow: 'true'}},
    {type: 'update-pull', pullId: 'pull-0', patch: {name: 'changed', color: 'bad'}},
    {type: 'assign-mobs', pullId: 'pull-0', mobIds: [mobs[0], 'foreign']},
    {type: 'set-excluded', mobId: boss, excluded: true},
    {type: 'add-drawing', mapId, kind: 'line', points: [[1, 2], [3, NaN]]},
    {type: 'add-drawing', mapId: 'foreign', kind: 'note', points: [[1, 2]]},
    {type: 'update-drawing', drawingId: 'drawing', patch: {color: '#abcdef', width: 100}},
    {type: 'insert-point', drawingId: 'drawing', id: 'point-0', position: [1, 2]},
    {type: 'delete-point', drawingId: 'drawing', pointId: 'point-0'},
    {type: 'edit-text', group: 'pulls', id: 'pull-0', index: 1, deleteCount: 0, text: 'bad'},
    {type: 'edit-text', group: 'pulls', id: 'pull-0', index: 0, deleteCount: 1, text: ''},
    {type: 'edit-text', group: 'pulls', id: 'pull-0', index: 2, deleteCount: -1, text: ''},
    {type: 'set-modifier', kind: 'ghorn', patch: {active: true}},
  ];
  for (const command of commands) assertUnchanged(a, () => a.execute(command));
});

test('Foreign identities, schemas, independently initialized JSON copies and corrupt bytes are rejected', t => {
  const a = seed(t), b = createRouteDocument({id: 'foreign', dungeonId: dungeon.id}, options);
  t.after(() => b.dispose());
  const independent = createRouteDocument({id: a.identity.routeId, dungeonId: dungeon.id}, options);
  t.after(() => independent.dispose());
  assertUnchanged(a, () => a.import(b.exportSnapshot()), /Different/);
  assertUnchanged(a, () => a.import(independent.exportUpdate()), /Different/);
  const spoofed = {...b.exportSnapshot(), identity: {...a.identity}};
  assertUnchanged(a, () => a.import(spoofed), /identity mismatch/);
  assert.throws(() => restoreRouteDocument(spoofed, options), /identity mismatch/);
  assertUnchanged(a, () => a.import({...a.exportSnapshot(), identity: {...a.identity, schemaVersion: 999}}), /schema/);
  assertUnchanged(a, () => a.import({...a.exportSnapshot(), bytes: new Uint8Array([1, 2, 3])}));
  assertUnchanged(a, () => a.exportUpdate(b.version()), /Different/);
});

test('Out-of-order deltas, duplicate delivery and missed updates heal via version-vector diff without echoes', t => {
  const a = seed(t), b = peer(t, a), out = [], echoes = [];
  const stop = a.subscribeLocalUpdates(packet => out.push(packet));
  b.subscribeLocalUpdates(packet => echoes.push(packet));
  a.execute({type: 'add-pull', id: 'first'});
  a.execute({type: 'update-pull', pullId: 'first', patch: {name: 'Second change'}});
  assert.equal(out.length, 2); b.import(out[1]); b.import(out[1]);
  b.import(a.exportUpdate(b.version()));
  assert.equal(b.canonical(), a.canonical()); assert.equal(echoes.length, 0);
  stop(); a.execute({type: 'set-meta', patch: {name: 'After unsubscribe'}}); assert.equal(out.length, 2);
  sync(a, b);
});

test('Offline edits merge with stale snapshots and late peers restore all entity types and settings', t => {
  const a = seed(t); addDrawing(a); addDrawing(a, 'note', 'note');
  a.execute({type: 'add-marker', id: 'marker', mapId, position: [1, 2]});
  const b = peer(t, a), stale = a.exportSnapshot();
  a.execute({type: 'set-text', group: 'drawings', id: 'note', text: 'A note'});
  b.execute({type: 'update-marker', markerId: 'marker', patch: {color: '#abcdef'}});
  a.execute({type: 'set-excluded', mobId: mobs[0], excluded: true});
  b.execute({type: 'set-modifier', kind: 'empowered', patch: {active: true, enemies: [mobs[1]]}});
  a.import(stale); assert.equal(a.snapshot().drawings.find(d => d.id === 'note').text, 'A note');
  sync(a, b); const c = peer(t, a);
  assert.equal(c.canonical(), a.canonical()); assert.equal(c.snapshot().markers.length, 1);
  assert.deepEqual(c.snapshot().excluded, [mobs[0]]); assert.deepEqual(c.snapshot().modifiers.empowered.enemies, [mobs[1]]);
  assert.equal(c.snapshot().modifiers.empowered.active, true);
});

test('Concurrent replacement choices have a deterministic non-overlapping visible result', t => {
  const packId = dungeon.enemies.find(p => mobs.includes(p.placementId)).packId;
  const a = seed(t), b = peer(t, a);
  a.execute({type: 'set-modifier', kind: 'ghorn', patch: {packId, active: true}});
  b.execute({type: 'set-modifier', kind: 'witch', patch: {packId, active: true}});
  sync(a, b); const mods = a.snapshot().modifiers;
  assert.equal(mods.ghorn.active, true); assert.equal(mods.witch.active, false);
});

test('Clear observes existing objects, preserves route identity and cannot resurrect objects after late edits', t => {
  const a = seed(t); addDrawing(a); const b = peer(t, a), identity = a.identity;
  a.execute({type: 'clear-route'});
  b.execute({type: 'update-pull', pullId: 'pull-0', patch: {name: 'late'}});
  b.execute({type: 'add-pull', id: 'concurrent-new'});
  sync(a, b); assert.deepEqual(a.identity, identity);
  assert.deepEqual(a.snapshot().pulls.map(p => p.id), ['concurrent-new']); assert.deepEqual(a.snapshot().drawings, []);
});

test('Repeated seeded operations on five independent peers converge and preserve domain invariants', t => {
  const first = seed(t, 4), peers = [first, ...Array.from({length: 4}, () => peer(t, first))];
  let state = 7471;
  const random = n => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n;};
  for (let i = 0; i < 180; i++) {
    const doc = peers[random(peers.length)], view = doc.snapshot(), pulls = view.pulls;
    const pick = pulls.length ? pulls[random(pulls.length)].id : null;
    switch (random(7)) {
      case 0: doc.execute({type: 'add-pull', id: `random-${i}`, beforeId: pick}); break;
      case 1: if (pick) doc.execute({type: 'delete-pull', pullId: pick}); break;
      case 2: if (pick) doc.execute({type: 'assign-mobs', pullId: pick, mobIds: [mobs[random(mobs.length)]]}); break;
      case 3: if (pulls.length > 1) {
        const target = pulls.find(p => p.id !== pick).id;
        doc.execute({type: 'move-pull', pullId: pick, beforeId: target});
      } break;
      case 4: if (pick) doc.execute({type: 'set-text', group: 'pulls', id: pick, text: `Peer update ${i}`}); break;
      case 5: doc.execute({type: 'add-marker', id: `marker-${i}`, mapId, position: [i, i + 1]}); break;
      case 6: if (view.markers.length) doc.execute({type: 'delete-marker', markerId: view.markers[random(view.markers.length)].id}); break;
    }
    if (i % 19 === 0) {
      const target = peers[random(peers.length)];
      target.import(doc.exportUpdate(target.version()));
    }
  }
  sync(...peers);
  const view = first.snapshot(), assigned = view.pulls.flatMap(p => p.enemies);
  assert.equal(new Set(view.pulls.map(p => p.id)).size, view.pulls.length);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.deepEqual(view.pulls.map(p => p.name), view.pulls.map((_, i) => `Pull ${i + 1}`));
  assert.equal(new Set(peers.map(doc => doc.peerId)).size, 5);
});

test('Concurrent lazy modifier initialization merges distinct fields', t => {
  const a = seed(t), b = peer(t, a);
  a.execute({type: 'set-modifier', kind: 'empowered', patch: {active: true}});
  b.execute({type: 'set-modifier', kind: 'empowered', patch: {enemies: [mobs[0], mobs[1]]}});
  sync(a, b);
  assert.equal(a.snapshot().modifiers.empowered.active, true);
  assert.deepEqual(a.snapshot().modifiers.empowered.enemies, [mobs[0], mobs[1]].sort());
});

test('Concurrent deletions cannot expose an invalid one-point line; its tombstones survive', t => {
  const a = seed(t); addDrawing(a);
  a.execute({type: 'insert-point', drawingId: 'drawing', id: 'mid', position: [20, 30], beforeId: 'point-1'});
  const b = peer(t, a);
  a.execute({type: 'delete-point', drawingId: 'drawing', pointId: 'point-0'});
  b.execute({type: 'delete-point', drawingId: 'drawing', pointId: 'point-1'});
  sync(a, b); assert.deepEqual(a.snapshot().drawings, []);
  const c = peer(t, a);
  assertUnchanged(c, () => c.execute({type: 'insert-point', drawingId: 'drawing', id: 'point-0', position: [1, 2]}), /used/);
  c.execute({type: 'insert-point', drawingId: 'drawing', id: 'fresh', position: [2, 3]});
  assert.deepEqual(c.snapshot().drawings[0].pointIds, ['mid', 'fresh']);
});

test('Spectator is the restore default, dispose releases subscriptions and rejects later access', t => {
  const a = seed(t), b = restoreRouteDocument(a.exportSnapshot(), {dungeon, enemies});
  assert.equal(b.role, 'spectator');
  b.dispose(); b.dispose();
  assert.throws(() => b.snapshot(), /disposed/);
  assert.throws(() => b.execute({type: 'clear-route'}), /disposed/);
  assert.throws(() => b.import(a.exportSnapshot()), /disposed/);
});

test('Initial route normalization retains manual names and assigns missing pull IDs', t => {
  const doc = createRouteDocument({dungeonId: dungeon.id, pulls: [{name: 'Boss', enemies: [mobs[0]]}]}, options);
  t.after(() => doc.dispose());
  assert.equal(doc.snapshot().pulls[0].name, 'Boss');
  assert.ok(doc.snapshot().pulls[0].id); assert.deepEqual(doc.snapshot().pulls[0].enemies, [mobs[0]]);
  assertUnchanged(doc, () => doc.execute({type: 'add-drawing', mapId, kind: 'line',
    points: [[1, 2], [3, 4]], pointIds: ['a', 'a', 'b']}), /Point IDs/);
});
test('Migration covers real routes and modifier presets in every dungeon without changing scores', t => {
  for (const dungeon of dungeons) {
    const legacy = newRoute(dungeon, 'test');
    legacy.pulls[0].enemies = dungeon.enemies.map(p => p.placementId);
    const doc = migrateRoute(legacy, {dungeons, enemies, presets: read('modifier-placements')});
    t.after(() => doc.dispose());
    const snapshot = doc.snapshot();
    const expected = validateRoute(legacy, dungeons, enemies);
    assert.equal(snapshot.id, legacy.id);
    assert.equal(snapshot.pulls[0].id, legacy.pulls[0].id);
    assert.deepEqual(scoreRoute(snapshot, dungeon, enemies, read('shadow-reference')),
      scoreRoute(expected, dungeon, enemies, read('shadow-reference')));
    const copy = restoreRouteDocument(doc.exportSnapshot(), {dungeon, enemies, role: 'spectator'});
    t.after(() => copy.dispose()); assert.equal(copy.canonical(), doc.canonical());
  }
});
test('Local Undo preserves remote fields and text; restored history starts empty', t => {
  const original = seed(t), a = peer(t, original), b = peer(t, original);
  assert.equal(a.canUndo(), false);
  a.execute({type: 'edit-text', group: 'pulls', id: 'pull-0', index: 0, deleteCount: 0, text: 'Alice'});
  b.execute({type: 'edit-text', group: 'pulls', id: 'pull-0', index: 0, deleteCount: 0, text: 'Bob'});
  b.execute({type: 'set-meta', patch: {shadow: true}});
  sync(a, b); a.undo(); sync(a, b);
  assert.equal(a.snapshot().pulls[0].note, 'Bob'); assert.equal(a.snapshot().shadow, true);
  a.redo(); sync(a, b); assert.match(a.snapshot().pulls[0].note, /Alice/); assert.match(a.snapshot().pulls[0].note, /Bob/);
  const restored = peer(t, a); assert.equal(restored.canUndo(), false);
});

test('Undo of a deletion cannot clear a concurrent deletion by another player', t => {
  const original = seed(t); addDrawing(original);
  original.execute({type: 'add-marker', id: 'marker', mapId, position: [1,2]});
  const a = peer(t, original), b = peer(t, original);
  const commands = [{type: 'delete-pull', pullId: 'pull-0'}, {type: 'delete-drawing', drawingId: 'drawing'}, {type: 'delete-marker', markerId: 'marker'}];
  a.executeBatch(commands); b.executeBatch(commands); sync(a,b); a.undo(); sync(a,b);
  assert.equal(a.snapshot().pulls.length, 2); assert.equal(a.snapshot().drawings.length, 0); assert.equal(a.snapshot().markers.length, 0);
  b.undo(); sync(a,b); assert.equal(a.snapshot().pulls.length,3); assert.equal(a.snapshot().drawings[0].id,'drawing'); assert.equal(a.snapshot().markers.length,1);
  a.redo(); sync(a,b); assert.equal(a.snapshot().drawings.length,0);
});

test('Batch validates before writes and creates a single Undo step; spectator cannot use history', t => {
  const original=seed(t), a=peer(t,original), spectator=peer(t,original,'spectator');
  assertUnchanged(a,()=>a.executeBatch([{type:'set-meta',patch:{name:'Changed'}},{type:'delete-pull',pullId:'missing'}]),/deleted|Unknown|exist/i);
  assert.equal(a.canUndo(),false);
  a.executeBatch([{type:'set-meta',patch:{name:'Changed'}},{type:'set-meta',patch:{shadow:true}}]);
  a.undo(); assert.equal(a.canonical(),original.canonical()); assert.equal(a.canUndo(),false);
  a.redo();assert.equal(a.snapshot().name,'Changed');assert.equal(a.snapshot().shadow,true);
  for(const fn of [()=>spectator.undo(),()=>spectator.redo(),()=>spectator.executeBatch([{type:'clear-route'}])])assertUnchanged(spectator,fn,/spectator/i);
  assert.equal(spectator.canUndo(),false);assert.equal(spectator.canRedo(),false);
});

test('Undo clear restores original IDs and geometry, leaving unseen remote inserts untouched', t=>{
  const original=seed(t);addDrawing(original);const a=peer(t,original),b=peer(t,original);
  a.execute({type:'clear-route'});b.execute({type:'add-pull',id:'remote'});sync(a,b);
  a.undo();sync(a,b);assert.equal(a.snapshot().pulls.length,4);assert.deepEqual(a.snapshot().drawings,original.snapshot().drawings);
  a.redo();sync(a,b);assert.deepEqual(a.snapshot().pulls.map(p=>p.id),['remote']);assert.equal(a.snapshot().drawings.length,0);
});

test('Export and independent import preserve text grown beyond one editor limit by concurrent inserts', async t=>{
  const original=seed(t),a=peer(t,original),b=peer(t,original);
  for(const [doc,text] of [[a,'A'.repeat(4000)],[b,'B'.repeat(4000)]])doc.execute({type:'edit-text',group:'pulls',id:'pull-0',index:0,deleteCount:0,text});
  sync(a,b);const encoded=await encodeRoute(a.snapshot(),dungeon);assert.match(encoded,/^R2\./);
  const imported=createRouteDocument(await decodeRoute(encoded,[dungeon],enemies),options);t.after(()=>imported.dispose());
  assert.equal(imported.snapshot().pulls[0].note,a.snapshot().pulls[0].note);
});
