import test from 'node:test';
import assert from 'node:assert/strict';
import {openRouteStorage} from '../collaboration/route-storage.js';
import {serializeStorageBackup} from '../collaboration/storage-backup.js';

function pendingOpen(extra = {}) {
  const request = {};
  let closes = 0;
  const channel = {close() {closes++;}};
  const opening = openRouteStorage({indexedDB: {open: () => request}, channel, timeoutMs: 20, ...extra});
  return {request, opening, closes: () => closes};
}

test('A silent IndexedDB open times out, releases the channel and closes a late connection', async () => {
  const {request, opening, closes} = pendingOpen();
  await assert.rejects(opening, /Browser storage did not respond/);
  assert.equal(closes(), 1);
  let closed = false;
  request.result = {close() {closed = true;}};
  request.onsuccess();
  assert.equal(closed, true);
});

test('A late upgrade is aborted without changing existing storage', async () => {
  const {request, opening} = pendingOpen();
  await assert.rejects(opening, /did not respond/);
  let aborted = false;
  request.transaction = {abort() {aborted = true;}};
  request.onupgradeneeded();
  assert.equal(aborted, true);
  request.error = new Error('Upgrade aborted');
  request.onerror();
});

test('A blocked open rejects promptly and closes a connection if the blocker later goes away', async () => {
  const {request, opening, closes} = pendingOpen();
  request.onblocked();
  await assert.rejects(opening, /Close older planner tabs/);
  assert.equal(closes(), 1);
  let closed = false;
  request.result = {close() {closed = true;}};
  request.onsuccess();
  assert.equal(closed, true);
});

test('Open errors preserve their cause and release the channel', async () => {
  const {request, opening, closes} = pendingOpen();
  request.error = new Error('Storage unavailable');
  request.onerror();
  await assert.rejects(opening, request.error);
  assert.equal(closes(), 1);
});

async function transactionStorage(tx) {
  const {request, opening} = pendingOpen();
  request.result = {transaction: () => tx, close() {}};
  request.onsuccess();
  return opening;
}

test('A stalled library read rejects even when abort never dispatches an event', async () => {
  let aborted = false;
  const tx = {
    objectStore: () => ({openCursor: () => ({}), getAll: () => ({}), get: () => ({})}),
    abort() {aborted = true;},
  };
  const storage = await transactionStorage(tx);
  try {
    await assert.rejects(storage.library(), /storage transaction did not respond/);
    assert.equal(aborted, true);
    tx.oncomplete(); // A late event cannot turn failure into a successful save.
  } finally {storage.close();}
});

test('A timed out write remains failed and pending until a successful retry commits', async () => {
  let committed = false, aborted = false;
  const tx = {
    objectStore: () => ({get: () => ({}), put() {}}),
    abort() {aborted = true;},
  };
  const storage = await transactionStorage(tx);
  const states = [];
  const document = {
    identity: {routeId: 'route'},
    subscribeUpdates: () => () => {},
    exportSnapshot: () => ({kind: 'snapshot', identity: {routeId: 'route'}, bytes: new Uint8Array([1])}),
  };
  // Keep this test focused on the binding's write/retry lifecycle.
  storage.load = async () => null;
  storage.compact = async () => {};
  const binding = storage.bind(document, status => states.push(status.state));
  try {
    await assert.rejects(binding.flush(), /transaction did not respond/);
    assert.equal(aborted, true);
    assert.equal(binding.pending, 1);
    assert.equal(states.at(-1), 'error');
    storage.write = async () => {committed = true;};
    await binding.flush();
    assert.equal(committed, true);
    assert.equal(binding.pending, 0);
    assert.equal(states.at(-1), 'saved');
  } finally {await binding.dispose(); storage.close();}
});

test('A completed transaction cancels its watchdog and returns library data', async () => {
  let aborted = false;
  const requests = {};
  const tx = {
    objectStore: name => ({
      openCursor: () => (requests[name] = {}),
      getAll: () => (requests[name] = {}),
      get: () => (requests[name] = {}),
    }),
    abort() {aborted = true;},
  };
  const storage = await transactionStorage(tx);
  try {
    const result = storage.library();
    requests.bookmarks.onsuccess({target: {result: [{id: 'saved'}]}});
    requests.preferences.onsuccess({target: {result: 'dungeon'}});
    tx.oncomplete();
    assert.deepEqual(await result, {drafts: {}, saved: [{id: 'saved'}], lastDungeon: 'dungeon'});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(aborted, false);
  } finally {storage.close();}
});

test('Diagnostics distinguish a silent open from an explicit blocked upgrade', async () => {
  for(const blocked of [false,true]){
    const events=[];
    const {request,opening}=pendingOpen({onDiagnostic:event=>events.push(event)});
    if(blocked)request.onblocked({oldVersion:1,newVersion:2});
    await assert.rejects(opening);
    assert.equal(events[0].operation,'open');
    assert.equal(events[1].state,blocked?'blocked':'timeout');
    assert.equal(events.at(-1).state,'error');
  }
});

test('A diagnostic observer cannot break storage', async () => {
  const {request,opening}=pendingOpen({onDiagnostic:()=>{throw new Error('Observer failure');}});
  request.result={close(){}};request.onsuccess();
  const storage=await opening;storage.close();
});

test('Recovery JSON preserves large binary packets, view boundaries and original records', () => {
  const bytes=Uint8Array.from({length:20000},(_,i)=>i%256);
  const backup={stores:{routes:[{key:'route',value:{bytes}}],updates:[{key:42,value:{packet:{bytes:bytes.subarray(23,18000)}}}]}};
  const original=structuredClone(backup),json=JSON.parse(serializeStorageBackup(backup));
  const decode=value=>Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));
  assert.equal(json.stores.routes[0].value.bytes.type,'Uint8Array');
  assert.deepEqual(decode(json.stores.routes[0].value.bytes),bytes);
  assert.deepEqual(decode(json.stores.updates[0].value.packet.bytes),bytes.subarray(23,18000));
  assert.deepEqual(backup,original);
});
