# Route Together CRDT model

## Unified marker / note prototype

The map toolbar opens one editor for numbered notes and five temporary vector
symbols, with optional text and a fixed color palette. New annotations use the
existing marker entity (`icon: "number"` for numbered notes). Legacy note
drawings retain their IDs, point IDs and CRDT text; an optional `icon` field changes
their appearance in place. Numbering derives from visible legacy notes followed
by numbered markers, so peers converge without storing a mutable counter.
Symbol and color edits are independent commands; text uses the existing conflict
guard and CRDT text. Undo, deletion, spectator restrictions and persistence remain
on the shared document path. Compact exports retain optional note icons in a
seventh drawing tuple field; older clients must update to read those exports.

The five vectors in `marker-symbols.js` are placeholders, not verified game
artwork. The installed Fellowship data package and public searches did not yield
the original marker assets. Do not assign real log marker IDs to these shapes
until verified.

Stage 2 implements the shared model and commands independently of the DOM, IndexedDB, and P2P. The entry point is `collaboration/route-document.js`; legacy route migration is in `collaboration/route-migration.js`. The dependency is pinned to `loro-crdt@1.16.4`.

## Public API

```js
import {createRouteDocument, restoreRouteDocument} from '../collaboration/route-document.js';
import {migrateRoute} from '../collaboration/route-migration.js';

const options = {dungeon, enemies, role: 'player'}; // enemies: Map from the loaded catalog
const owner = createRouteDocument({dungeonId: dungeon.id, name: 'Team route'}, options);
const pullId = owner.execute({type: 'add-pull'});
owner.execute({type: 'assign-mobs', pullId, mobIds: [placementId]});

const guest = restoreRouteDocument(owner.exportSnapshot(), {...options, role: 'spectator'});
owner.execute({type: 'update-pull', pullId, patch: {name: 'Boss'}});
guest.import(owner.exportUpdate(guest.version()));

const view = guest.snapshot(); // Independent view for the UI and calculations
const canonicalJSON = guest.canonical(); // Input for a future SHA-256 digest
const backup = guest.exportSnapshot(); // Binary history, including deletions
owner.dispose();
guest.dispose();
```

`createRouteDocument()` creates a new document and defaults to player. An initial v2 route may be supplied. `migrateRoute(value, {dungeons, enemies, presets?, role?})` first applies the existing JSON validation/migrations, then creates a CRDT. Presets are applied only during initial creation.

`restoreRouteDocument()` accepts a binary snapshot and defaults to spectator. The role is immutable for the instance's lifetime; the room controller supplies the role chosen at entry. This constrains the standard client and does not authorize an untrusted participant. Each new instance gets a random Loro peer ID.

`execute(command)`, `executeBatch(commands)`, and local `undo()`/`redo()` are the public mutation methods. The command layer checks the role before parsing the command, validates every field before the first write, and makes one commit. Creation commands return IDs. Nested commands from a change listener are prohibited; listeners that need to mutate the document must schedule those actions after the callback completes.

`subscribe(listener)` reports local and imported changes as `{origin, route}` and returns an unsubscribe function. `subscribeLocalUpdates(listener)` emits only new local binary updates, without echoing imports. Persist these bytes or `exportSnapshot()`, rather than the JSON supplied to subscribe. Disposing an instance removes subscriptions and frees the document.

## Data and conflict rules

| Area | Storage and behavior |
|---|---|
| Identity | Immutable schemaVersion, routeId, documentId, dungeonId, buildId; a separate origin inside the binary document |
| Metadata | name and shadow are separate LoroMap fields |
| Pulls | Mergeable map keyed by ID; separate name/customName fields; CRDT Text for note |
| Pull order | LoroMovableList of IDs; numbers and default names derive from visible order |
| Colors | Map fields keyed by position; move does not change colors; local insert/delete shifts slots as in the previous editor |
| Mobs | One placementId -> pullId reference. References to deleted pulls are hidden; view-level enemies arrays are sorted as sets |
| Annotations | line, portal, invis, note with stable IDs; independent style fields; CRDT Text for text |
| Geometry | Stable pointId, separate point record, and MovableList order. Coordinate pairs are atomic; independent points can be edited independently |
| Markers | New entity: id, mapId, position, color, icon, and CRDT Text label |
| Modifiers | Separate active field; empowered.enemies is a membership map; packId and replacedEnemies form one consistent replacement record |
| Deletions | Maps of individual tombstone tokens for objects and points. Edit/move never clears deletion; Undo removes only its own token; reusing an occupied ID is prohibited |
| Local state | Session role, cursors, viewport, selection, and gesture drafts are outside the document |

All lazily created child maps and text use Loro mergeable containers. Editing does not overwrite entire route objects.

Concurrent operation policies:

- Loro resolves scalar conflicts; local wall-clock time and message arrival order are not used.
- Delete wins over late edit/move. A mob assignment to a deleted pull is hidden. Explicit Undo can restore one's own deletion if no other active deletion tokens remain. Independent creation uses a new ID.
- Move uses beforeId/afterId. If both exist, beforeId wins; otherwise the available afterId is used; if neither exists, insert at the end. Incompatible concurrent intentions need not preserve both adjacency relationships, but converge to one order without duplicates.
- Conflicting color shifts/recolors use LWW for each slot. Color belongs to a position, not a pull ID, and may change during conflict resolution. Missing slots use a deterministic palette by index.
- Concurrent assignments of the same mob to different pulls produce one resulting reference.
- If Ghorn and Witch concurrently target the same packId or overlapping explicit replacedEnemies, the visible model keeps Ghorn active. Witch's configuration remains stored, but its active flag projects to false. Overlaps already known locally are rejected.
- Clear deletes observed objects and resets observed settings. New objects created concurrently by another client survive the merge.
- Concurrent deletion of different points may leave a line with fewer than two points. Such geometry is hidden from the visible route while its history remains; another point can be added with a separate command. A late edit does not restore a deleted point.
- Text uses insertion/deletion operations or a diff through LoroText.update, rather than replacement of a map string. UTF-16 indices are checked against splitting surrogate pairs. One edit-text inserts at most 4,000 UTF-16 units; UI forms have the same limit. Creation/set-text and the result of a local edit allow up to 1,000,000 units so restoration and R2 preserve text that grew through concurrent merges.

