import {LoroDoc, VersionVector, UndoManager} from 'loro-crdt';
import {drawingMap} from '../map-views.js';
import {hasCustomPullName} from '../route-model.js';
import {SCHEMA_VERSION, MODIFIERS, invariant, record, id, string, role, assertPlayer, uuid, canonical} from './route-schema.js';
import {executeCommand} from './route-commands.js';
import {selectRoute, canonicalRoute} from './route-selectors.js';

function makeContext(identity, {dungeon, enemies}) {
  invariant(dungeon?.id === identity.dungeonId && enemies instanceof Map, 'Matching dungeon and enemy catalogue required.');
  const placements = new Map(dungeon.enemies.map(p => [p.placementId, p]));
  const bosses = new Set(dungeon.enemies.filter(p => enemies.get(p.id)?.isBoss).map(p => p.placementId));
  return {
    bosses,
    map(key) {invariant(drawingMap(dungeon, key), 'Unknown map.');},
    originalMob(key) {invariant(placements.has(key), 'Unknown enemy placement.');},
    mob(key, doc) {
      if (placements.has(key)) return;
      invariant(['modifier:ghorn', 'modifier:witch'].includes(key) &&
        doc.getMap('modifiers').get(key.slice(9))?.get('replacement')?.packId, 'Unknown enemy placement.');
    },
    pack(key, members) {
      const pack = dungeon.enemies.filter(p => p.packId === key);
      invariant(pack.length && pack.every(p => !bosses.has(p.placementId)), 'Choose a non-boss pack.');
      if (members !== undefined) invariant(members.length && members.every(member => placements.has(member) && !bosses.has(member)), 'Invalid replacement enemies.');
    },
  };
}
function checkIdentity(identity) {
  record(identity, ['schemaVersion', 'routeId', 'documentId', 'dungeonId', 'buildId']);
  invariant(identity.schemaVersion === SCHEMA_VERSION, 'Unsupported CRDT schema.');
  for (const key of ['routeId', 'documentId', 'dungeonId']) id(identity[key]);
  string(identity.buildId);
  return Object.freeze({...identity});
}
function identityKey(identity) {return JSON.stringify(canonical(identity));}
function checkPacket(packet, identity, kinds) {
  record(packet, ['identity', 'kind', 'bytes']);
  const incoming = checkIdentity(packet.identity);
  invariant(!identity || identityKey(incoming) === identityKey(identity), 'Different route or document lineage.');
  invariant(kinds.includes(packet.kind), 'Invalid packet kind.');
  invariant(packet.bytes instanceof Uint8Array && packet.bytes.length > 0 && packet.bytes.length <= 32 * 1024 * 1024, 'Invalid document bytes.');
  return incoming;
}
function checkDocument(doc, identity) {
  const origins = doc.getMap('identity').keys();
  invariant(origins.length === 1 && origins[0] === identityKey(identity), 'Binary document identity mismatch.');
  const view = selectRoute(doc, identity);
  string(view.name); invariant(view.name.trim(), 'Missing route name.');
  return view;
}
function wrap(doc, identity, options) {
  const participantRole = role(options.role ?? 'spectator'), context = makeContext(identity, options);
  let disposed = false, writing = false;
  const subscriptions = new Set(), packetListeners = new Set();
  const history = new UndoManager(doc, {mergeInterval: 0, maxUndoSteps: 60});
  const alive = () => invariant(!disposed, 'Document is disposed.');
  const write = fn => {
    alive(); invariant(!writing, 'Reentrant document mutation.'); writing = true;
    try {return fn();} finally {writing = false;}
  };
  const packet = (kind, bytes) => ({identity: {...identity}, kind, bytes});
  const notifyPacket = value => {for (const listener of packetListeners) listener(value);};
  const stopPackets = doc.subscribeLocalUpdates(bytes => notifyPacket(packet('update', bytes)));
  const subscribe = (fn, local) => {
    alive(); invariant(typeof fn === 'function', 'Expected a listener.');
    const stop = local ? doc.subscribeLocalUpdates(bytes => fn(packet('update', bytes))) :
      doc.subscribe(event => fn({origin: event.by, route: selectRoute(doc, identity)}));
    const unsubscribe = () => {stop(); subscriptions.delete(unsubscribe);};
    subscriptions.add(unsubscribe); return unsubscribe;
  };
  return Object.freeze({
    identity,
    role: participantRole,
    peerId: String(doc.peerId),
    snapshot() {alive(); return selectRoute(doc, identity);},
    canonical() {alive(); return canonicalRoute(doc, identity);},
    execute(command) {return write(() => executeCommand(doc, participantRole, command, context));},
    executeBatch(commands) {
      return write(() => {
        assertPlayer(participantRole);
        invariant(Array.isArray(commands) && commands.length > 0, 'Expected commands.');
        const copy = structuredClone(commands), candidate = doc.fork();
        try {for (const c of copy) executeCommand(candidate, participantRole, c, context);} finally {candidate.free();}
        history.groupStart();
        try {return copy.map(c => executeCommand(doc, participantRole, c, context));} finally {history.groupEnd();}
      });
    },
    canUndo() {alive(); return participantRole === 'player' && history.canUndo();},
    canRedo() {alive(); return participantRole === 'player' && history.canRedo();},
    undo() {return write(() => {assertPlayer(participantRole); return history.undo();});},
    redo() {return write(() => {assertPlayer(participantRole); return history.redo();});},
    subscribeUpdates(listener) {
      alive(); invariant(typeof listener === 'function', 'Expected a listener.');
      packetListeners.add(listener); return () => packetListeners.delete(listener);
    },
    versionKey() {
      alive(); const vector = doc.version();
      try {return JSON.stringify([...vector.toJSON()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));} finally {vector.free();}
    },
    version() {
      alive(); const vector = doc.version();
      try {return packet('version', vector.encode());} finally {vector.free();}
    },
    exportSnapshot() {alive(); return packet('snapshot', doc.export({mode: 'snapshot'}));},
    exportUpdate(from) {
      alive();
      if (from === undefined) return packet('update', doc.export({mode: 'update'}));
      checkPacket(from, identity, ['version']);
      const vector = VersionVector.decode(from.bytes);
      try {return packet('update', doc.export({mode: 'update', from: vector}));} finally {vector.free();}
    },
    import(packet) {
      return write(() => {
        checkPacket(packet, identity, ['snapshot', 'update']);
        // Reject corrupt/foreign payloads without modifying the live document or firing its subscribers.
        const candidate = doc.fork();
        try {candidate.import(packet.bytes); checkDocument(candidate, identity);} finally {candidate.free();}
        const result = doc.import(packet.bytes);
        notifyPacket(packet); // Persist accepted remote bytes, including pending out-of-order operations.
        return result;
      });
    },
    subscribe(listener) {return subscribe(listener, false);},
    subscribeLocalUpdates(listener) {return subscribe(listener, true);},
    dispose() {
      if (disposed) return;
      invariant(!writing, 'Cannot dispose during a mutation.');
      for (const stop of [...subscriptions]) stop();
      stopPackets(); packetListeners.clear(); history.free();
      disposed = true; doc.free();
    },
  });
}

