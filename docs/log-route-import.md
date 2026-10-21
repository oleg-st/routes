# Fellowship Logs route import: feasibility and design

Research date: 2026-10-16. Status: browser-side URL importer implemented; authenticated live API verification pending user login.

## Priority targets

Log import does not infer priority targets. Select them manually in the enemy context menu. Manual flags remain saved, synchronized and exported with the route. The retired detectors, fixtures and research are kept locally in `private/priority/`, outside the public build.

## Live URL import (current)

Recoverable problems share one acceptance step in the import dialog. Unmatched packs, unknown Chicken targets, exhausted enumeration and matching timeouts first prepare a partial route. Unprojectable relics also pause import, including when every enemy matched. All discovered problems and omitted mobs are shown together; **Skip issues and import** uses the prepared route without another download or matching run. No preview or save occurs before this click. Failed recovery, incomplete downloads and unavailable identities do not offer the button. Cancelling clears the pending route; warnings remain in saved pull notes and diagnostics record `importIssues` and `acceptedIssues`.

In `Y4W8HvtykGhVqrC9/1`, the portal endpoints overlap Xul's Interior and Sanctum bounds, while map-change names are empty and log positions have no height. After explicit acceptance, the importer omits that annotation without guessing a floor and keeps the enemy route and other drawings. Downloaded diagnostics include `skippedRelics` with endpoint times, world coordinates and map context. Offline replay produces 99 candidate routes with 12 pulls each; one deduplicated portal marker is omitted.

Replay fixes for `Hmd6QrcxDn8YWkGq` (2026-10-20): fixed-size death summons are matched jointly when nearby parents die together. Fight 2 has two Golems dying 67 ms apart and six overlapping Shardlings; the classifier now accepts the complete two-trio assignment without claiming an individual parent where it is ambiguous. Across the run, 12 Shardlings are classified as summons and 10 remain map enemies. All 13 Zealots remain ordinary enemies. Two lack supported placements at the default radius; **Find missing mobs** recovers them at 1900, with G24 in pull 2 in all eight complete variants. The user confirmed G24; this is a regression expectation, not a report-specific runtime override.

Movement-gap recovery now also permits a directed detour when a fresh player heading approaches a pack but its straight continuation misses the aggro circle. Contact must precede first engagement, and the trip to the circle and back to the next recorded position must fit the observed speed and gap duration. Death, teleport, invisibility, dormant activation and stale-heading guards remain in place. This is explicitly recorded as a movement hypothesis; it does not expand the 1500 aggro radius or become observed contact. Fight 14 now has three complete candidates, each retaining all 86 enemies and all three G35 Souls in pull 1. Fight 20 retains its single candidate with 88 enemies and its existing turnaround hypothesis.

`Import from log` now accepts a Fellowship Logs URL. Saved examples have been removed from the UI and publication bundle; research fixtures remain test inputs only. Authorization uses the existing public client with PKCE, binding the callback to `https://oleg-st.github.io/routes/` or `http://localhost:4173/`. Start the application server (`npm run dev`), not the old probe server, for local OAuth. The redirect URI must be registered exactly. Access tokens stay in page memory; only the pending URL/data selection and short-lived PKCE transaction use session storage. Reload requires reconnecting. Callback parameters are removed before application initialization.

A link with a numeric `fight` imports that run directly. A report-only link first requests lightweight fight summaries (no actors/events), lists newest first and preselects the last run by start time. The user chooses a run and clicks Import before any event download. Labels include `#ID · Clear/Wipe · dungeon · league level · duration`; successful runs use the official completion time, failed runs use elapsed fight time. The current five-level league encoding maps raw 75 to Eternal 55, as verified against the supplied report and screenshot. The Dungeon data hint is omitted from the dialog; matching still uses the selected dataset.

The loader requests selected-fight metadata, minimal actor identity fields, and **one paginated filtered event stream**. No introspection, equipment, talents, ability catalogue, report title or duplicated enemy/friendly stream. Damage/casts provide enemy identities, movement and HP; damage amounts and overkill are retained in replayable diagnostics. Healing provides player positions; initial debuffs preserve pre-movement NPC coordinates. Relic/empowered effects, deaths, summons, map changes and boss boundaries are retained. Opaque event JSON cannot be field-projected by GraphQL, so unrelated amounts and resource bars are discarded immediately after receipt. There is no automatic fallback to an unfiltered full export.

Offline comparison of this selection against the saved exports: Stormwatch 124,993/160,318 events, same 1 candidate and 5 intended pulls; Urrak 136,239/185,351 events, same 8 custom candidates and 2 pulls; portal Sands 71,557/99,205 events, same 2 conditional candidates, 8 pulls and 1 portal. These figures compare one stream; the old downloader fetched it twice. Original Sands' older export omits actor 41 (second Chicken's original target), so the generic matcher correctly stops instead of substituting the research assignment. Fresh metadata should include cast-only targets; this needs real API verification.

Matching runs in a cancellable module worker, using current dungeon data, verified summon rules, forward/reverse approach, fixed empowered placements and corroborated within-run HP contrasts. It first tries exact counts. If none fit, at most one unobserved **sibling in an observed pack** may be proposed as an explicit hypothesis. The UI requires a choice even if that hypothesis has only one candidate, and preserves the caveat in the route note. No entirely unseen pack is invented. Incomplete pages, missing identities, exhausted enumeration limits and unsupported cases do not commit a route. Same-type placement assignment remains geometric within each enumerated pack combination, not a proof of exact spawn identities.

Validation: 72 unit tests, public-bundle browser tests for PKCE callback, filtered request shape, worker loading beneath a Pages prefix, saving/cancellation and token privacy (mocked API), plus review UI tests. Actual login reached Fellowship Logs/Cloudflare; user deferred signing in. Server-side filter syntax, CORS and fresh first-log identity coverage therefore remain unverified against the live service. Historical prototype details below are superseded by this section.

## Current prototype update: selected data, wipes, buried mobs and fourth log

The importer uses the **current Dungeon data selection**, with separate prepared candidates for `custom` and `fellership`. Custom Urrak has 8 supported candidates (one ranks best by reverse approach); Fellership has 6. Stormwatch has one candidate for either dataset. Original Sands keeps its validated placement hypothesis, regrouped using the selected dataset. These are offline fixtures, not a live API importer. Legacy Urrak grouping overrides are not applied to custom groups.

Buried placements (`burried` in custom data, or legacy `activation: player-contact`) engage individually. Their provisional player-contact radius is **100 world units**, versus ordinary aggro/chain radius **1500**. They cannot be targeted or chain-pulled before being uncovered: attacks and NPC observations do not establish activation. Visible living player samples within 100 supply forward and reverse evidence; missing samples do not prove the real trajectory never touched the mob. Unique observed spawn identities still establish identity where an initiating contact was not sampled.

The intended route keeps each observed NPC identity and matched placement in its **first engagement**, including bosses. A later attempt contributes only new mobs; empty repeated attempts disappear. Different instance IDs are not merged merely because they share a type or nearby position. API segments remain the starting boundaries; individual player deaths while the group continues fighting do not split a pull. Stormwatch now has 5 nonempty intended pulls rather than 7 actual attempts.

Empowered placements are fixed. Confirmed Victory Rush sources can only match empowered placements of the same NPC type. The original Sands analysis also retains its corroborated HP constraints. Unknown status is not treated as normal. Import preserves all preset empowered markers, including unpulled mobs, and adds observed confirmations. Previously it overwrote the whole-dungeon preset with only imported mobs, so toggling Empowered failed to restore unpulled G39. Shadow Lord scoring was correct: the G39 pack with empowered Acolyte scores 15/130 = 11.54% with Shadow Lord and 17/130 = 13.08% without it.

Fourth log `rgTQYB9dqPzjJFha / 7` is available as a **conditional prototype**: 2 candidates, 8 nonempty pulls on custom / 7 on fellership. Exact observed-instance counts have no supported complete-pack solution. Allowing one unobserved sibling yields 2 candidates, both inferring the same Lost Soul `placement-7ae50d47779c68260803384f6f40eb887eb40eba4c9bdf39fa7c49d0fc3cc69a` in G39. Ghorn already replaces another Lost Soul and one Husk from that displayed pack. The inferred Soul lies just outside the preset removal radius, so an inaccurate Ghorn boundary remains an alternative explanation. The UI and saved pull note explicitly retain this uncertainty; this is **not a verified exact route**. `--unobserved-members=N` is a separate diagnostic output and never silently relaxes the strict solver. It only completes packs with actually observed siblings, not entirely unseen packs.

