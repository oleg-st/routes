# Browser storage startup failures

The planner opens `fellowship-route-together-<game build ID>` at IndexedDB
version 1. Older builds can leave other databases on the same origin. Their
presence alone does not block the current database. The CRDT schema version
inside a stored route is separate from the IndexedDB database version.

Startup waits for the database, the library, the selected dungeon, the last
draft's snapshot and updates, document restoration, and the initial save.
Before the watchdog was added, a silent open request or transaction could
leave the app on “Loading game data…” indefinitely. “Opening storage…” did
not identify which of those operations was waiting.

## Identify the failing operation

On the failure screen, expand **Startup diagnostics** and download the
diagnostic report. It includes the game build, database name, browser, startup
phase, error, and up to 100 recent storage events. It does not include route
snapshots or CRDT bytes. No report is automatically uploaded.

| Events | Meaning and next action |
| --- | --- |
| `open / blocked` | An upgrade is waiting for another connection. Close other planner tabs, then reload. |
| `open / timeout`, without `blocked` | Opening did not finish. A request may be queued behind another open/upgrade/delete, or the browser backend may be stalled. This event alone does not prove corruption. Close planner tabs and fully restart the browser without restoring them, then open one planner tab. |
| `open / ready`, then `read-library / timeout` | The connection opened, but the library transaction did not finish. Investigate queued transactions or the browser backend; this is not an opening failure. |
| `read-route / complete`, then `merge-route / error` | Raw records were read, but the stored snapshot/update history could not be combined. Export a raw backup before attempting repair. |
| Startup phase `Restoring last route` | Reading and merging finished, but route validation/restoration failed. The error identifies issues such as an unsupported CRDT schema or incompatible game build. |
| A write operation times out or fails | The initial save could not complete. The error may identify quota, permissions, a closed connection, or a stalled transaction. |

The [IndexedDB specification](https://www.w3.org/TR/IndexedDB/#connection-queues)
defines a connection queue per storage key and database name. A queued open
request can wait without receiving its own `blocked` event. Ordinary concurrent
connections at the same version do not by themselves prevent opening a database.

## Recover without deleting routes

1. For a connection timeout, close other planner tabs and fully restart the
   browser, then reload one tab. Clearing site data is not required for this step.
2. If the connection opens, use **Download storage backup** on the failure
   screen. This reads all stores in one readonly transaction, including raw
   snapshots, update records with their keys, bookmarks, drafts and preferences.
   Binary values are tagged as `Uint8Array` or `ArrayBuffer` and encoded as base64.
   No CRDT decoding, compaction, migration, or deletion runs during export.
   The file is a recovery archive for analysis, not a route code accepted by the
   ordinary Import dialog. A failed backup is reported rather than downloaded
   as a partial archive.
3. When restoring the last route fails and a matching manual save exists,
   **Open last saved copy** creates a separate route with a new ID. It changes
   the active draft reference to that copy. The original snapshot, updates and
   bookmark remain intact. Changes made after the last manual Save may be absent
   from the copy, so keep the raw backup for further recovery.

If the browser cannot open or read its storage, the page cannot export those
unreadable records. If there is no manual save, the saved-copy option is not
offered. Neither case triggers an automatic database reset. Recovering later
edits from a damaged history requires inspecting the raw backup; skipping
arbitrary CRDT updates is not guaranteed to preserve dependencies.

An already deleted database cannot be diagnosed retrospectively from these
screenshots. The report must be collected while the failure still exists.

## Regression coverage

`node --test tests/route-storage.test.mjs` covers watchdogs, cleanup, diagnostics,
write retries and binary backup encoding. `node tests/route-storage-browser.mjs`
covers real transactions, a queued open without a `blocked` event, startup
timeouts, corrupt history export and recovery, preservation of original records,
reload, and synchronization between tabs.