// Called once by the owner creating/migrating a route. Other participants restore its snapshot.
export function createRouteDocument(route, options = {}) {
  const participantRole = role(options.role ?? 'player'); assertPlayer(participantRole);
  record(route, ['version', 'id', 'buildId', 'dungeonId', 'name', 'shadow', 'modifiers', 'pulls', 'drawings', 'excluded', 'markers']);
  invariant(route.version === undefined || route.version === 2, 'Migrate legacy routes before creating a CRDT.');
  const identity = checkIdentity({schemaVersion: SCHEMA_VERSION, routeId: route.id ?? uuid(), documentId: uuid(),
    dungeonId: route.dungeonId, buildId: route.buildId ?? ''});
  const context = makeContext(identity, options), doc = new LoroDoc();
  try {
    doc.getMap('identity').set(identityKey(identity), true);
    doc.getMap('meta').set('name', 'New route'); doc.getMap('meta').set('shadow', false);
    doc.commit({origin: 'initialize'});
    const execute = c => executeCommand(doc, 'player', c, context);
    execute({type: 'set-meta', patch: {name: route.name ?? 'New route', shadow: route.shadow ?? false}});
    // Create all objects before applying references to them.
    const initialPulls = (route.pulls ?? []).map(pull => ({...pull, id: pull.id ?? uuid()}));
    for (const pull of initialPulls) {
      record(pull, ['id', 'name', 'customName', 'color', 'enemies', 'note']);
      execute({type: 'add-pull', id: pull.id, name: hasCustomPullName(pull) ? pull.name : '', color: pull.color, note: pull.note});
    }
    for (const kind of MODIFIERS) {
      const value = route.modifiers?.[kind];
      if (value) execute({type: 'set-modifier', kind, patch: value});
    }
    for (const pull of initialPulls) execute({type: 'assign-mobs', pullId: pull.id, mobIds: pull.enemies ?? []});
    for (const drawing of route.drawings ?? []) execute({...drawing, type: 'add-drawing'});
    for (const marker of route.markers ?? []) execute({...marker, type: 'add-marker'});
    for (const mobId of route.excluded ?? []) execute({type: 'set-excluded', mobId, excluded: true});
    checkDocument(doc, identity);
    return wrap(doc, identity, {...options, role: participantRole});
  } catch (error) {doc.free(); throw error;}
}
export function restoreRouteDocument(packet, options = {}) {
  const identity = checkPacket(packet, null, ['snapshot']);
  role(options.role ?? 'spectator'); makeContext(identity, options);
  const doc = new LoroDoc(); // New random peer for every tab/session, including spectator.
  try {
    doc.import(packet.bytes); checkDocument(doc, identity);
    return wrap(doc, identity, options);
  } catch (error) {doc.free(); throw error;}
}
