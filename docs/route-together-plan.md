# Route Together

Prototype integration: the feature is included in master as one squash commit, retaining the existing pack-efficiency controls and calculations. Automated checks cover collaboration and solo editing. Real cross-network and TURN acceptance remains pending; see the manual network matrix in [Rooms](route-together-rooms.md#manual-network-acceptance).

Implementation plan for Fellowship Route Planner collaboration, based on the specification and user additions of October 15, 2026. Branch: `codex/collaboration`. Worktree: `C:\Work\RoutePlanner.RT`. Base: `c97eb3b` from `master`.

## Confirmed additions

- Feature codename: **Route Together**.
- The room displays a session list with names, roles, and connection states. Tabs with identical names count separately.
- Maximum 4 sessions, including spectators. Available peers agree on membership; a global atomic limit across network partitions requires a server and is not provided here.
- The application remains static for GitHub Pages. Trystero supplies signaling/WebRTC; optional TURN supports restrictive NAT configurations.
- Participants choose player or spectator when joining. A leader does not assign these roles.
- Players edit the entire route. Spectators receive updates and see participants/cursors, can zoom the map and open information panels, but cannot create/edit/delete route data, clear the route, import over the shared document, or use Undo/Redo.
- Enforce roles in the command layer, not just disabled buttons. Spectators continue receiving and persisting remote updates. This is a cooperative restriction in the standard client, consistent with the specification's trust model.
- Participants see player cursors. Spectator cursors are not broadcast in the first implementation because the requirement concerns players.
- Leadership and editing role are separate session properties. The creator initially enters as player; others choose a role in the join form. Leadership remains tied to the creator's local identity and is not automatically transferred.
- All documentation and new code comments are written in English. All four documents in docs were translated at the user's request during stage 5. Chat communication remains in Russian.

## Stages and completion criteria

| Stage | Work | Completion check | Status |
|---|---|---|---|
| 1. Preparation | Worktree, specification, code audit, stable annotation IDs, baseline checks | Working copy runs/builds; IDs survive repeated reads | Complete |
| 2. Shared model | Loro, commands, existing-view adapter, all object types, deletion/reorder policies | Independent documents converge under concurrent edits; spectators cannot create operations | Complete |
| 3. Persistence and solo editor | IndexedDB, localStorage migration, all UI operations, compatible import/export, local Undo/Redo | Refresh restores CRDT; solo has no signaling; all edits use commands | Complete |
| 4. Rooms | Trystero, create/join, handshake, initial state, updates, anti-entropy, reconnect | New/stale peers converge; distinct routeIds never merge; waiting does not invent a shared empty document | Complete |
| 5. Participants and cursors | Hero/class, editable profiles, creator badge, ephemeral player cursors; names, roles, roster, and invitations began in stage 4 | Independent browsers display cursors in map coordinates; spectators do not broadcast or edit; creator identity survives refresh | Complete |
| 6. MVP validation | Conflicts for all objects, interruptions, refresh, equality diagnostics, Pages/WASM/base path, instructions | Specification Definition of Done is met, including roles and cursors; remaining network limitations are explicit | Automated checks complete; real-network matrix pending |
| 7. Cooperative kick | Creator confirms removal of one session; the standard client leaves | Room code stays unchanged, target is notified, remaining peers keep editing; rejoin is allowed | Complete (simplified scope requested October 16) |

Stages 2-5 are developed on this branch. Isolated modules alone do not establish that the collaborative UI works. Merge into master follows MVP acceptance.

## Initial audit findings

The stack is JavaScript ES modules without a UI framework. app.js contains the DOM/SVG editor, input handlers, and persistence integration. route-model.js contains validation, migration, calculations, and compact transfer formats. At the initial audit there were no CRDT or P2P dependencies. Automated tests use node:test with separate Playwright browser scenarios.

| Existing component at the audit | Observed behavior | Route Together change |
|---|---|---|
| newRoute() / validateRoute() | JSON v2: id, buildId, dungeonId, name, shadow, modifiers, pulls, drawings, excluded | Use id as routeId; keep CRDT schema version separate from JSON version |
| pulls[] | id, name, customName, color, enemies, note | ID-based records, CRDT order/text, independent mob assignments |
| movePull() | Colors remain at positions; custom names follow pulls | Preserve the adapter semantics instead of making color follow movement |
| Mobs | Static placementId; modifier:ghorn / modifier:witch replacements | placementId -> pullId assignments; do not copy the static catalog into CRDT |
| drawings[] | line, portal, invis, note; mapId, color, width, text, points | Stable objects/points, CRDT Text for notes, independently editable fields |
| Markers | No separate marker editor; note was a map text annotation | Add marker types/commands and their UI as part of full MVP coverage |
| excluded, shadow, modifiers | Saved settings affecting calculations | Include them in the shared model/tests; apply presets only at migration/creation, not over each remote update |
| change(fn) | Callback directly mutated JSON | Replace with explicit stable-ID commands and role checks |
| saveNamed() | Also changed route.name outside change | Remove this command-layer bypass |
| Undo/Redo | Full JSON snapshots in history/future | Local operation history that does not cancel others' edits; snapshot Undo is unsuitable for rooms |
| persist() | localStorage fellowship-atlas-v1, drafts by dungeonId, saved[] | IndexedDB by routeId while preserving library and draft migration |
| Export and Share | R1 / #route=; import intentionally regenerates IDs | Keep independent-copy transfer; use #room= to join an existing document |
| Builds and dev server | Explicit allowlists; Pages copied JS sources; local.html used esbuild | Update packaging for npm modules/WASM; verify Pages prefixes and local mode |

Zoom, viewport, selection, current tool, gesture drafts, and open panels stay local. Drawings use a particular mapId's coordinate system; map-views.js and data/combined-maps.js already transform old/combined map coordinates.

## Modules and model

Stage 2 implemented route-document, route-commands, route-selectors, route-migration, and internal route-schema. Stage 3 connected route-storage and route-library. Stage 4 added the room protocol/manager/UI and Trystero transport. Stage 5 added cursor presence and its SVG overlay.

- `collaboration/route-document.js`: Loro lifecycle, binary export/import, subscriptions.
- `collaboration/route-commands.js`: ID-based commands, session roles, validation/commit, and local Undo/Redo through UndoManager.
- `collaboration/route-selectors.js`: deterministic route-model view, deleted-object filtering, and pull numbering.
- `collaboration/route-migration.js`: one-time creation from a legacy local route; R1 remains independent-copy transfer.
- `collaboration/route-storage.js`: IndexedDB, write queue, snapshots/updates, and storage migration.
- `collaboration/room-protocol.js`, `room-manager.js`, `trystero-transport.js`: message validation, versions, connections, synchronization, anti-entropy, and live acknowledgments.
- `collaboration/room-ui.js`: profiles, roles, creator badge, invitations, roster, and connection settings.
- `collaboration/cursor-presence.js`, `cursor-overlay.js`: ephemeral cursor scheduling/validation, sequence ordering, expiry, coordinate projection, and rendering. Profiles use versioned HELLO messages; no separate presence.js file is necessary.
- `data/heroes.json`: compact live-hero catalog derived from the installed game data, loaded in dev/local/site modes.

The shared model contains meta, pullsById, pullOrder (MovableList), mobAssignments, drawingsById with stable point IDs and separate CRDT Text, markersById, and excluded/shadow/modifier settings. Every removable entity receives a separate tombstone token for each deletion. Ordinary edit/move does not clear deletion; explicit Undo removes only its own token. Default pull names and numbers derive from visible order.

Colors remain tied to positions: separate color slots are keyed by visible index. Reorder changes only the ID order. Local deletion shifts slots as the previous splice did; concurrent delete/recolor resolves each slot with LWW, without guaranteeing preservation of both subjective intentions.

Move expresses beforeId/afterId. The adapter computes the Loro position from current local state. Nested containers for one entity require compatible identities. The Loro version, concrete APIs, and WASM packaging were checked against official documentation during stage 2.

The editing role belongs to the room session, outside route CRDT and participantId. Commands check it before local mutation. Remote import does not pass through a user editing command. Each active tab's document gets a unique Loro peer ID.

## Cursor transmission

Cursors are ephemeral presence messages outside CRDT updates. Packets bind sessionId, full route/document identity, mapId, x/y, sequence, and visible to roomId/roomEpoch and the transport peer. Coordinates use the map's frame, not screen pixels.

The sender coalesces samples to at most 20 updates per second and offers a stationary visible cursor heartbeat once per second. A separate unordered WebRTC channel disables packet retransmission. Per-recipient delivery ACKs gate the next position; the latest sample replaces intermediate positions, with a 1500 ms retry deadline and no sends into a nonempty local buffer. Receivers retain the last position while the peer remains admitted. Late sequence numbers are rejected. Leaving the map, changing maps, opening dialogs, hiding the page, or losing focus pauses sampling and retains the last position. Disconnection or leaving the room removes the cursor. It is not drawn on an unrelated floor; compatible map frames use existing coordinate transforms. Participant portraits and Sessions show peer RTT in milliseconds, refreshed from WebRTC statistics at most every five seconds.

The overlay displays the class-colored arrow, portrait, and player name without intercepting pointer events. Spectator positions and local viewport state are not broadcast. Cursor updates do not enter IndexedDB, Undo/Redo, route export, or the canonical route representation.

Checks cover different zoom/pan/window sizes, map projection and incompatible floors, late/duplicate packets, player departure, retention/rate limits, and unchanged CRDT versions while moving the pointer.

## Stage 1 results

- Created the branch/worktree and copied the specification with user additions.
- Installed dependencies from the local cache. Copied only ignored private/images-referenced and private/images/dungeons/maps for development/testing; these were not added to Git.
- validateRoute() preserves an annotation's existing ID, generates one for legacy objects without it, and rejects duplicates. Coordinate transformations continue to work. Compact R1 still creates an independent copy.
- Added three regressions: annotation IDs across reloads, migration of missing IDs, and duplicate-ID rejection.
- npm test: 49/49, including public-build checks through build-site.mjs.
- npm run build:local and npm run check passed.
- These initial checks used Node 22.22.1. fellowship-data declares Node >=24 and Pages CI already uses Node 24; CRDT work therefore required Node 24 validation.
- Browser scenarios and actual P2P were not tested at this stage. Rooms, roles, and cursors were agreed requirements, not implemented behavior.

## Stage 2 results

Implemented the model on loro-crdt 1.16.4, commands for all object types, player/spectator enforcement, binary snapshots/updates, and the existing-view adapter. API, conflict policies, and limitations are in the [CRDT model](route-together-model.md).

Validation: 22 new model tests, 71 total tests on Node 24.22.0, and a model smoke with two players plus a spectator in independent Chrome contexts. UI, IndexedDB, Undo/Redo, and rooms were not connected yet.

## Stage 3 results

The editor now uses CRDT commands, IndexedDB, and local Undo/Redo. Legacy localStorage migrates once and remains a backup. Same-origin tabs synchronize through IndexedDB plus BroadcastChannel. Added markers, line-vertex editing, pull notes, and R2 for extended routes. Storage, migration, packaging, and validation are documented in [Persistence and solo editor](route-together-storage.md).

At that stage, rooms, entry roles, P2P, presence, and cursors were still future work. Solo opened as player; spectator checks existed in commands, Undo/Redo, and the UI adapter. Stage 3 passed 77 tests and its browser scenarios.

## Stage 4 results

Implemented rooms created from the current route, code/link entry, player/spectator selection, session roster, a five-session limit, Trystero 0.26.0, binary Loro exchange, version-vector recovery, and reconnect. Remaining peers do not depend on the creator. New sessions wait for an existing document; saved copies remain available after all peers leave. Added in-memory TURN settings and direct/relay detection from WebRTC statistics.

Validation: 86/86 tests on Node 24; independent-profile browser scenarios with native WebRTC, roles, every annotation type, refresh, creator departure, capacity/retry, and a Pages build under /RoutePlanner/. Solo mode made no external requests; editor and IndexedDB regressions passed. A separate smoke exercised real public Nostr relays. Different-network/strict-NAT TURN validation remains a manual stage 6 item.

The protocol, checks, and limitations are described in [Rooms](route-together-rooms.md). Cursors, class selection, creator UI, and cooperative kick were not part of stage 4.

## Stage 5 results

Added the game-data hero/class picker, in-room name/class editing with ordered profile revisions, deterministic session colors, the creator badge, and restoration of creator identity from local metadata. There is no automatic leadership transfer. Added player cursors on a separate bounded action, map-coordinate projection, 20 Hz coalescing, heartbeat/expiry, and lifecycle cleanup. Spectators can see cursors but do not send them.

Addressed the reported synchronization-status delay: live edits now get explicit acknowledgments without waiting for the 5-second repair exchange. Pending older edits are not cleared by a later edit's ACK. A local five-session browser check measured roughly 50-60 ms through visible delivery and acknowledgments; internet latency remains network-dependent.

Validation: 93 unit tests on Node 24; native WebRTC checks for profile editing, creator refresh/departure, cursors with different viewport sizes/zoom, spectator suppression, and five-session editing. The same scenario passes on the Pages bundle. All four docs files were translated to English, preserving API details, constraints, historical results, and documentation links.

Next is stage 6: canonical equality diagnostics, broader conflict/failure coverage, and cross-network verification. Strict NAT with real TURN credentials is still untested. Cooperative kick/room rotation remains stage 7.

## Follow-up: network readiness indicator

Opening Route Together now shows an on-demand WebRTC/STUN/Nostr check with a retry button. Preliminary results express uncertainty; current room connections supply direct/TURN evidence. The probe never joins a room or publishes route/signaling events, excludes TURN credentials, and cancels on dialog close. Seven new unit tests bring the total to 100; native-browser checks cover dialog lifecycle and current direct connections, including the Pages bundle. Cross-network TURN testing and the rest of stage 6 remain outstanding. See [Connection indicator before joining](route-together-rooms.md#connection-indicator-before-joining).

## Follow-up: invitation flow and persistent profile

The entry dialog now separates manual creation/code entry from invitation-only joining or declining. Name and class are remembered in localStorage, class options contain names only, and field spacing adapts to narrow screens. Player cursors retain their last position when the pointer leaves the map, a dialog opens, or a tab loses focus; peer departure and room cleanup remove them. Browser checks cover invitation dismissal, profile restoration across tabs, mobile layout, cursor retention, and departure cleanup.

## Follow-up: class visuals and four-person rooms

The class picker and player cursors use the game data class colors and twelve local portraits. Originals are hash-verified against the installed dataset, compressed through the existing AVIF pipeline, and included in both build modes. The top bar shows four participant slots, class portraits/names, the creator crown, and spectator labels; detailed session information remains available. Capacity is now four including spectators, with coverage for concurrent admission, a fifth arrival, and retry after departure. Earlier stage results above describe the previous five-session limit.

## Follow-up: creator-controlled dungeon changes

The creator can change the shared dungeon without changing room/session identities. Previous routes are archived locally and restored when revisiting that dungeon. Protocol version 3 uses monotonically increasing room generations and snapshot adoption to order active-map selection, recover missed announcements, and support cached returners after the creator leaves. Ordinary players and spectators follow the selection; they cannot initiate a change through the room API. The authority model remains cooperative. The expanded TURN form also fixes the checkbox width conflict and is covered on narrow screens.

Late and offline edits are routed to the matching room document by full identity, independently of the selected map. Background recovery exchanges updates for previously visited routes; returning to a dungeon restores the same document with those changes. This is covered by delayed-delivery and offline-editor tests.

Validation: 105 unit tests on Node 24; native WebRTC browser scenarios on source and Pages bundles; creator switching and route restoration, delayed/offline route edits, reconnect, profile persistence, class visuals, invitations, four-session capacity, and expanded TURN layout. Local build validation and the standalone Pages smoke passed. All participants must refresh for room protocol version 3.

## Stage 6 results and simplified removal

Protocol version 4 adds SHA-256 diagnostics for the active route. Each check includes hashes of the sorted CRDT version vector and canonical route content, scoped to the full document identity and room generation. Synced requires fresh matching evidence from all admitted remote sessions and no unacknowledged local updates. Different vectors mean Syncing; equal vectors with unequal content mean Mismatch. Offline retains the local copy. Checks expire after 15 seconds, run after edits with a 60 ms debounce, and repeat with the existing 5-second repair exchange. Old asynchronous results and reordered checks cannot confirm a newer document.

Failure coverage now includes diagnostic expiry, same-version mismatch, missed edits, reconnect, reordered checks, rapid dungeon switches, and concurrent edits across four sessions with duplicated/reordered/dropped packets. Existing model tests cover concurrent changes to all annotation types, assignment, deletion, modifiers, and Undo.

The user simplified stage 7: no room rotation or ban list. The creator sees a remove button on another participant's avatar on hover or keyboard focus (always visible on touch devices). Confirmation names the target. Only a command from the admitted creator is accepted; the target disconnects, clears automatic room resume, retains its local route, and receives a notice. The room code is unchanged and intentional rejoin remains possible. This remains cooperative client behavior, not protection against a modified client.

Real home/mobile/VPN and strict-NAT TURN acceptance still requires separate networks and working TURN credentials; local native-WebRTC checks cannot establish that result. See the manual matrix in [Rooms](route-together-rooms.md#manual-network-acceptance).

Validation on Node 24: 110/110 unit tests; native WebRTC room scenarios on both source and Pages bundles, including confirmed/cancelled removal and verified four-session convergence; standalone build, data checks, and the Pages prefix/WASM/refresh smoke passed. The removal dialog was visually inspected. Cross-network/TURN cases above remain pending.