Portal Sickness **1002176** triggers endpoint extraction. Same-timestamp event order is preserved: the preceding Relic Teleport **1506** source position is before the jump, while the debuff target position is after it. Placement cast **1504** and debuff removal do not define endpoints. Each wave averages one crossing per player. This log has 2 waves (3 and 4 players), both outside boss combat, and no missing endpoint samples. Portal/invisibility usages overlapping boss combat are excluded. After excluding boss combat, repeated uses of the same relic are merged when both start and end are within 250 world units in the same direction, regardless of elapsed time. The earliest use is kept. Different relics, different exits and reverse portal trips stay separate. The fourth log therefore imports one portal drawing from its two recorded waves.

Header order: Route Together → Import from log → Import → Export → Share → Routes → Help. Completion commits automatically with no Finish button or success panel. Historical investigation notes below describe earlier prototype iterations and are superseded by this section.

## Offline import UI prototype

UI refinement: **Import from log** is a standalone top-bar button. A unique candidate commits directly without showing the review panel. After the final ambiguous choice, the route commits automatically and the panel is cleared; there is no Finish step or success banner. Back/Cancel remain available while choices are unresolved. A save failure retains recovery controls (Retry/Cancel).

Validation: 55 log-import unit tests pass; `tests/log-import-prototype-browser.mjs` covers all three logs, hover/focus, globally compatible choices, Back, cancellation preserving the prior route, and Chicken/invisibility export. Existing transfer tests pass for HTTP and `local.html`. Public Pages-prefix browser test covers the prototype and persistence after reload without external requests. Both builds succeed. Full `npm run check` is blocked by the pre-existing missing private image `private/images-referenced/demonicritual-full.jpg`; public data validation and explicit local-build freshness checks pass. The user is replacing game data with Sheepi in a separate session; regenerate fixtures after matching against that dataset. The UI rejects fixtures referencing removed placements instead of silently losing them.

`Import` → `Import from log · Prototype` selects one of three saved logs. `scripts/prepare-log-prototype.mjs` compacts the existing analysis outputs into `log-import/prototype-fixtures.js`; the browser never fetches raw logs, credentials or Fellowship Logs endpoints. Sands / Stormwatch have one prepared candidate each; Urrak has six. `review-session.js` progressively filters complete-run candidates, renders the common prefix and common members of the first divergent pull, and supports Back and an explicit no-more-packs option when applicable. Hover/focus highlights exact placements rather than their possibly merged upstream groups. The preview is separate from the stored current route; Cancel restores it, Finish writes a new draft and preserves a changed prior draft in the library. Single-candidate logs commit immediately. This tests the interaction, not a new live matching engine. Pull boundaries use API segments, with repeated boss identities represented at their final encounter; improved logical pull boundaries remain future work.

Chicken flags, observed empowered assignments, affixes and complete invisibility skips are projected into the route. Invisibility overlapping recorded boss combat is omitted (half-open intervals allow a skip ending exactly at boss start). **Portal support is deferred at the user's request.** Its future evidence rule is positions immediately before and after the portal-use debuff, paired per player and then averaged separately for entrance and exit; the relic cast is not the route marker. Exclude boss-combat uses for both relics. User-supplied portal validation report: `https://www.fellowshiplogs.com/reports/rgTQYB9dqPzjJFha?fight=7&type=summary`; not fetched by this prototype.

## Applied known grouping exceptions (latest)

On the user's instruction to account for the cases already found, `log-import/pack-corrections.js` now applies explicit placement-scoped overrides in the generic research runner by default: Urrak G21 becomes patrol/static triples (accepted working model despite planner disagreement); G48 becomes a Mancatcher pair and three independent buried flowers. Stable placement IDs and original map data are preserved. The editor's displayed grouping has not been changed. No other mixed group or Slaughtervine is automatically reclassified.

The three known buried flowers supply neither generic 1,000-unit player/chain proximity support nor reverse proximity penalties. Direct logged attacks still supply evidence. With no known contact radius, missing contact evidence is explicitly `approachUnknown`, not proof of engagement or a reason to reject a candidate. Exact spawn identity remains independent evidence. Anchors from older analysis files are remapped to corrected packs by placement ID, including required packs, engagement times and attack propagation.

Re-run: `node scripts/check-log-reverse-approach.mjs fellowship-route-events-probe-JLhT1y4Fa3n9Xjx8-6.json tmp/log-import/JLhT1y4Fa3n9Xjx8-6`. Output: `reverse-approach-corrected-packs.json`. **15,460** count-compatible sets exhaustively enumerated in **129,253** nodes; **6** survive identity/approach constraints, still differing only in two of G36/G37/G39/G40. All six include all three independent G48 flowers, identified by coordinate anchors at distances **0.589, 0.351, 1.033** units (actors 32:7/8/9); contact activation remains unknown. The old three reverse contradictions remain conditional on the unverified activation behavior of the other flowers; do not present them as proven missed pulls. `--raw-packs` reproduces the uncorrected model, and `--split-g21-patrol` retains the older isolated hypothesis comparison. All **52** log-import tests pass, including independent flower handling, identity preservation and no attack propagation across the G21 split.

## Patrol grouping audit (2026-10-16)

**New user mechanic evidence: buried Slaughtervines.** The user reports that each buried flower engages independently only when a player steps onto it; Sheepi's tooltip explicitly labels `Slaughtervine (Buried)`. For the three flowers associated with our Urrak G48, the corrected grouping model is therefore **two Mancatchers + three independent single flowers (2+1+1+1)**, not simply patrol/static (2+3), nor the three displayed groups inferred earlier from the Method screenshot. This is user-supplied gameplay evidence. No numeric activation radius is known. Proximity within the generic 1,000-unit radius is not sufficient to infer engagement of a buried flower; do not transfer normal pack-wide aggro to it.

Our catalog has only `dr-slaughtervine` / game ID **182**, named `Slaughtervine`; the inspected placements have no buried-state field. Do not silently label every Slaughtervine in every dungeon as buried. The existing runner has not yet incorporated this mechanic: its earlier Urrak reverse contradictions involving G36/G37/G39/G40/G50 must not be treated as reliable evidence until their buried state/activation rule is established. The six-candidate result remains conditional on the older grouping and range assumptions. A subsequent implementation needs placement-level activation/group corrections and a measured or explicitly provisional contact radius; a new radius must not be invented as a known game value.

User comparison: Method labels the Urrak trio Bloodfang Raider + two Frenzied Looters **G5**, and the stationary Butcher + two Urrak Slavers **G83**. Shippy also displays separate selections. However, the user subsequently checked the Fellowship route planner and found the same merged group as ours. These planners disagree; separate selections/group IDs are evidence about their data models, not direct proof of independent in-game aggro. Keep the G21 split as a supported research alternative, not a confirmed universal correction.

`node scripts/audit-patrol-packs.mjs` audits the current corrected map catalog without changing it, saving `tmp/patrol-pack-audit.json` with placement IDs and compositions. Across **15 dungeons / 922 packs**, **193 packs** contain patrol paths and **44** mix members with and without paths. **28 packs** contain multiple exactly distinct paths (overlaps the mixed category; this is not geometric path comparison).

Relevant mixed groups: Empyrean Sands **G15, G25, G31, G49, G51**; Stormwatch **G10, G37**; Urrak Markets **G18, G19, G21, G48**. In particular, Sands G31 includes two patrolling Husks and six members without paths, so blindly splitting all mixed groups would also change the original report's assumptions. Missing paths could reflect incomplete metadata; path presence alone does not encode an aggro link. Use this audit to identify candidate alternative groupings, then seek independent evidence (engagement timing, identities, surviving/unengaged members, later engagement of the other subgroup). Count compatibility alone cannot prove a split. No production group IDs or route placement IDs were changed by the audit.

## Conclusion

