// Internal schema helpers. Only route-document.js exposes an application API.
export const SCHEMA_VERSION = 2;
export const GROUPS = ['pulls', 'drawings', 'markers'];
export const MODIFIERS = ['empowered', 'ghorn', 'witch'];
export const uuid = () => globalThis.crypto.randomUUID();
export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
export function record(value, allowed) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  invariant(Object.keys(value).every(key => allowed.includes(key)), 'Unsupported field.');
  return value;
}
export function string(value, max = 200) {
  invariant(typeof value === 'string' && value.length <= max, 'Invalid text.');
  return value;
}
export function id(value) {
  string(value);
  invariant(value.length > 0, 'Missing ID.');
  return value;
}
export function boolean(value) {
  invariant(typeof value === 'boolean', 'Expected a boolean.');
  return value;
}
export function color(value) {
  invariant(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), 'Invalid color.');
  return value;
}
export function position(value) {
  invariant(Array.isArray(value) && value.length === 2 && value.every(n => Number.isFinite(n) && Math.abs(n) < 100000), 'Invalid coordinates.');
  return [...value];
}
export function ids(value) {
  invariant(Array.isArray(value) && value.length <= 10000, 'Invalid ID list.');
  return [...new Set(value.map(id))];
}
export function role(value) {
  invariant(value === 'player' || value === 'spectator', 'Invalid participant role.');
  return value;
}
export function assertPlayer(value) {
  invariant(value === 'player', 'Spectators cannot edit the route.');
}
export const rows = (doc, group) => doc.getMap(group);
export const order = (doc, group) => doc.getMovableList(`${group}Order`);
export const deleted = (doc, group) => doc.getMap(`${group}Deleted`);
export function visibleIds(doc, group) {
  const seen = new Set();
  return order(doc, group).toArray().filter(key => {
    if (seen.has(key) || isDeleted(deleted(doc, group), key) || !rows(doc, group).get(key)) return false;
    seen.add(key);
    return true;
  });
}
export function existing(doc, group, key) {
  id(key);
  invariant(!isDeleted(deleted(doc, group), key), 'Object was deleted.');
  const row = rows(doc, group).get(key);
  invariant(row, 'Object does not exist.');
  return row;
}
export function newId(doc, group, requested) {
  const key = id(requested ?? uuid());
  invariant(!rows(doc, group).get(key) && !isDeleted(deleted(doc, group), key), 'ID has already been used.');
  return key;
}
// Resolve anchors against the live order. A missing pair falls back to the end.
export function targetIndex(current, {beforeId, afterId}) {
  if (beforeId != null) id(beforeId);
  if (afterId != null) id(afterId);
  const before = current.indexOf(beforeId), after = current.indexOf(afterId);
  if (before >= 0) return before;
  if (after >= 0) return after + 1;
  return current.length;
}
export function insertOrdered(doc, group, key, index) {
  const list = order(doc, group), live = visibleIds(doc, group);
  const anchor = live[index];
  list.insert(anchor === undefined ? list.length : list.toArray().indexOf(anchor), key);
}
export function moveOrdered(doc, group, key, index) {
  const list = order(doc, group), all = list.toArray(), from = all.indexOf(key);
  const live = visibleIds(doc, group).filter(other => other !== key), anchor = live[index];
  const remaining = all.filter((_, i) => i !== from);
  const to = anchor === undefined ? remaining.length : remaining.indexOf(anchor);
  if (from !== to) list.move(from, to);
}
export function pointIds(row) {
  const points = row.get('points'), tombstones = row.get('pointsDeleted'), seen = new Set();
  return row.get('pointOrder').toArray().filter(key => {
    if (seen.has(key) || isDeleted(tombstones, key) || !points.get(key)) return false;
    seen.add(key);
    return true;
  });
}
export function writePoint(row, key, coordinates, index) {
  row.ensureMergeableMap('points').ensureMergeableMap(key).set('position', coordinates);
  row.ensureMergeableMovableList('pointOrder').insert(index, key);
}
export function writeMembership(map, values) {
  const chosen = new Set(values);
  for (const key of map.keys()) if (!chosen.has(key)) map.set(key, false);
  for (const key of chosen) map.set(key, true);
}
export const members = map => map ? map.entries().filter(([, on]) => on === true).map(([key]) => key).sort() : [];
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Each deletion is its own undoable token. Undoing A's deletion cannot erase B's token.
export function isDeleted(map, key) {
  const prefix = JSON.stringify([key]).slice(0, -1) + ',';
  return map.entries().some(([token, value]) => value === true && (token === key || token.startsWith(prefix)));
}
export function markDeleted(map, key) {map.set(JSON.stringify([key, uuid()]), true);}
