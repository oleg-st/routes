# Route Together: persistence and solo editor

Stage 3. Worktree: `C:\Work\RoutePlanner.RT`; branch: `codex/collaboration`. The solo editor runs without signaling/P2P. Rooms and cursors were not yet connected at this stage; their later integration is documented separately.

## Storage and migration

`collaboration/route-storage.js` opens IndexedDB `fellowship-route-together`, version 1:

- `routes`: initial binary snapshot and identity, keyed by routeId.
- `updates`: binary updates/snapshots log with a routeId index.
- `drafts`: latest route for each dungeonId; `preferences`: last dungeon, route-name counter, and migration marker.
- `bookmarks`: visible JSON at the time of Save route for the library and change comparisons. Opening a bookmark uses the latest stored CRDT, not the old JSON checkpoint.

Each accepted local or remote operation immediately enters the write queue. Saved locally appears after `transaction.oncomplete` with strict durability. On failure, bytes remain queued and the status offers a retry. While writes are pending or failed, beforeunload warns about leaving. Abruptly terminating the browser process cannot guarantee completion of an unfinished transaction.

Compaction merges the log with the base snapshot in one readwrite transaction and deletes only included records. It does not truncate Loro history or tombstones. It runs after a snapshot and every 100 writes. A compaction failure leaves the original log recoverable. Every tab receives a new Loro peer ID.

BroadcastChannel announces only routeId after a successful write. Other tabs read the binary history and import it without another write/echo. Binding rereads the document to close the gap between load and bind. This synchronizes tabs on the same origin, not a network room.

`route-library.js` migrates the legacy `fellowship-atlas-v1` key once, atomically with its migration marker. A newer draft wins over a library snapshot with the same routeId. The old localStorage is neither deleted nor overwritten. Invalid individual records are skipped with a message, leaving their originals in the old key. Unavailable IndexedDB or corrupt CRDT data produces an error rather than replacing the document with an empty route.

## Commands, Undo, and UI

app.js does not directly mutate the current route: it is a derived document snapshot for calculations and SVG rendering. All route mutations go through execute/executeBatch. Selection, viewport, tools, and gesture drafts remain local.

UndoManager reverses local operations; remote changes do not enter the stack. Composite actions, such as creating a pull and assigning mobs or clearing the route and setting presets, form one Undo step. History holds up to 60 steps in the current instance and is empty after refresh. Explicit Undo of deletion removes only its own tombstone token, so another participant's deletion still hides the object. The CRDT schema is 2.

Dragging edits a local draft and sends one command using the stable point/marker ID at pointerup. Pointercancel and loss of focus commit the last movement sample. Escape cancels an unfinished gesture. Line menus add/remove vertices; forms edit pull notes and pin/star/flag markers.

Dialogs submit only changed fields. If text changed remotely after a dialog opened, saving conflicting text is rejected and the local draft stays in the form for copying. This prevents lost input; live collaboration inside an open textarea is not implemented. Text changes made independently by offline peers merge through CRDT.

Solo opens as player. APIs and handlers check the role; spectators cannot execute/executeBatch/undo/redo but receive and persist remote updates. The self-selected entry role was added with rooms in stage 4.

## Transfer and builds

Ordinary routes still export as R1. R2 uses the same DEFLATE/base64url and catalog fingerprint, adding markers and preserving all line vertices and long notes. R1 and legacy JSON remain compatible. Import creates new IDs and history: an independent copy, not a connection to a shared document. Decompressed transfer size is limited to 3 MB; R2 rejects excessive content rather than silently truncating it.

The dev server, local.html, and dist bundle the Loro npm module with esbuild using the `loro-crdt/base64` alias. No external WASM URL/CDN is required. The site bundle is built **after** public-data transformation so private maps/calibrations are not reintroduced through the bundle. Only dist is published; relative paths work beneath a GitHub Pages prefix.

## Validation

Stage 3 passed on Node 24.22.0: 77/77 unit tests, data/build checks, and every browser scenario below.

```text
npm run build:local
npm run check
npm test
npm run test:crdt:browser
npm run test:storage:browser
npm run test:editor
npm run build:site
npm run test:site:browser
```

Browser scenarios use installed Edge (Chrome for the model smoke). They cover HTTP and file://, the library, migration, real IndexedDB, compaction with concurrent writes, failed-save/retry behavior, spectator writes, two tabs, local Undo, markers, vertices, dragging, and R2. The public smoke serves dist under `/RoutePlanner/`, blocks external requests, and checks editing/refresh.

The next stage at that point was rooms: create/join, initial document transfer, updates, anti-entropy, and reconnect. Network presence, entry roles, and cursors followed the transport work. See the current [implementation plan](route-together-plan.md).