Two authenticated exports confirm dungeon pulls, actor instances, dense position samples, deaths, and relic/affix events. A local prototype enumerates whole packs and ranks joint one-to-one assignments using spawn/patrol geometry, prior player/NPC proximity, and no reuse of killed packs. It records Chicken targets and detects empowered instances. **Exact reconstruction is not yet proven**: feasible routes depend on the configured ranges and recorded observations, and full-run alternatives remain. These are research tools, not a production importer.

Do not describe an import as exact until every route-relevant pack and Chicken target is unambiguous. Permutations of identical members within the same pack/pull do not change the route unless one of them is a Chicken target. A best-scoring candidate is not proof of identity.

## Current experiment results (supersedes metadata-only hypotheses below)

### Reverse approach check and three-report run (latest)

Implemented `log-import/reverse-approach.js`, used by the original Sands ranker and the generic runner `scripts/check-log-reverse-approach.mjs`. A living **visible** player sampled within 1,000 world units of a static spawn is strong soft evidence that the pack was engaged. A skipped pack contributes one contradiction regardless of sample rate. Candidates are ranked by fewer unexplained skipped packs first, geometric score second; they are **not rejected** by this evidence. Selected packs explain whole-run presence, so walking past an already killed selected pack never creates another required pull. Known engagement times stop static-spawn evidence; removed Ghorn/Witch placements are omitted. Unknown patrol phase, invisible/unknown visibility, dead players and unsampled movement cannot create this strong evidence. No wall, height or line-of-sight guarantee is implied.

The generic runner compares pack presence across the whole run, retaining each actor/instance once across API segments. It does **not** yet reconstruct every logical pull boundary, re-engagement or individual member permutation. Unique coordinate anchors remain identity evidence even where the initiating aggro cause was not recorded; missing causes are reported instead of rejecting the known identity. The original Sands run retains its previous health/empowered constraints and per-pull matching. The other two reports lack empowered affix 12.

| Report / fight | Result |
|---|---|
| c4nFLaThdAxtVpYv / 5, Empyrean Sands | Reverse evidence alone ranks **1 of the former 4** whole-run candidates first: the second pull includes G41. It has zero skipped-nearby-pack contradictions; each alternative skips G41. After the separate Iron Spikes correction, the one feasible pack set remains first. |
| c4nFLaThdAxtVpYv / 12, Stormwatch | Excluding four probable Brogg summons leaves **18** count-compatible whole-run pack sets, exhaustively enumerated. Reverse evidence's best tier contains **2**, differing only in Dire Wolf **G33 vs G35**. Forward approach/patrol evidence rules out G35 and leaves **1** supported pack set. G33 is the patrol near the observed wolf; G35 is unsupported and its spawn is ~11,016 units from the first wolf observation. |
| JLhT1y4Fa3n9Xjx8 / 6, Urrak Markets | Treating every displayed group as indivisible gives no complete explanation. **Under the separate G21 patrol hypothesis, all ten Looters are retained and 6 supported pack sets remain.** They differ only in two Slaughtervines from G36/G37/G39/G40. See the correction below; the earlier eight-Looter ceiling was conditional on an overly restrictive grouping model. |

Stormwatch still has an unexplained **G36** proximity witness: Baiqi at +154.390 s was **993.514** units from a rat spawn. G36 has three Dire Rats, while all four observed rats belong to anchored G37. Both leading count-compatible alternatives therefore skip G36. This is precisely why radius 1,000 remains soft: proximity at its edge must not force three nonexistent observed kills into the route. Missing Z/line of sight and approximate radius remain possible explanations, not established facts. For anchored Brogg (G1, error 1.118) and Profane Invoker (G2, error 0.410), the current causal filter lacks an initiating witness; their identities are retained and the missing cause is recorded.

Urrak's initial diagnostic (superseded by the G21 hypothesis below): G47 supplies three Looters and G29 five. G4 would require extra Bloodfang beyond the three already fixed by G5/G6; an indivisible G21 would require unobserved Urrak Slavers. This created a conditional eight-Looter ceiling, **not evidence of two extra or summoned Looters**. A saved partial sensitivity run set 33:9/33:10 aside without claiming a valid route; it still had forward contradictions. That diagnostic should not be used to import a route.

**User correction and G21 patrol hypothesis:** ten Looters can only come from **G29 (5) + G47 (3) + G21 (2)**. G21 in the map catalog merges three moving members (one Bloodfang Raider and two Looters, with the **same 301-point patrol path**) with a stationary Butcher and two Urrak Slavers. Ghorn is observed exactly at the G18 replacement coordinates, so a Ghorn replacement of G21 does not explain the missing stationary members. The user is unsure whether the moving and stationary parts can aggro independently; do not promote this to a confirmed game mechanic or change production group data.

The observed late trio fits G21's moving part: Raider 26:8 and Looter 33:9 first appear at +454.048 s, Looter 33:10 at +454.948 s, respectively **117.825 / 237.860 / 89.820 units** from its patrol. They appear before the boss encounter (+491.954 s). These are retained ordinary route enemies, not summons.

**Grouping provenance:** the user reports separate patrol/static packs in both Shippy and Method. Compared all six G21 placements in local `data/dungeons.json` with the installed `@crockery/fellowship-data@15.0.3/data/dungeons.json`: placement IDs, NPC IDs, group IDs, pack IDs and patrol flags match exactly. All six already have `groupId:21` and `pack-aa81cf1cb4bf8081ba7c13bbd449819a4029d7a453e84dd2bdc429d0f4b183fb` upstream. `scripts/prepare-data.mjs` copies that JSON; `app.js` uses the supplied `packId` for group selection, search and tooltips. Urrak has no local placement correction merging these groups. Thus the merge is present in the consumed dataset, not introduced by our map display or log importer. The upstream algorithm responsible is not established: generator sources are absent from the npm distribution, and the repository paths advertised by its package metadata were not retrievable. Do not invent a proximity-clustering or group-ID-collision explanation without that source.

Run `node scripts/check-log-reverse-approach.mjs fellowship-route-events-probe-JLhT1y4Fa3n9Xjx8-6.json tmp/log-import/JLhT1y4Fa3n9Xjx8-6 --split-g21-patrol` for the explicitly labelled hypothesis; it writes `reverse-approach-g21-patrol-hypothesis.json` separately. All observed enemies are retained. There are **9,276** count-compatible sets (exhaustive), **6** supported by forward approach/identity evidence, all in the same best reverse tier. The six differences are G39+G40, G37+G40, G36+G40, G37+G39, G36+G39, G36+G37. Each consists of two singleton Slaughtervines. All contain G21's moving members, G29 and G47; the false forced assignment of early Raiders to distant G20 disappears. Unique boss types identify their single catalog placement even when the initiating aggro cause is not sampled; the latter stays reported separately.

Reverse evidence cannot distinguish these six by the number of omitted nearby packs: all omit two of G36/G37/G39/G40 and G50. The recorded closest visible-player distances are **207 / 613 / 314 / 202 / 256**, respectively, at different times. The best geometry score selects G39+G40, but that is not proof of identity. These unresolved proximity contradictions, unknown 3D obstruction and the unconfirmed G21 grouping prevent an exact-route claim. G34 is included in the six supported candidates; its earlier contradiction belonged to the superseded partial diagnostic.

Reproduce each report with:

```powershell
node scripts/check-log-reverse-approach.mjs fellowship-route-events-probe.json tmp
node scripts/check-log-reverse-approach.mjs fellowship-route-events-probe-c4nFLaThdAxtVpYv-12.json tmp/log-import/c4nFLaThdAxtVpYv-12
node scripts/check-log-reverse-approach.mjs fellowship-route-events-probe-JLhT1y4Fa3n9Xjx8-6.json tmp/log-import/JLhT1y4Fa3n9Xjx8-6
```

Each output directory receives `reverse-approach-result.json` with witnesses, pack labels, classifier reasons, complete enumeration flags, retained candidates and unresolved cases. The old Sands source ranks are inputs, not recomputed by this comparison script. `node scripts/rank-log-packs.mjs --exclude-retaliation` recomputes them with the integrated reverse ranking. **49 log-import tests passed**, including reverse evidence, invisible/dead players, patrol phase, cleared/replaced packs, direct summon identity, rule extensibility and conservative late-encounter suspicion.

