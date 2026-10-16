# Route Together: rooms

## Usage

Route Together creates a room from the current route or joins one using a 12-character code or a link containing #room=. Participants choose a name, class, and player/spectator role. The creator enters as player. A role is fixed for that session: leave and rejoin to change it. Every tab has a new sessionId, including tabs with identical names.

The room bar provides the code, invitation link, session list, reconnect, profile, network settings, and leave controls. Players edit the shared document; spectators receive and store updates locally, while mutation commands, Undo/Redo, and editing tools are disabled. Map viewing and export remain available. Only the creator can change the dungeon inside the room. Importing an unrelated route still requires leaving.

A new session with no local copy waits when nobody can supply a document. It does not invent an empty shared route. A participant with a local copy can continue offline and later serve the document to others. The creator is not a storage server and is not required for remaining participants to collaborate. Leaving opens the local copy; its edits may synchronize when returning to that room later.

## Protocol and persistence

Transport uses trystero 0.26.0 with its default Nostr strategy. Room join occurs only on explicit entry/creation or resuming that tab's room. Opening Route Together also imports the SDK to select the same relay endpoints for the on-demand network check below. Solo editing without opening Route Together does not open signaling connections. Peer callbacks and action APIs match version 0.26.

The binary action rt-v1 carries a length-prefixed UTF-8 JSON envelope and raw Loro bytes. The envelope now uses **protocolVersion=4**, a positive roomEpoch, roomId, senderSessionId, messageId, and document identity (schemaVersion, routeId, documentId, dungeonId, buildId). The action name is retained, allowing an older client to report an incompatible protocol. All participants must refresh to the same application version. Incompatible schemas, builds, dungeons, and lineages are never merged. roomEpoch increases when the creator changes the selected dungeon; the generation orders active-map selection, while each operation is routed by its full document identity.

HELLO contains the profile, document availability, known room membership, and creator identity. REQUEST without a body asks for a snapshot; a version vector asks for missing operations. SNAPSHOT is accepted only in response to a local request. DELTA carries local operations or a vector response. Peers repeat anti-entropy every 5 seconds and may retry unanswered requests after 10 seconds. Remote import does not rebroadcast as a local operation; missing and transitive operations are recovered through vectors. Message IDs are deduplicated; receive work is sequential and bounded, with size and transfer-time limits.

Live DELTA messages receive an ACK after successful import. The sender tracks pending acknowledgments per peer and clears its synchronization status promptly when they arrive. An older unacknowledged operation remains pending even if a later edit is acknowledged. A vector response clears the pending messages covered by that request. The 5-second exchange remains a repair mechanism rather than the normal live-update confirmation path. Transport/operation exchange is tracked separately from the content verification shown to users. See the synchronization diagnostics below.

IndexedDB preferences stores room metadata under room:<code>; the document uses the existing binary snapshot/update storage. Metadata contains identity, roomEpoch, the local participantId, leaderId, and a per-dungeon room-route index. sessionStorage remembers the current tab's code, name, class, and role for refresh. Presence and coordinates do not enter the route CRDT. Refresh creates a new sessionId and Loro peer; Undo starts empty. A local copy with the same routeId but a different documentId is not overwritten automatically.

## Changing the dungeon

The dungeon selector is enabled only for a player with the stored creator identity. The room API enforces the same rule. Changing it preserves the room code, invitations, session identities, and roles. A first visit creates a fresh shared route; returning to a dungeon restores that room's saved document. Personal solo drafts are not imported automatically.

Each transition flushes the previous document and saves it to the local route library, including spectator copies, before installing a validated replacement. If local persistence fails, the old document remains available and the change can be retried. Cursors and current-view acknowledgments are cleared for the new generation. Delayed edits to a known room route are imported into that route's stored document and its library entry, even when another dungeon is active. Recovery requests can exchange version vectors for a previous route in the background. Returning to it restores the same routeId/documentId, including received late and offline edits. Unknown or conflicting document identities are not merged. During transfer, the previous map remains visible with editing disabled and Changing dungeon displayed.

HELLO advertises the selected generation and document identity. An admitted peer requests a matching snapshot and adopts it only after validation and local persistence. Periodic HELLO/request exchange repairs a missed announcement. Trusted replicas can relay the last creator selection to late or cached returners even when the creator is offline. Creator authority is cooperative, like the rest of room membership; checkpoints are not cryptographically signed and modified clients are outside the trusted-group model. Conflicting identities within one generation are rejected.

## Profiles and leadership

