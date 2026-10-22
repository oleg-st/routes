import {LoroDoc} from 'loro-crdt';
import {invariant} from './route-schema.js';
const keyOf = i => JSON.stringify([i.schemaVersion, i.routeId, i.documentId, i.dungeonId, i.buildId]);
function merge(base, updates) {
  if (!base) return null;
  const doc = new LoroDoc();
  try {
    doc.import(base.bytes);
    for (const entry of updates) {
      invariant(keyOf(entry.packet.identity) === keyOf(base.identity), 'Stored document identity mismatch.');
      doc.import(entry.packet.bytes);
    }
    return {...base, kind: 'snapshot', bytes: doc.export({mode: 'snapshot'})};
  } finally {doc.free();}
}
export async function openRouteStorage({name = 'fellowship-route-together', indexedDB = globalThis.indexedDB,
  channel = undefined} = {}) {
  invariant(indexedDB, 'Browser storage is unavailable.');
  if(channel===undefined)channel=globalThis.BroadcastChannel?new BroadcastChannel(`${name}:changes`):null;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('routes', {keyPath: 'identity.routeId'});
      db.createObjectStore('updates', {autoIncrement: true}).createIndex('routeId', 'routeId');
      db.createObjectStore('drafts'); db.createObjectStore('bookmarks', {keyPath: 'id'}); db.createObjectStore('preferences');
    };
    let blocked=false;
    request.onsuccess = () => {if(blocked)request.result.close();else resolve(request.result);};
    request.onerror = () => reject(request.error);
    request.onblocked = () => {blocked=true;reject(new Error('Close older planner tabs to update browser storage.'));};
  }).catch(error => {channel?.close(); throw error;});
  db.onversionchange = () => db.close();
  function transaction(names, mode, body) {
    return new Promise((resolve, reject) => {
      let result, failure;
      const tx = db.transaction(names, mode, mode === 'readwrite' ? {durability: 'strict'} : undefined);
      const fail = error => {failure = error; tx.abort();};
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Storage transaction aborted.'));
      tx.onerror = () => {};
      try {body(tx, value => {result = value;}, fail);} catch (error) {fail(error);}
    });
  }
  const listeners = new Set();
  if (channel) channel.onmessage = event => {for (const listener of listeners) listener(event.data);};
  const api = {
    async write(packet) {
      invariant(packet?.bytes instanceof Uint8Array && ['snapshot', 'update'].includes(packet.kind), 'Expected CRDT bytes.');
      const routeId = packet.identity.routeId, copy = structuredClone(packet);
      await transaction(['routes', 'updates'], 'readwrite', (tx, done, fail) => {
        const routes = tx.objectStore('routes'), request = routes.get(routeId);
        request.onsuccess = () => {
          try {
            if (!request.result) {
              invariant(copy.kind === 'snapshot', 'Save the initial snapshot before updates.'); routes.put(copy);
            } else {
              invariant(keyOf(request.result.identity) === keyOf(copy.identity), 'Another document already uses this route ID.');
              tx.objectStore('updates').add({routeId, packet: copy});
            }
          } catch (error) {fail(error);}
        };
      });
      channel?.postMessage({routeId});
    },
    async load(routeId) {
      const value = {};
      await transaction(['routes', 'updates'], 'readonly', tx => {
        tx.objectStore('routes').get(routeId).onsuccess = e => {value.base = e.target.result;};
        tx.objectStore('updates').index('routeId').getAll(routeId).onsuccess = e => {value.updates = e.target.result;};
      });
      return merge(value.base, value.updates);
    },
    compact(routeId) {
      return transaction(['routes', 'updates'], 'readwrite', (tx, done, fail) => {
        const values = {}, requests = {
          base: tx.objectStore('routes').get(routeId),
          updates: tx.objectStore('updates').index('routeId').getAll(routeId),
          keys: tx.objectStore('updates').index('routeId').getAllKeys(routeId),
        };
        let remaining = 3;
        for (const [key, request] of Object.entries(requests)) request.onsuccess = () => {
          values[key] = request.result;
          if (--remaining) return;
          try {
            const snapshot = merge(values.base, values.updates);
            if (!snapshot) return;
            tx.objectStore('routes').put(snapshot);
            for (const key of values.keys) tx.objectStore('updates').delete(key);
          } catch (error) {fail(error);}
        };
      });
    },
    async library() {
      const state = {drafts: {}, saved: [], lastDungeon: null};
      await transaction(['drafts', 'bookmarks', 'preferences'], 'readonly', tx => {
        tx.objectStore('drafts').openCursor().onsuccess = e => {const c = e.target.result; if (c) {state.drafts[c.key] = c.value; c.continue();}};
        tx.objectStore('bookmarks').getAll().onsuccess = e => {state.saved = e.target.result;};
        tx.objectStore('preferences').get('lastDungeon').onsuccess = e => {state.lastDungeon = e.target.result ?? null;};
      });
      return state;
    },
    setDraft(dungeonId, routeId) {
      return transaction(['drafts', 'preferences'], 'readwrite', tx => {
        tx.objectStore('drafts').put(routeId, dungeonId); tx.objectStore('preferences').put(dungeonId, 'lastDungeon');
      });
    },
    saveBookmark(view) {return transaction(['bookmarks'], 'readwrite', tx => tx.objectStore('bookmarks').put(structuredClone(view)));},
    removeBookmark(routeId) {return transaction(['bookmarks'], 'readwrite', tx => tx.objectStore('bookmarks').delete(routeId));},
    nextName(minimum = 1) {
      return transaction(['preferences'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('preferences');
        store.get('nextRouteNumber').onsuccess = e => {
          const number = Math.max(minimum, 1, Number(e.target.result) || 1); store.put(number + 1, 'nextRouteNumber'); done(`Route ${number}`);
        };
      });
    },
    loadRoom(roomId) {
      return transaction(['preferences'], 'readonly', (tx, done) => {
        tx.objectStore('preferences').get('room:'+roomId).onsuccess=e=>done(e.target.result??null);
      });
    },
    saveRoom(roomId, metadata) {
      return transaction(['preferences'], 'readwrite', tx=>tx.objectStore('preferences').put(structuredClone(metadata),'room:'+roomId));
    },
    bind(document, onStatus = () => {}) {
      let active = true, reading = false, writes = 0, error;
      const pending = new Set(), failed = [];
      const status = () => {if(!failed.length&&!pending.size)error=undefined;onStatus({state: failed.length ? 'error' : pending.size ? 'saving' : 'saved', error});};
      function enqueue(packet) {
        const operation = api.write(packet);
        pending.add(operation); status();
        operation.then(() => {
          if (++writes % 100 === 0 || packet.kind === 'snapshot') api.compact(document.identity.routeId).catch(() => {}); // The uncompacted log remains durable on failure.
        }, reason => {failed.push(packet); error = reason;}).finally(() => {pending.delete(operation); status();});
      }
      const unsubscribe = document.subscribeUpdates(packet => {if (!reading) enqueue(packet);});
      const changed = async ({routeId}) => {
        if (!active || routeId !== document.identity.routeId) return;
        try {
          const packet = await api.load(routeId);
          if (!active || !packet) return;
          reading = true; try {document.import(packet);} finally {reading = false;}
        } catch (reason) {error = reason; onStatus({state: 'error', error});}
      };
      listeners.add(changed);
      enqueue(document.exportSnapshot());
      // Catch writes committed between the caller's load() and attaching the listener.
      changed({routeId: document.identity.routeId});
      return {
        get pending() {return pending.size + failed.length;},
        async flush() {
          const retry = failed.splice(0); for (const packet of retry) enqueue(packet);
          while (pending.size) await Promise.allSettled([...pending]);
          if (failed.length) throw error;
        },
        async dispose() {active = false; listeners.delete(changed); unsubscribe(); await this.flush();},
      };
    },
    close() {listeners.clear(); channel?.close(); db.close();},
  };
  return api;
}