### Summons: FL first, overlay heuristics second

The actual exported Fellowship schema supports `EventDataType.Summons` and actor `petOwner`. The supplied complete `All` streams contain **zero summon events**; Mancatcher and Looter actors have `petOwner:null`. This does not establish that FL can never identify summons. Probe v4 now also requests nested `enemyPets`/`friendlyPets` fields (v3's automatic selection omitted names containing only `pet`). A new export would be needed to inspect those fields; no token/client secret is stored or required for the offline work.

The screenshots' lower block shows Pillager ×6 in Pull 6 and Brogg in Pull 7. The API's Pull 7 **name** is Brogg, but its `enemyNPCs` includes Brogg, Mancatcher 7–10, Pillager 8–13 and Anomalous Orb 13–15. Thus `enemyNPCs` is a participation list, not the UI's filtered route composition. Preserve Pillager 8–13 from their initial Pull 6; they remain alive into Pull 7. The UI screenshots are useful validation evidence, but the existing export does not expose a verified equivalent of its filtered composition.

Inspected `C:/Work/Fellowship-overlay/src-tauri/src/dungeon.rs`: its general rule classifies a newly observed non-boss NPC at least **12 seconds** after encounter start as boss-spawned; it also has a specific Ice Shardling / Spellbound Golem death window. The broad late-encounter rule can misclassify a late additional pull. `log-import/summon-evidence.js` therefore prioritizes exact FL summon events/instance identity and NPC ownership, then an extensible verified boss-cast/child-type rule registry. Generic late-encounter candidates are retained as **suspected-only**, not excluded. This is a general mechanism with limited currently verified rules, not universal boss-summon coverage.

Brogg is the verified cast rule: FL ability **631 `Raiders!`** matches local `GA_NP_BossHellcaller_Summon`; the user confirms the mechanic. Two casts at +670.145 and +747.756 s precede new Mancatchers 53:7/8/9/10 by **833 / 1,634 / 836 / 836 ms**. These four are labelled **probable summons** in the research run. Earlier Mancatchers and all carried Pillagers are retained. No Looter is excluded by this rule; no generic 12-second exclusion is used. Known rules are extensible and tested for other boss IDs, but adding a boss requires evidence of its spell and child type.

The supplied second export has two identical 129,574-event streams (13 pages each). Their whole-stream hashes match; process one stream, without deduplicating individual equal-looking events. Position resources have X/Y, facing and HP, but no Z or stable spawn GUID. World X = log Y and world Y = log X agree within 2 coordinate units at sixteen independent same-type spawns. The four players have 10,722–17,443 samples each, with maximum internal gaps of 0.903–2.337 seconds. This supports sampled traces, not exact continuous movement.

There are 106 identifiable NPC instances, including 62 with static-catalog types. The cast-only Acolyte replaced by Chicken has no coordinates. Buff-removal events can occur after a mob's death in a later pull; do not use all events or instance-ID bounds as pull membership. Chickens, Emissaries and Ruinous Stars need separate handling.

The earlier probe filtered actor metadata by `fight.enemyNPCs` and accidentally omitted referenced actor IDs 16 and 41. Actor 41 is the second transformation target. This is a probe bug, not an API limitation. The probe now retains all event-referenced actors. Existing exports remain unchanged.

### User-confirmed mechanics

- Any player can pull with an attack/ability or body aggro, including mounted movement. A moving aggroed pack can aggro another pack. The first recorded hit can be much later than initial aggro.
- Packs engage completely. Survivors can be pulled as a partial pack after a wipe; this run has no wipes.
- Chicken removes an original mob and replaces it with a Chicken that must be killed. It gives no dungeon percentage. Record which original enemy was transformed, **not a cast-point annotation**.
- An empowered mob can be transformed, usually at the start of a pull. Preserve both statuses. No death-triggered buff does not imply that a transformed mob was normal.
- The earlier assumption that this run had no invisibility was corrected: cast 1486 and four buff intervals confirm Major Invisibility. No portal cast was found. A portal applies a 20-second reuse-prevention debuff; its FL event representation still needs a real sample.

### Causal approach filter (latest result)

The initial research used a provisional **1,000-world-unit body/chain aggro radius** (`causal-1000-health`). After comparison with saved logs, the user first selected **1,200**, then **1,500** after gap-based movement evidence made the larger radius useful for Grove. `log-import/matching-config.js` is the single configuration point; all four players and already-active NPCs use this radius. The targeted-attack fallback remains separately configured at 6,000 units. Larger research radii are diagnostic comparisons only, never automatic fallback settings. Lack of a sample within radius is conditional evidence, not a measured physical boundary; the current gap hypothesis is described under Approach radius below.

After fixing propagation of targeted aggro to an established pack's other members, radius 1,000 leaves **1 / 50 / 1** feasible pack sets for pulls 1 / 2 / 3 and **four complete-run combinations**. The earlier zero-result was a filter bug, not evidence that body-aggro radius had to be increased. See the diagnostic below.

The user specified three pull causes: an individual player approaching, a player using an ability/attack (including Chickenize), or an already-active NPC chain-pulling the pack. One player may split off and run ahead; never use the tank/group center or heading as a hard filter.

`log-import/approach-filter.js` builds time-indexed witnesses for each full pack's spawn/patrol geometry. Every observation-to-placement edge must have an eligible witness no later than that observation's first event: any living sampled player within player radius, an active NPC sampled strictly earlier within chain radius, or an attack/cast on that original actor/instance or an established member of its pack within the configured attack range. The ranker supplies member identities fixed by unique coordinate anchors within two units; it never treats merely matching NPC types as established membership. Unanchored identities still require joint assignment before a targeted attack can be safely shared, which remains a limitation of this prototype. Dead NPC samples are excluded. NPC evidence at the exact first-event timestamp cannot justify that NPC's own pull. Checking every assigned member guarantees that the earliest member of the pack has external evidence; later members cannot circularly justify it. The Hungarian assignment includes these constraints before choosing a matching, avoiding rejection based on just one unconstrained greedy assignment.

For Chicken, use the original cast target identity and cast time, not the replacement's first position 1.1 seconds later. The original remains in the whole-pack composition and is excluded from score. The research adapter includes ability-1478 casts, including cast-only actor 41.

Three hard-filter experiments use player/chain radii 1,000, 3,000 and 6,000 world units and a provisional targeted-attack range of 6,000. They deliberately start from the original 3,117 first-pull sets, without the user's G35/G37 exclusions. All leave exactly **one first-pull set**: **G25/G26/G28/G31/G32/G34/G42/G43/G45/G50/G53/G64**. Four disjoint full-run combinations remain because pull 2 is not yet unique; all experiments rank the same full route first. There is no new need to ask the user to rule out distant packs one by one.

This is uniqueness under configured ranges, complete-pack/coordinate anchors, the current historical empowered-position preset, and recorded observations. Missing movement, unknown floor/line of sight, uncalibrated body/chain ranges, or an ability exceeding the provisional range can change feasibility. No universal maximum attack range is claimed. Future production use needs verified per-ability ranges and an explicit insufficient-data result when samples do not cover a possible approach. The review shows causal candidates; distance-only baselines stay in JSON diagnostics instead of being presented as equally supported alternatives.

### Diagnosis of the former 1,000-radius failure

`node scripts/diagnose-log-approach.mjs` compares the first-pull assignment at 1,000 before/after propagating an established member's targeted attack. **Only G45** failed in that assignment. Lost Soul 35:1 is a unique coordinate anchor in G45 (0.723 units from its spawn). At +20.041 s, Baiqi casts ability 1843 on that exact actor/instance; a matching debuff event has `extraAbilityGameID:1843`. The new report's ability metadata identifies 1843 as Taunt (`T_Sune_Taunt.jpg`); `GA_Sune_SingleTargetTaunt` has range 4,000 in the local ability catalog. Recorded target distance is 2,653.147 units. The original filter accepted this one mob but rejected six later members, since it looked for a separate direct attack/body approach for each. This violated whole-pack aggro. Sharing the anchored member's cast fixes the contradiction without changing radius 1,000.

Distances below are minima from eligible player/NPC samples no later than the first assigned event, to any member's spawn/patrol geometry. NPC observations must strictly precede it. These minima need not occur simultaneously; patrol phase is unknown. No row is a measured universal aggro radius.

| Pack | First event, seconds | Closest visible player | Closest active NPC | Evidence at radius 1,000 |
|---|---:|---:|---:|---|
| G28 | 7.983 | Baiqi: 608 | none | Player approach |
| G25 | 14.263 | Naga: 893 (at 11.022) | Husk: 4,470 | Prior player approach to patrol |
| G43 | 15.766 | Baiqi: 68 | Husk: 84 | Approach/chain to patrol |
| G32 | 18.742 | Baiqi: 852 | Reaver: 3,658 | Approach; also direct attack |
| G45 | 20.041 | Baiqi: 2,653 | Husk 34:8: 2,813 | Taunt on anchored pack member; formerly false rejection |
| G34 | 20.245 | Baiqi: 472 | Husk: 313 | Approach/chain; also direct attack |
| G31 | 21.748 | Baiqi: 872 | Husk: 1,755 | Approach; also direct attack |
| G26 | 105.827 | Baiqi: 1,072 | Reaver: 2,749 | Direct targeted cast/attack |
| G50 | 108.934 | Baiqi: 1,392 | Reaver: 2,586 | Direct targeted cast/attack |
| G42 | 111.872 | Baiqi: 2,243 | Acolyte: 3,965 | Direct targeted cast/attack |
| G64 | 113.041 | Baiqi: 2,359 | Gravescythe: 542 | Chain to patrol; also targeted cast/attack |
| G53 | 114.646 | Baiqi: 1,423 | Gravescythe: 1,613 | Direct targeted cast/attack |

For G45, the four players' minimum pre-event pack distances were Baiqi 2,653.193, BigOz 4,532.686, Naga 5,482.802 and Oleg 5,868.542. The closest NPC sample was Husk 34:8 at +19.977 s, 2,812.534 units away. The six false rejections were Husk 34:11/34:13, Lost Soul 35:5/35:6/35:8 and empowered Acolyte 37:3. Full samples/timestamps are saved in `tmp/log-import-approach-diagnostic.json`.

### Pull 2: why four alternatives survive the baseline

`node scripts/diagnose-log-pull-two.mjs` saves the comparison to `tmp/log-import-pull-two-diagnostic.json`. All four full-run-compatible variants share **G8/G21/G55/G65** (16 original enemies, including the inferred Sentinel Chicken target in G21). They add exactly two ordinary Sandsworn Husks: **G41**, **G40**, **G35 + G36**, or **G24**. The four observed Husks 34:19–22 all have maximum HP 1,549,271. Two belong to common G21; identities can swap between G21 and the additional pack(s), so rechecking only the best assignment is insufficient for eliminating a whole variant. There is no patrol geometry for these alternative packs.

Distances below are independent minima over eligible samples before the first assigned event of each hypothesized pack, to the closest member's spawn. All closest players are Baiqi. Units are world coordinates, not verified meters. The explicit-attack distance is the caster-to-hypothesized-pack distance used by the baseline, not the observed caster-to-mob distance.

| Additional pack(s) | Closest player | Closest active NPC | Baseline evidence |
|---|---:|---:|---|
| G41 | 828 | 1,500 | Baiqi crossed radius 1,000 at +266.557 s (998); reached 828 at +266.821 s, before first observed Husk at +268.324 s |
| G40 | 3,632 | 3,016 | Iron Spikes accepted as an initiating attack from 3,980 units |
| G35 + G36 | 4,104 / 5,138 | 4,507 / 5,442 | Iron Spikes accepted from 5,035 / 5,817 units |
| G24 | 5,232 | 4,634 | Iron Spikes accepted from 5,239 units |

This exposes an over-permissive attack adapter: every player damage event currently receives the same provisional 6,000-unit attack bound. The new export's ability metadata identifies **1002109 as Iron Spikes**. The installed `@crockery/fellowship-data/data/itemTraits.json`, trait `ItemTrait.ID.IncomingDamageToDefenceAndDamage`, describes retaliatory damage to enemies that damage the wearer. This effect is not evidence of an initiating ranged attack.

At +269.127/+269.561/+269.628 s, Husks 34:20/21/22 first appear as targets of Iron Spikes while already **426/439/425 units** from Baiqi. Each has a matching melee cast/damage (ability 783) against Baiqi at the same timestamp or 1 ms later. Event ordering can put the retaliation before the triggering melee hit. These are close-combat observations of already-engaged enemies; interpreting them as pulls from distant static spawns is unjustified. Retaliation events must remain useful position/combat evidence while being excluded as independent initiating attacks.

The diagnostic removes only 1002109 from initiating-attack evidence and rechecks the saved assignments: G41 has no failures, while every distant alternative loses its required evidence. `node scripts/rank-log-packs.mjs --exclude-retaliation` performs a separate complete reassignment/ranking and writes `tmp/log-import-ranked-packs-no-retaliation.json`; the baseline file is preserved for comparison. This experiment does not change body/chain radius 1,000, the general attack fallback, or the production application.

**Full rerun confirmed:** at radius 1,000, feasible sets become **1 / 20 / 1**, and enforcing no pack reuse across the run leaves **one whole-run combination**. Pull 2 is **G8/G21/G41/G55/G65**. This also checks alternate assignments of the identical Husks, rather than rejecting only the previously selected assignment. Radius 3,000 also leaves one whole-run combination; radius 6,000 still leaves four, because proximity itself then admits the distant packs. The result is conditional uniqueness under the current sampled-evidence model, not proof of exact reconstruction under every unknown mechanic. Other damage effects still need classification (e.g. ground-area ticks should use area origin/coverage, not an arbitrary caster-to-spawn range).

### Earlier user feedback: G35/G37 excluded

G35 was also ruled out by the user. Its nearest recorded player/NPC positions before the end of pull 1 are 14,405.23/13,311.96 world units, with no patrol. Combined manual exclusions leave 1,516 first-pull sets and 7,099 disjoint pairs (4,139 with empowered-position constraints). These manual exclusions remain validation feedback and are not used by the causal experiment above.

The user ruled out displayed G37 in pull 1. This exclusion is scoped to this report/fight/pull in `research-confirmations.json` and applied before ranking. The closest recorded player/NPC positions before the end of that pull are 5,590.32/5,600.66 world units from G37; the pack has no recorded patrol. These samples support the user's exclusion but do not establish a universal hard aggro radius.

The exclusion reduces first-pull count-compatible sets from 3,117 to 2,559; globally disjoint first/second-pull pairs fall from 14,527 to 11,599 (6,659 with historical empowered-placement constraints). All five proximity-aware scenarios now choose **G25/G26/G28/G31/G32/G34/G42/G43/G45/G50/G53/G64** for pull 1. Spawn/patrol-distance-only scenarios instead replace G25 with G35 + G67. This residual disagreement is preserved rather than presenting a unique proven route. The counts and two candidates in the following subsection describe the pre-feedback baseline.

### Whole-pack matching

The count solver includes a known Acolyte replacement for Medium Chicken, one unknown original type for Large Chicken, and coordinate-anchor packs. It enumerates 3,117 first-pull sets, 275 second-pull sets and one boss set. Disallowing overlap of killed packs leaves 14,527 count-compatible pairs. Adding the observed empowered statuses and the historical empowered-placement preset reduces this to 8,010 pairs. That reduction is conditional on the preset positions remaining correct.

Minimum-cost one-to-one assignment prevents two observed instances from consuming one placement and preserves exact-coordinate anchors. Eight scenarios compare spawn distance, patrol distance, soft proximity penalties at 500/1000/2000/3000 world units, and empowered-placement constraints. Proximity includes prior samples from any of the four players or another NPC, allowing possible chain aggro. These distances are sensitivity parameters, not measured body-aggro radii. No nearby sample does not prove impossibility.

The scenarios select two leading whole-run candidates. Both have the same second-pull groups G8/G21/G41/G55/G65 and boss G1. Their first-pull choices share ten packs and differ between G25/G34 and G37/G67. Numbers here match the app after canonical boss correction, not raw dataset group IDs. Many lower-ranked alternatives remain; **this is not a proof that exactly two routes are possible**. First-position distance is weak for mobs dragged a long way. Future matching should model pack contact time and observed motion, not tune arbitrary weights until a preferred route wins.

Patrol matching projects onto segments, preserves both spawn and patrol distances, and never invents a closing segment. The data has no patrol timing or phase. `data/abilities.json` exposes `actionProfile.range`, for example 3000 for Highwind Arrow and 6000 for Wildfire. Enemy/dungeon data does not expose body-aggro radius, and coordinate-to-meter conversion has not been verified.

### Affixes and empowered detection

The API fight has `modifiers: [4,6,12,19]`; the `dungeonstart` event repeats these as `affixes`. FL's report header explicitly shows Vayr's Legacy, Asha's Regret, Empowered Minions and Shadow Lord's Trial. Only the numeric mapping for empowered is independently verified below; do not assign the other numeric IDs by guessing their order.

The user supplied an existing implementation in `C:/Work/Fellowship-overlay`:

- `game-data/catalogs/empowered-scaling.json`: empowered affix ID 12, Victory Rush effect 44, nominal HP multiplier 2, score multiplier 3, base HP/difficulty/type scaling tables.
- `src-tauri/src/dungeon.rs`: HP detector requires affix 12 and accepts observed/expected-normal HP ratios from 1.5 through 2.6. Victory Rush explicitly confirms the source NPC. Chickenize ID is 1478 (with a separate catalog-ID alias 5252).
- `game-data/dungeons/6_Empyrean_Sands/dng.json`: Shadow Lord NPC 274, Ghorn 280, Eira the White Witch 281.

In this FL export, the corresponding Victory Rush event is `abilityGameID: 1000044`. Sixteen applications to the four players identify four source instances: Reaver 36:1, Acolyte 37:3, Gravescythe 40:1 and Hunter 43:1. Their HP is consistently about 1.68755–1.68760 times ordinary same-type mobs, corroborating the effect evidence. Do not change the production nominal multiplier based on this one observed ratio. API difficulty 75 and the scaling table need calibration before using absolute expected HP across reports.

`log-import/modifier-evidence.js` detects affix 12 and the source of Victory Rush, with fight/actor/instance checks. It detects Shadow Lord/Ghorn/Eira by game ID. Presence is affirmative evidence; absence of a special NPC does not prove its affix was absent because a group may skip it. If metadata names/IDs are not resolved, keep that distinction instead of silently disabling a modifier.

For Ghorn/Witch, importing the toggle alone is insufficient: resolve the replaced pack and project it to existing `modifiers.ghorn/witch` fields. Do not require the original pack's ordinary members in the whole-pack solver when it was replaced. No Ghorn/Eira event is present in this example, so that replacement matching remains unvalidated.

### Relics and planner representation

| Relic | Route representation | Detection requirements |
|---|---|---|
| Chicken | Original placement remains in its pull; add its ID to `route.excluded` | Cast target actor/instance, transform correlation, original placement match |
| Invisibility | Existing `drawings` with `kind: 'invis'`, cast position to earliest final player exit | Ignore temporary exits followed by re-entry from the same relic activation; retain all per-player intervals in diagnostics |
| Portal | Existing `drawings` with `kind: 'portal'`, entrance to exit | Verified cast/debuff IDs and movement around transit; debuff expiry is not the exit time |

Chicken and empowered can coexist on a placement. The existing scoring function gives Chicken precedence and zero score. Do not infer normal status from missing Victory Rush on a mob removed by Chicken. Prefer original HP observed before transformation, otherwise placement/modifier evidence; leave unknown when unsupported.

Whether Chicken inherits current HP, max HP or HP percentage is unverified. Medium Chicken's observed maximum is 1,555,786, while normal Acolytes in this run have 2,020,919. The original transformed Acolyte has no HP sample. Chicken HP is close to its separate template scaling in the overlay catalog, so do not use Chicken HP as proof of the original's empowered status.

Two Chickenize casts are followed by Chicken first observations 1105/1104 ms later:

- +22.145 s: target Acolyte actor 37 instance 1. The selected original placement in G31 is 4.53 world units from Medium Chicken's first position. The user subsequently confirmed this upper Acolyte in a screenshot and confirmed it was not empowered. This report-specific validation is saved in `log-import/research-confirmations.json`.
- +265.251 s: target actor 41, omitted by the earlier probe. All tested rankings infer the Greedspawn Sentinel in G21. This original type remains an inference, not a recovered actor-table fact.

Both placement candidates are stable across the tested scenarios, which is evidence stability rather than a confidence percentage. `scripts/extract-log-relics.mjs` preserves source identity, evidence and proposed `excluded` values. It does not mutate the user's route or add a Chicken as an extra static enemy. Unknown targets must remain unresolved instead of flagging an arbitrary nearby mob.

Major Invisibility is now verified in the original fight 5. The overlay relic catalog's `item_mapping` maps cast 1486 to relic 5253. BigOz casts it at +371.635 s; `applybuff` 1002146 explicitly references `extraAbilityGameID:1486`. Four applications and four removals all contain the affected player's coordinates. BigOz enters/exits at +371.648/+385.728 s; Naga at +372.673/+385.728 s; Baiqi at +374.276/+384.993 s; Oleg at +374.410/+385.728 s. The early Baiqi exit coincides with the first boss-pull event. Coordinates use the same verified world-X/log-Y swap as the rest of this report. `log-import/invisibility.js` preserves separate per-player intervals; missing starts, ends or positions remain unknown, and refreshes do not reset entry. The review marks both route endpoints on the map.

The approach filter and soft proximity scores now exclude individual player samples during invisibility. Actual buff intervals use [application, removal); a temporary visible gap can still cause body aggro even when the route marker spans that gap. Incomplete boundaries are marked unknown and cannot supply a confirmed body-aggro witness. Attacks/casts (including Chickenize), other visible players, and already-engaged NPC chain aggro remain eligible. The original run has 258 excluded invisible samples and no unknown samples. With the pack-aggro correction, re-ranking leaves four whole-run combinations at all three tested radii; the configured radius remains 1,000.

The route endpoint rule was refined by the user: start at the **caster's cast position**, then use the **earliest final exit among affected players**. For each activation, inspect all of each player's intervals; an exit followed by re-entry is temporary and is not an endpoint. `invisibility.usages` implements this while retaining raw intervals. The first report's marker starts with BigOz at +371.635 s (world X/Y 11861/6692) and ends with Baiqi at +384.993 s (17339/14783). The map shows these two route endpoints, rather than all eight individual buff boundaries. Attribution uses the recorded caster and separates later casts by the same caster; overlapping or incomplete intervals remain unresolved. No short grace period or nominal-duration expiry is substituted for an observed final removal. An incomplete event stream cannot confirm that no later re-entry occurred.

Portal cast mapping is 1504 to relic 5246; neither cast ID appears in this fight. Portal effects still need a real example. Cross-floor portals need a representation decision because an existing drawing has only one `mapId`.

### Additional report audits

Both supplied v3 exports are complete, with actor and ability metadata and no missing referenced actors. Each contains identical Friendlies/Enemies streams; count one copy after whole-stream hash verification. `scripts/analyze-log-import.mjs` now accepts an isolated output directory; `scripts/audit-log-import.mjs` creates a report-specific audit without applying the first run's no-wipe or placement assumptions.

| Report/fight | Dungeon | Unique events | API segments | Coordinate anchors | Recorded relics/modifiers |
|---|---|---:|---:|---:|---|
| JLhT1y4Fa3n9Xjx8 / 6 | Urrak Markets | 185,351 | 2 | 31 of 99 static-type instances | 2 Chicken casts; Ghorn NPC |
| c4nFLaThdAxtVpYv / 12 | Stormwatch | 160,318 | 7 | 23 of 98 static-type instances | 1 Chicken cast; Shadow Lord NPC |

Neither new export contains Major Invisibility cast/buff events or portal cast 1504. Affix 12 is absent in both. Both record three player death events, but neither records deaths of every player; these are not evidence of a full-party wipe. Coordinate matches independently support the world-X/log-Y swap in both dungeons.

The API segments are not disjoint route pulls. In Urrak, 18 living NPC instances cross the 34 ms boundary into the boss segment. In Stormwatch, 10 living NPC instances cross the first boss-start boundary; Brogg is observed in segments 2, 3 and 7. Encounter 26 ends with `kill:false` at +326.610 s, restarts at +643.060 s, and ends with `kill:true` at +764.126 s. The reason for the interruption is not identified. Route reconstruction must preserve instance identity and encounter/life history across segments, avoiding duplicate placement assignment and treating resets explicitly; independent complete-pack enumeration per API segment is insufficient for these reports.

Chicken targets are now explicit in metadata: Urrak casts at +15.495 s on Gorestained Butcher (actor 27, instance omitted) and +352.496 s on Desecrator (23:3); Stormwatch at +475.016 s on Stormscreamer (59:3). The next new Chicken observations arrive 5.813, 2.609 and 8.053 seconds later respectively. Thus the first report's two-second correlation window is not a generic rule. The audit retains the original target identity plus the next observed Chicken as an unconfirmed temporal candidate, without equating first observation and spawn time. Exact placement matching for these new reports remains unresolved.

Reproduce each audit with `node scripts/analyze-log-import.mjs <export.json> tmp/log-import/<report>-<fight>` followed by `node scripts/audit-log-import.mjs <export.json> tmp/log-import/<report>-<fight>`. The resulting JSONs are local ignored artifacts, separate from the first report's ranking and preview.

### Reproduce and review

```text
node scripts/analyze-log-import.mjs
node scripts/solve-log-packs.mjs
node scripts/analyze-log-health.mjs
node scripts/rank-log-packs.mjs
node scripts/extract-log-relics.mjs
node scripts/build-log-import-review.mjs
node --test tests/log-import-*.test.mjs
```

The standalone `tmp/log-import-review.html` shows pack alternatives, patrols, observed movement, first sightings, original Chicken candidates and cast-to-final-exit invisibility endpoints. JSON diagnostics preserve counts, top alternatives, modifier evidence and relic candidates. These are ignored local research artifacts, not a validated import or a deployed feature. Forty focused tests cover pack-wide targeted aggro, invisibility-aware body aggro and re-entry/final exit, report selection, causal approach constraints, one-to-one assignment, enumeration limits, Victory Rush identity and empowered+Chicken scoring precedence.

## Verified evidence

### Example report

[Report c4nFLaThdAxtVpYv, fight 5](https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv?fight=5&type=damage-done) is readable without signing in through the browser. It shows Empyrean Sands, Eternal 55, with Empowered Minions and Shadow Lord's Trial among its modifiers.

The Analyze menu contains three pulls:

| Pull | Displayed start offset | Displayed duration |
|---|---|---|
| 1 | +0:07 | 4:04 |
| 2 | +4:21 | 1:48 |
| 3 | +6:24 | 4:11 |

These are displayed values, not raw API timestamps. The header shows 10:31 while Replay shows 10:36; verify timer semantics before translating timestamps.

The user's Replay screenshot shows the first pull's composition: Sandsworn Husk x18, Emissary of the Shadow Lord, Lost Soul x10, Gravescythe x4, Medium Chicken, Ruins Lasher x3, Acolyte of Sinnari x4, and Tombguard Reaver x4. The screenshot also shows View Route and Snap To Pulls. This is UI evidence, not an API payload.

The report's enemy selector exposes type IDs and individual instance selectors. Type IDs match the local catalog for examples including Sandsworn Husk (176), Tombguard Reaver (175), Acolyte of Sinnari (173), Ruins Lasher (183), and Sin-Magir (87).

Replay currently displays `Error: Unable to fetch data` in both the supplied screenshot and the inspected browser. Existing pull UI does not establish that movement data can currently be retrieved.

### API access

[Official OAuth/API documentation](https://www.fellowshiplogs.com/api/docs), read in the browser, confirms:

- GraphQL v2 public endpoint: `https://www.fellowshiplogs.com/api/v2/client`.
- GraphQL v2 user endpoint: `https://www.fellowshiplogs.com/api/v2/user`.
- OAuth token endpoint: `https://www.fellowshiplogs.com/oauth/token`.
- Public data supports client credentials; this still requires a registered API client and an access token.
- Browser applications can use the documented PKCE authorization flow without embedding a client secret.
- Private reports require access authorized by the user.
- Client registration is available at [API clients](https://www.fellowshiplogs.com/api/clients/).

The documentation's schema link `/v2-api-docs/fellowship` returned 404. The trailing-slash version encountered a Cloudflare security check. Direct command-line retrieval of the OAuth documentation also returned a Cloudflare challenge. No challenge was solved or bypassed. The user subsequently registered a public client, ID `01a143aa-9e56-72b2-842e-07efccacef9c`, with no client secret. They completed browser authorization and supplied `fellowship-route-probe.json`; it contains a successful authenticated schema and fight response. This validates the local browser flow, not yet the deployed GitHub Pages origin.

The original candidate `dungeonPulls` is now confirmed by Fellowship's own schema and response. Do not assume identical event fields, coordinate units, or limits across related services.

### First authenticated export: observed findings

The supplied file has `complete: true` for its stated metadata-only scope. It has no combat events or movement samples.

| Pull | Start relative to fight | Duration | Map IDs | Pull x, y |
|---|---|---|---|---|
| 1 | 7.983 s | 244.684 s | 27 | -41175, -20236 |
| 2 | 261.949 s | 108.487 s | 28 | -3003, -1642 |
| 3 | 384.993 s | 251.121 s | 28 | 18107, 17181 |

- `ReportDungeonPull` has `boundingBox`, `x`, `y`, time bounds, `maps`, and `enemyNPCs`. It has no per-enemy position fields.
- `ReportDungeonPullNPC` has `id`, `gameID`, and minimum/maximum instance and instance-group IDs. These bounds are not explicit membership lists and must not be expanded as if all intermediate instances were confirmed present.
- Gravescythe (report actor 40, game ID 116) spans instance bounds 1–4 in pull 1 and 1–9 in pull 2. This overlap is direct evidence that naive range expansion cannot create unique planner assignments. Events must distinguish actual participation, re-engagement, and gaps.
- `ReportMap` exposes only `id`; no map-coordinate calibration is available in this type.
- The canonical Sin-Magir placement has world x=17150.752, y=18276.22, while the boss pull has x=18107, y=17181. Swapping axes is a plausible hypothesis, **not a validated transform**; the pull location is not necessarily the spawn point.
- API `difficultyLevel` is 75 while the UI shows Eternal 55. Do not copy the raw number into a user-facing key-level label without confirming its encoding.
- Fight elapsed time is 636114 ms; `completionTime` is 631135 ms. These explain the two different displayed durations and must remain separate.
- The report includes game IDs 274, 277, 278, and 264 with no matching entries in the current static enemy catalog. The previously observed UI identifies these as Emissary of the Shadow Lord, Medium Chicken, Large Chicken, and Ruinous Star. Do not turn them into arbitrary static placements.
- `Report.events` supports `fightIDs`, time bounds, `dataType`, `hostilityType`, `includeResources`, `limit`, and `useActorIDs`. The paginator returns `data` and `nextPageTimestamp`. Actual event JSON still needs inspection.

### Planner compatibility

- `data/enemies.json` contains numerical `gameId` values matching the observed report type IDs.
- `data/dungeons.json` contains `placementId`, `packId`, `worldPosition`, `mapPosition`, `mapImageId`, and patrol paths.
- Empyrean Sands contains 60 Sandsworn Husk placements across 32 packs. Matching by name/type/count alone is ambiguous.
- `data/placement-corrections.js` canonicalizes duplicate boss placements. Match against `correctDungeon()`, not raw duplicate entries.
- `map-views.js` already transforms placement world coordinates onto map views. External log coordinates still require unit, axis, origin, and floor validation before reuse.
- `scripts/compact-public-data.mjs` currently removes `gameId` from the published enemy catalog. Retain it when implementing import.
- `.github/workflows/pages.yml` publishes a static GitHub Pages site; `scripts/server.mjs` is a local development server, not a deployed API backend.
- `route-model.js` expects static placement IDs in pulls. An enemy cannot be assigned to multiple pulls. Wipes, resets, and re-engagements therefore require an explicit conversion policy.
- Current route models handle empowered placements and replacement modifiers, but not every dynamic actor appearing in a combat log. Emissaries, summoned enemies, pets, and encounter mechanics must not be counted as ordinary static placements without verification.
- The existing import flow in `app.js` creates a route document through `loadDungeon()` and prevents importing while in a collaboration room. Reuse that flow rather than bypassing its restrictions.

## First authenticated experiment

1. Register a client suitable for the chosen access flow. Keep a client secret out of frontend code, URLs, committed fixtures, and chat. Do not create credentials as part of an unattended investigation.
2. Read the actual Fellowship schema. Verify the fields for report metadata, fight selection, pulls, actors, instance identities, maps, events, and pagination. Request only needed fields.
3. Fetch report `c4nFLaThdAxtVpYv`, fight `5`, including all pages needed for complete results. Treat GraphQL errors, truncation, missing permission, and unavailable data as failures, not empty routes.
4. Compare the API pull count, order, timing, and type counts with the visible three-pull report.
5. Determine whether actors expose original spawn identifiers/positions, first-observed combat positions, or only aggregate pull locations. Distinguish type IDs, report actor IDs, and per-actor instance IDs.
6. Test several stationary enemies plus a patrol and an enemy dragged into a large pull. Fit and validate coordinate conversion using multiple independent anchors and floor information. A good fit at one point is insufficient.
7. Produce a mapping diagnostic for every route-relevant instance: matched placement, evidence, alternatives, or reason unresolved. Check that two distinct instances do not accidentally consume the same placement.
8. Verify modifier effects and killed-versus-engaged counts. Report count differences rather than adjusting assignments to force the planner's completion percentage to match.

Success for the exact-import experiment requires complete source data and unambiguous placement assignments for all route-relevant enemies in this example. Reproducing only three map markers and their labels is not sufficient.

## Proposed import pipeline

`report URL -> source adapter -> normalized run -> placement matching -> preview -> new route document`

### Source adapter

Accept only supported Fellowship Logs hosts and report paths; extract report code and fight ID. Ignore display parameters such as `type=damage-done`. If the URL has no concrete fight, offer the report's available runs rather than assuming fight 1. Keep API authentication separate from reconstruction logic.

Use API-provided dungeon pulls if confirmed. Reconstructing pulls from combat events is a fallback, with explicit uncertainty for continuous combat, chain pulls, wipes, and resets. Do not create a new pull merely because a different static pack joins an existing combat interval.

### Normalized run

Represent report/fight identity, dungeon/build, modifiers, ordered pull intervals, actor instances, position observations, deaths/resets, optional player tracks, and completeness diagnostics. Preserve source identity and timestamps so a failed match can be explained. Field names here are an internal proposal, not a claim about Fellowship's API schema.

### Placement matching

Prefer a verified stable spawn identity if available. Otherwise filter by type and floor, then use the earliest trustworthy positions, static spawn/patrol geometry, and pack composition. Match instances jointly so a greedy nearest-point choice does not steal another instance's only plausible placement.

Combat or death coordinates after a tank drags mobs are weak evidence for original placement. Pull centroids alone cannot resolve repeated packs. Preserve ambiguous candidates for manual correction; never promote a heuristic to an exact match solely because it is the closest.

Separate static route enemies from dynamically generated actors. Represent unsupported modifiers explicitly in the preview. Decide how to flatten wipes/re-engagements into a plan, or extend the route schema if preserving execution history is a product requirement.

### Preview and route creation

Show the selected dungeon/run, ordered pulls, mapped enemies, unresolved instances, ignored dynamic actors with reasons, modifier coverage, and completion checks. Allow resolving ambiguous placements and merging/splitting imported pulls. Keep movement traces optional; connecting pull markers is a schematic and must not be labeled as the actual walked path.

Create a new route only after preview acceptance, preserving the current draft. Record the source URL and conversion notes through supported route fields; if structured import metadata is added, update validation, persistence, CRDT schema, and transfer serialization together.

## Approach radius

Live matching uses a fixed ordinary player/chain approach radius of 1500 world units. Failure does not automatically widen it. Buried contact stays at 100 and targeted attack range at 6000. Position-bearing aura and channel events are retained to improve movement coverage.

If ordinary evidence produces no complete route, a second pass at the same radius can consider straight-line movement across gaps longer than 2 seconds and no longer than 15 seconds. Only the portion before the target's first engagement counts. Endpoints must be alive, speed must not exceed the provisional 3000 units/second bound, and the gap must not cross death, map change, portal events or player invisibility. NPCs must already be engaged at the first endpoint. Buried activation cannot use this hypothesis. Spawn identities, empowered constraints and pack counts remain enforced.

These lines are possible paths, not observed movement. A resulting route is labeled as a movement hypothesis and requires review, including when only one variant remains. Observed approaches rank ahead of estimated ones; choices using gap evidence display “Estimated across log gap”. Successful ordinary matches are returned without introducing additional gap-based variants. The 15-second and speed limits are provisional safeguards, not measured game mechanics.

**Find missing mobs** explicitly enables `adaptiveRadius: true` alongside the existing search within 6000 units of independently confirmed earlier packs. It retries approach radii in increments of 100, stopping at the first complete match, with a ceiling of 3000. Normal import remains fixed at 1500. Results and diagnostics record attempted radii; the route note states when recovery increased the radius. If complete matching still fails, partial recovery uses the final attempted radius and continues to list omitted observations. Offline diagnostics can also opt in. These are reconstruction tolerances, not measured game aggro ranges. Incomplete logs, impossible instance counts, cancellation and solver limits do not trigger radius retries.

## Authentication options

| Option | User experience | Required infrastructure |
|---|---|---|
| PKCE | Sign in to Fellowship Logs and authorize the importer | Registered public client, callback, token lifecycle; verify CORS behavior in the actual deployed site |
| Server with client credentials | Paste a public report URL without each user signing in | Small backend holding the secret, bounded report requests, caching and rate-limit handling |

PKCE fits the current static deployment. A backend fits a URL-only public-report experience. Neither option guarantees exact matching; authentication only allows the necessary data experiment.

## Implementation order after the experiment

1. Add a source adapter and sanitized real-response fixture; preserve `gameId` in public data.
2. Implement normalization and matching diagnostics independently of the editor.
3. Test against the example's actual pulls and manually verified placement assignments, then cover patrols, dragged mobs, modifiers, resets, incomplete data, and ambiguous repeated packs.
4. Add import preview and route creation through the existing document/import path.
5. Verify deployed authentication and round-trip persistence/export, and show unresolved items rather than claiming full fidelity.

The event payload is now available. Remaining work is validated matching, robust source normalization and action recognition, followed by production preview/authentication integration.

## Local PKCE research probe

Run `node scripts/log-import-probe-server.mjs` and open `http://localhost:4173/`. Stop any planner development server using the same port first. The registered redirect must be exactly `http://localhost:4173/`.

The server only serves three static files; it does not exchange tokens or proxy API requests. `log-import/oauth.js` generates S256 PKCE and a random state, validates a ten-minute single-use callback, and exchanges the code in the browser. Only the verifier/state transaction is held in session storage; the access token stays in page memory. Callback parameters are removed from the address before the token request. Refreshing requires connecting again.

Select a research example or paste a report URL, sign in through the existing client, then click **Inspect report + events**. Probe v3 introspects Fellowship's actual types (including descriptions and enums), derives a metadata query, and reads actor/ability metadata plus all available event pages for the selected fight with `includeResources: true`. Both `?fight=6` and `#fight=12` links work. It uses the `All` hostility enum if supported, otherwise separate friendly/enemy streams. Separate streams remain labeled and are not assumed disjoint. A 100-page limit per stream, malformed cursor, cancellation, or failed request leaves the result explicitly incomplete. Raw pages are preserved without deduplicating distinct same-timestamp events. The preview shows event-type summaries; the JSON download retains the raw pages and excludes OAuth tokens. This still does not establish that events provide a complete movement track or create a route.

The OAuth and pagination tests cover the RFC 7636 challenge vector, callback binding/replay, expiry/state/cancellation rejection, secret-free token exchange, sanitized token errors, complete pagination, and explicit partial results on failure/cancellation. The supplied v2 export verifies the event fetch. The actor-retention and referenced-ability metadata fixes still need a new live export to verify their results. Probe files are not added to the production site build; local diagnostic JSON exports are ignored by Git.