The Class picker shows portraits and colored names, supports keyboard navigation, and uses named, live heroes from the installed game data package. `scripts/prepare-data.mjs` produces the compact `data/heroes.json` catalog with class colors and 200px portraits; the runtime and both build modes load it. Hero IDs are validated against that catalog. No manually maintained class list is embedded in the room code.

Profile edits change the name/class without changing the sessionId, reconnecting, or modifying route data. HELLO carries a monotonically increasing profileVersion; older profile revisions cannot overwrite newer ones. Names may repeat and are escaped in the UI. The selected class supplies the portrait and color for the cursor and participant strip. Profiles without a class use a deterministic session color. The top bar shows four participant slots, names, a creator crown, and a Spectator label; Sessions retains connection details.

The creator's durable participantId is the leaderId. Leadership is independent of player/spectator and of who has the newest route. It is not automatically transferred when the creator leaves. The list shows Creator offline while remaining users keep editing. Returning with the creator's local room metadata restores the badge. Metadata is local to the browser origin: another browser does not acquire leadership by entering the code. Multiple tabs sharing the creator's stored identity represent that same creator but remain separate sessions. This is cooperative UI identity, not authentication. Rooms created before creator metadata existed show that the creator identity is unavailable; the client does not elect a replacement. Kick is still a separate stage.

## Entry dialog and local profile

Opening Route Together manually offers room creation and code/link entry. An invitation link opens a join-only dialog with a read-only code and a Decline invitation button. Declining, closing, or pressing Escape clears that invitation from the URL without joining; accepting retains the room URL. The dialog uses spaced fields and stacks profile fields on narrow screens.

Name and class preferences are stored in localStorage as rt-name and rt-class as they are edited and when submitted. They survive reloads, new tabs, and browser restarts on the same origin; sessionStorage values are accepted as a fallback for older sessions. Room membership and editing role remain specific to the current session. Storage failures do not prevent joining. TURN credentials are never included in profile preferences.

## Player cursors

Cursors use a separate negotiated WebRTC data channel (`rt-cursor-v2`, stream 42, `ordered: false`, `maxRetransmits: 0`) and never pass through the CRDT import queue, storage, export, Undo, or canonical route data. Packets bind a sequence number and visibility to protocolVersion, roomEpoch, roomId, sessionId, full document identity, and map coordinates. They are accepted only from an admitted, handshaken player matching the transport peer. Spectators receive cursors but never send them. Unknown maps, invalid coordinates, and stale sequence numbers are discarded. The reliable Trystero channel still carries route data. Older clients using the previous cursor action must reload to exchange cursors with this version.

Movement samples coalesce to at most one update every 50 ms (20 per second). A stationary cursor offers a heartbeat once per second. Each recipient independently acknowledges the transport sequence; until that ACK arrives only the latest position is retained. After 1500 ms without an ACK, the current position can be sent again, including a final visibility update. This naturally reduces frequency on slow connections without slowing other recipients. A nonempty local channel buffer blocks both positions and ACKs even after the retry deadline, preventing a backlog. Transport stream tokens prevent late ACKs from a previous peer attachment from releasing a new send. The last received position does not expire while the participant remains connected. Cursor loss does not fail document synchronization. Pooled connections share one cursor channel with room-specific routing; leaving a room removes its handlers and pending state.

Participant portraits and the Sessions list show ping in milliseconds from the local browser to that peer, including spectators. The selected ICE candidate pair's current RTT is read at most once every five seconds, without extra application ping traffic. Missing measurements or disconnected peers display a dash; the local portrait displays `you`. Ping measures network round-trip time, not document synchronization or rendering latency.

Pointer exit, cancellation, window blur, page hiding, dialogs, and map changes pause pointer sampling but retain the last published position. Room exit, peer disconnection, and reconnect clear cursor state. The overlay uses map coordinates and reprojects when the local viewport changes. Compatible overview/layer coordinates use the existing annotation transforms; unrelated source floors do not display each other's cursors. Cursor labels combine a class-colored arrow, round portrait, and compact name badge, and remain a constant screen size and do not intercept pointer events. A receiver's zoom/pan is never sent as route data.

## Connection indicator before joining

Opening Route Together or its Network/Profile dialog starts a bounded, on-demand check. It does not join a room, publish a signaling event, or exchange route content. Closing the dialog cancels the check and closes its temporary peer connection and WebSockets. Check again cancels the previous run before starting another. A user can create/join while the check runs; its result never blocks entry.

The probe checks browser WebRTC availability, gathers ICE candidates using STUN only, and sends a read-only Nostr subscription to the same configured relays used by Trystero. Relay selection uses the pinned core package's getRelays helper and the SDK's default relay list. TURN URLs and credentials are excluded. Each probe is bounded to 6 seconds; other relay probes stop when one responds. An EOSE response is required: opening a WebSocket alone is not treated as successful Nostr access. This checks read access, not permission to publish room signaling or end-to-end matchmaking.