An annotation or marker's `mapId` is fixed at creation. Point movement uses the original map's coordinates; moving an object between coordinate systems would require a separate UI adapter command.

## Commands

| Command | Fields other than type |
|---|---|
| add-pull | id?, name?, color?, note?, beforeId?, afterId? |
| update-pull | pullId, patch: name?/color? |
| delete-pull | pullId |
| move-pull | pullId, beforeId?, afterId? |
| assign-mobs | pullId (or null to unassign), mobIds, toggle? (default false) |
| set-meta | patch: name?/shadow? |
| set-excluded | mobId, excluded |
| set-modifier | kind, patch: active?/enemies? for empowered; active?/packId?/replacedEnemies? for Ghorn/Witch |
| add-drawing | id?, mapId, kind, points, pointIds?, color?, width?, text? |
| update-drawing | drawingId, patch: color?/width? |
| delete-drawing | drawingId |
| insert-point | drawingId, id?, position, beforeId?, afterId? |
| move-point | drawingId, pointId, position |
| delete-point | drawingId, pointId |
| add-marker | id?, mapId, position, color?, icon?, label? |
| update-marker | markerId, patch: position?/color?/icon? |
| delete-marker | markerId |
| edit-text | group (pulls/drawings/markers), id, index, deleteCount, text |
| set-text | group, id, text |
| clear-route | none |

For text, group selects note/text/label respectively. Portal and invis have exactly two endpoints, and note has one position; additional vertices and vertex deletion are supported for line. New IDs use crypto.randomUUID; explicit IDs support migration and command preparation. Missing anchors are allowed; missing or deleted target objects are rejected.

Spectators may call snapshot/canonical/version, receive imports, subscribe, and export a copy. They cannot execute commands or create/migrate a new document. The public API does not expose the mutable LoroDoc.

## Binary exchange and restoration

Packets have the shape `{identity, kind, bytes: Uint8Array}`. Kinds are snapshot, update, and version. `exportUpdate(remote.version())` returns only missing operations; without an argument it exports all available update history. Loro handles duplicate and unordered delivery; later version-vector exchange fills gaps.

Each new document receives a documentId. This prevents accidentally merging two independently created CRDTs over the same routeId/JSON. One client creates the CRDT from JSON; others restore its snapshot. Reload also restores binary history instead of reimporting the visible JSON.

Before import, identity, schema version, packet kind, and byte length (up to 32 MiB) are checked. Import is then tested on a temporary document copy and its internal origin verified; only a successful result reaches the live document. Invalid bytes do not change state or notify listeners. This preflight adds import cost that should be measured on large documents. Network envelopes, chunk sizes, timeouts, and peer/role negotiation belong to the room layer.

`snapshot()` adapts the document for existing calculations/rendering, extended with markers and drawing.pointIds. It is not CRDT persistence. validateRoute/R1/R2 must not restore shared history. Stage 3 restores IndexedDB bytes; R1/R2 create an independent copy without shared history.

## Stage 2 validation and remaining integration at that point

- `npm run test:crdt`: 22 model tests, including real data for all 15 dungeons and 180 pseudorandom operations across five independent peers.
- `npm test`: 71 tests on Node 24.22.0, including existing public-build checks.
- `npm run test:crdt:browser`: WASM passed in three independent Chrome contexts, two players and one spectator. This is a model test without P2P or room UI.
- The browser test uses esbuild's official `loro-crdt/base64` entry with embedded WASM. At stage 2 this did not yet change the production build or allowlist.
- The local build, data verification, and local.html freshness checks passed on Node 24.
- The next stage at that point was IndexedDB, app.js command integration, local Undo/Redo, extended import/export, and production Loro packaging. Rooms and cursors followed later.

## Library documentation

Reviewed the [JS API](https://www.loro.dev/docs/api/js), [MovableList](https://www.loro.dev/docs/tutorial/list), [mergeable maps](https://www.loro.dev/docs/tutorial/map), and [synchronization](https://www.loro.dev/docs/tutorial/sync). Signatures were also checked against installed `loro-crdt@1.16.4` declarations because the API reference can lag behind the package.

## Stage 3 additions

The CRDT schema was raised to **2**: deletion is a unique `[objectId, deletionId]` token. An object stays hidden while any active token exists. Experimental schema-1 binary snapshots are rejected; the UI did not persist CRDT before stage 3. Ordinary commands never clear deletion. Explicit local Undo can restore the original ID if no other client's tokens remain, preserving references, geometry, and order without undoing another player's deletion.

UndoManager is created after bootstrap/restore and holds up to 60 local steps. Imports do not enter history. After refresh, Undo is empty but binary document history remains. `executeBatch()` validates commands on a fork and groups them into one Undo step; byte listeners may receive several updates. Commands referring to other commands in a batch require explicit IDs prepared in advance.

`subscribeUpdates(listener)` emits both local and accepted remote bytes, including pending operations, for storage. `subscribeLocalUpdates` remains the transport subscription and never echoes imports. `canUndo/canRedo` return false for spectators; undo/redo/executeBatch check the role.

Production local/site/dev bundles use `loro-crdt/base64` with embedded WASM. Current UI validation and limitations are described in [route-together-storage.md](route-together-storage.md); the list above records stage 2 results.