Results distinguish:

- Direct connection looks possible: a server-reflexive STUN candidate and a relay response were observed. Another participant is still needed to confirm connectivity.
- TURN may be needed: a relay responded but the STUN check was inconclusive. Joining is still allowed; local networks, public addressing, and the other peer's network can change the outcome.
- Signaling access not confirmed: no tested relay responded in time. TURN alone cannot repair signaling access.
- Browser reports offline, WebRTC is unavailable, or WebRTC check could not run: separate connectivity/browser conditions, not a diagnosis of NAT type.
- Working without TURN: current connected peers have a direct selected ICE pair. This applies to those peers, not every possible participant.
- Connected through TURN / Some connections use TURN: current selected pairs include a relay. This shows actual usage without claiming that TURN is strictly necessary in every case.

Only candidate types and result labels are kept by the check; candidate addresses and SDP are not stored or displayed. STUN success does not prove peer-to-peer reachability, and a timeout does not prove that TURN is mandatory. The check does not attempt to classify symmetric NAT. See [ICE candidate types](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate/type) and [WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity).

Validation: seven unit tests cover configuration filtering, host-only/failed/stalled ICE, cancellation, Nostr response requirements, parallel cleanup, offline/unsupported clients, and truthful verdicts. npm run test:network:browser exercises the actual dialog with native ICE gathering and a controlled relay, including retry, cancellation, unsupported WebRTC, and no background traffic. The room browser scenario verifies that real direct connections override a tentative preliminary result. Total unit tests after this addition: 100.

## Participant limit

The maximum is 4 active sessions, including spectators. Participants are ordered by admission number, with sessionId breaking simultaneous-entry ties. A fifth session sees Room full and can use Reconnect after someone leaves. Closing the previous transport completes before the next join.

This is a cooperative P2P limit enforced by the standard client. Isolated network partitions cannot enforce one global atomic limit; membership converges to four after connectivity returns. Indirect membership hints expire after 15 seconds; direct peers without messages expire after 30 seconds. Closing a tab or losing a connection can therefore free a slot with a delay. Names and roles are not server authorization; modified clients are outside the trusted-group model.

## GitHub Pages, NAT, and TURN

Publish the ordinary dist directory; no application backend is required. Room invitations preserve the Pages base path. Trystero uses public Nostr relays for signaling while route traffic uses WebRTC. STUN enables direct connections through many NATs. Public-relay availability and direct connectivity depend on the participants' networks.

Network / TURN supports URLs, username, password, and Force TURN relay for restrictive NAT or networks blocking UDP. Example: turns:turn.example.com:443?transport=tcp. Settings populate turnConfig; forced mode sets iceTransportPolicy=relay. The session list shows direct/relay when the browser supplies statistics for the selected ICE pair. TURN cannot guarantee access from a network that also blocks the relay itself.

Credentials stay in page memory and are cleared by reload. They do not enter invitations, IndexedDB, or source files. Automatic short-lived credential issuance requires an external service/Worker: never put a provider's private API key into public JS. The application can still remain on GitHub Pages. Credentials obtained in a TURN provider's dashboard are sufficient for manual testing.

Official documentation: [Trystero signaling](https://trystero.dev/docs/signaling-strategies/), [connections and TURN](https://trystero.dev/docs/connections/), [Metered quickstart](https://www.metered.ca/docs/turn-server-service/quickstart/), [Cloudflare credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

## Validation

- npm test: model/protocol, dropped messages and recovery, offline merge, cached return, foreign lineages, concurrent joins and limits, profile ordering, creator restoration, transient cursors, coordinate projection, rate/retention behavior, and live acknowledgments.
- npm run test:rooms:browser: native RTCPeerConnection in independent Edge contexts with separate IndexedDB. A controlled Nostr relay replaces signaling only. Covers an unknown room's waiting state, invitations, roles, every annotation type, refresh, creator departure, the fifth session, and retry after a slot becomes free. Stage 5 adds profile/class edits, creator restoration, cursor rendering across viewport sizes/zoom, spectator suppression, last-position retention on blur/hidden tabs and room-exit cleanup, and a four-session edit/ACK check.
- npm run test:cursors:browser: native unreliable SCTP channel with a deliberately dropped position and delayed ACK; verifies coalescing, retry timing, independent reliable route delivery and RTT measurement. Unit tests additionally cover buffer pressure, independent recipients, stale ACKs, shared connections and cleanup. The room browser scenario checks ping for players and spectators at desktop and narrow viewport widths. Controlled source tests disable external TURN verification and use loopback ICE candidates.
- After npm run build:site, run the same browser scenario with RT_SITE=1 to exercise the published bundle under /RoutePlanner/.
- RT_PUBLIC_SIGNALING=1 uses actual public relays and requires internet. The extended capacity and four-session timing checks remain in the controlled scenario.
- npm run test:site:browser verifies solo Pages behavior without external HTTP or WebSocket requests. npm run test:editor and npm run test:storage:browser check regressions.

Stage 5 has 93 passing unit tests on Node 24. Controlled five-session browser checks observed approximately 50-60 ms from a local edit to visible delivery and acknowledgments across four recipients. That historical limit has since been reduced to four. This is an application-level measurement on one machine, not a latency guarantee for internet users.

All automated browser profiles run on one machine. They do not validate strict NAT traversal. Before release, test two devices on different networks (for example home and mobile), then Force TURN relay with valid credentials. Verify relay status, edits in both directions, reconnect, and persistence after refresh. This check is still outstanding without a TURN account.

Stage 6 adds convergence diagnostics and broader failure coverage. Real cross-network acceptance remains manual. Cooperative removal is implemented without room rotation, as requested.

## Synchronization diagnostics

The room bar and session list show **Synced**, **Syncing**, **Offline**, or **Mismatch** for the active route. Synced means the current canonical content and sorted CRDT version vector match fresh SHA-256 fingerprints from every admitted remote session, with no pending local update acknowledgments. A room with no peers reports Offline / local copy; waiting for an initial route retains its waiting message.

CHECK messages have a monotonically increasing sequence and are scoped to the full route identity and room generation. Changes invalidate local verification immediately. Fingerprints are cached until the document changes, coalesced over 60 ms, and refreshed during the 5-second repair exchange. Checks older than 15 seconds cannot confirm synchronization. Different versions are normal while edits travel and show Syncing; only equal versions with differing canonical content show Mismatch. Late checks, old-map checks, and asynchronous hash results for an obsolete document cannot mark the current route Synced. Cursors, profiles, zoom, selections, and local panels are excluded from the canonical content.

Mismatch preserves local data and prompts the user to reconnect and check again. The app does not silently replace a divergent document with another peer's snapshot. Diagnostics concern connected, admitted peers and the active route; they do not prove that a disconnected participant has received changes or that every archived route has been compared.

## Removing a participant

The creator can hover over another participant in the top roster and click the cross, then confirm the named participant. The button also appears on keyboard focus and stays visible on touch devices. Players and spectators can both be removed. The target standard client disconnects, returns to its local route, clears the room URL and automatic resume, and displays a removal notice. Remaining sessions keep the same room code and route.

KICK is addressed to a session ID and accepted only from an admitted transport peer with the known creator identity. Other participants cannot remove anyone through the UI or session API. There is no ban list, invitation rotation, or cryptographic creator authentication. A removed user may intentionally rejoin with the same invitation; a modified client can ignore the request.

## Manual network acceptance

The automated suite uses native WebRTC in isolated browser profiles with controlled Nostr signaling, including the Pages bundle under /RoutePlanner/. It covers reconnect, simultaneous edits, packet loss/reordering/duplicates, role enforcement, dungeon switching, checks, and cooperative removal. It does not emulate Internet NAT topologies.

| Setup | Procedure | Required result | Status |
|---|---|---|---|
| Home broadband and mobile hotspot | Join the same room without TURN; edit from both devices, move cursors, switch a dungeon, reconnect | Synced after edits; matching route and roster; connection type reported honestly | Pending separate devices/networks |
| VPN and home/mobile | Repeat in four sessions including a spectator; interrupt one connection and edit offline, then reconnect | Retained edits converge; spectator cannot edit; no stale Synced claim after timeout | Pending separate networks |
| Restrictive NAT with TURN | Configure provider credentials, select Force TURN relay, repeat edits and reconnect on Pages | Actual selected candidate pair reports TURN; canonical checks converge | Pending TURN service and credentials |
| Unreachable signaling or failed relay credentials | Disconnect signaling / use invalid test credentials, then restore valid settings | Useful status, local data retained, successful explicit reconnect | Manual Internet validation pending |

Refresh every participating tab before testing protocol version 4. This is a local branch change; no deployment is implied.

Validation on Node 24: 110/110 unit tests; native WebRTC room scenarios on both source and Pages bundles, including confirmed/cancelled removal and verified four-session convergence; standalone build, data checks, and the Pages prefix/WASM/refresh smoke passed. The removal dialog was visually inspected. Cross-network/TURN cases above remain pending.
