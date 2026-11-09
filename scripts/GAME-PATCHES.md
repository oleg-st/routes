# Updating game client data

## Current state: 0.5.0.0, build 26122410

All data has been extracted from the updated client. There are 11 maps, 20 source layers, 1768 placements and 704 computed packs. TreeVillage / Crown of the Wild has one layer, T_TreeVillage_Global. Six multi-layer maps use Combined, including seasonal Pinnacle Xul with three layers. Sources and reports stay in private/ and are not published.

Eternal 1–32 and modifier assignments come from the new tables. Xul Normal / Hard / Nightmare use matchmaking values 30 / 35 / 41, corresponding to E10 / E15 / E21 on the shared HP curve, without Eternal affixes. AbilityUnlock thresholds do not determine available Pinnacle difficulties. The sparse HP curve is expanded using its linear interpolation; the native index and formulas have been rechecked. Casual and gear scaling are not yet implemented. Do not carry numeric difficulties from old logs into the new build.

Positions and patrols have been regenerated from the persistent level and all recursively linked AlwaysLoaded levels, including Environment, preserving the Spear Centurion in Crown. Stripped patrol columns are reconstructed from Followers/PositionIndices. A pack is the result of our geometric model, not an explicit game group ID. Native bounds/calibration are also available for new maps without Full; map-area-selection.json stores separately reviewed display rules for overlapping areas, not a claim about the game's floor selection.

Wraithtide has two Witches: the starting Witch has no replaceable actors according to the native capsule/cylinder, while the upper Witch removes six. Each spawner has its own placementId; selection, score, CRDT and compact import support both. The presence of a Ghorn spawner does not imply that the modifier is available at the current difficulty.

Routes from another or unknown build are rejected before decoding indices. IndexedDB is partitioned by buildId; previous saves are neither read nor automatically deleted. Old pack history, aliases and Combined migrations have been removed. After registering game coordinates against our textures, one Vexira portrait anchor remains: her native spawn is north of the arena in a cropped part of the layer. See `docs/map-coordinate-audit.md`.

## Dependency inventory

Regeneration replaces the entire output with a fresh export. Review means understanding the change, not merely updating a hash. This inventory lists project areas; it does not prove complete coverage of every game mechanic.

| Area | New client source | Processing and output | What to replace, remove or review |
| --- | --- | --- | --- |
| Client extraction | Steam build, containers, EXE, asset inventory | `private/game-data/static-mappings.mjs`, `extractor/`, `run-all-dungeons.mjs`, `run-planner-export.mjs` → `native-*.json`, `provider-files.txt`, `all-dungeons/`, `planner/` | Full export without cache; archive old raw directories. If package format/location changes, update the extractor and reference traversal rules in `export-planner-data.mjs`. |
| Map inventory and metadata | `DT_LevelInfo`, `LI_*`/`CRLevelInfo`, localization | `discover-dungeons.mjs` → registry; `scripts/prepare-game-catalogs.mjs` → `data/dungeons.json`, `manifest.json` | Regenerate enabled Dungeon/Adventure entries, names, required score and timer. Do not carry removed maps over from the old catalog. |
| NPCs and abilities | NPC Blueprint/defaults, CharacterTags, GUID CSV, ability tables, localization | `prepare-game-catalogs.mjs` → `enemies.json`, `abilities.json`, `heroes.json`, `game-modifier-stats.js` | Regenerate records and game IDs. Check Boss tag exceptions, hero roles and `data/ability-corrections.js`; new ability classes may require extending traversal. |
| Enemy positions and group composition | Selected level actors, GUID, world XYZ, behavior/social aggro, patrols, navmesh | `build-game-planner-overlay.mjs` → temporary overlay; `prepare-game-data.mjs` → `game-dungeons.js`, `custom-dungeons.js`, `dungeons.json` | Regenerate positions, floors, patrols and groups. Review `game-height-filter.mjs`, `game-patrol-*.mjs`, `geometric-pack-model.mjs`: this is our model, not predefined game packs. |
| Map layers and coordinates | `BP_DungeonMapAreaBox_C`, bounds/scale, `DungeonAreaTexture` | `prepare-game-catalogs.mjs` → `game-map-frames.json`, `dungeons.json.mapImages` | Replace bounds and projection from the client. Attached/rotated areas currently require transform improvements; overlapping areas require floor-selection review. |
| Textures, portraits, icons | `planner/textures-manifest.json`, `images.json`, decoded images | `prepare-game-catalogs.mjs` → `game-image-sources.json` and image jobs; `prepare-game-images.mjs` → AVIF | Regenerate images and hashes. `patch:build` removes unused AVIFs after determining the complete set of used images and archives originals. |
| Layer composition | New textures + authored recipe | `scripts/combined-maps/*.mjs`, `index.mjs`, `prepare-combined-maps.mjs` → `data/combined-layouts.js`, `images/dungeons/combined/` | Create/review a recipe for multiple layers; single layers do not need one. Unregister recipes for removed maps and former multi-layer maps that now have one layer. |
| Manual calibration and styling | Authored transforms, outlines, crops, background, frame, repairs | `data/full-maps.js`, `marker-anchors.js`, `combined-maps/`, `private/images-combined/patches/` | Old coordinates, anchors and artwork patches are not new game data. Review or remove them; changing `fullMapBuildId` without review is insufficient. New independent maps do not need Methods calibration. |
| HP and scaling | `CT_CharacterBaseAttributes`, `CT_CharacterScalingBaseAttributes`, gameplay effects, native code | `game-catalog-source.mjs`, `game-scoring-source.mjs`, `prepare-game-services.mjs` → `enemies.json`, `game-service-rules.js`; runtime `game-scoring.js`, `route-model.js` | Update values and verify difficulty index, curve interpolation/shape, rounding and modifier order. A new table does not itself change how JS interprets the formula. |
| Difficulties and modifier assignments | `DT_DifficultyToLevel`, `DT_GameFinderLeagues`, `DT_ModifersInDungeons`, unlock curves | `export-game-difficulty.mjs`, `prepare-difficulty-data.mjs` → `game-difficulty.js`, `scripts/difficulty-source.json` | Regenerate available options. Build 26122410 publishes Eternal 1–32 according to rotation. Casual Easy/Medium/Hard are not yet offered: personal gear scaling is not modeled. |
| Score, orbs, Empowered, Stone Skin, Ultimatum, Polymorph | Effects, spawner Blueprint, `DefaultGame.ini`, native targets | `game-scoring-source.mjs`, `prepare-difficulty-data.mjs`, `game-service-semantics.json` → `game-service-rules.js`, `game-difficulty.js` | Check multipliers/limits/targets. The old Polymorph override was removed: the new export sets bounds of 2 and 3.5. |
| Entrances, campfires, enemy replacement by minibosses | PlayerStart, respawn actors, modifier spawners, hit capsules | `prepare-game-services.mjs` → `map-starts.js`, `map-campfires.js`, `modifier-placements.json`, `game-modifier-positions.js` | Regenerate positions and replaced groups. Review `game-service-model.mjs` and `game-service-semantics.json`, especially multiple spawners of the same type and floor selection. |
| Summons and special encounters | Spawn bytecode, AI, ability constants, Brogg retreat proof | `prepare-game-summons.mjs`, `game-summon-semantics.json`, `build-game-planner-overlay.mjs` → `game-summon-rules.js`, phase markers | Review old rules and discover new summons/phases. Revisit `data/boss-encounters.js` and `log-import/boss-encounters.js`; the old list does not automatically cover new mechanics. |
| Log import | New game IDs, coordinates, difficulties and real logs | `log-import/`, `map-views.js`, runtime catalogs | Check NPC/ability matching, world → layer → combined, summons/relics/transitions. Eternal offset remains 20; old league names for values 1–20 were removed because new Casual buckets cannot be distinguished by raw level alone. |
| Historical IDs and routes | Previous placement IDs, aliases and indices | `scripts/game-source-registry.json`, `data/route-mapping.js`, `route-dictionary.js`, `placement-corrections.js`, `route-build.js` | JSON/compact/CRDT require the current buildId. The dictionary resets between builds and grows within a build. Old aliases, pack history and Combined migrations are removed; the GUID registry remains the authored identity source. |
| Built site and cache | Regenerated data/images + runtime | `build-local.mjs` → `local.html`; `build-site.mjs`, `compact-public-data.mjs`, `build-site-assets.mjs` → `dist/` | The site build recreates `dist/` from an allowlist and hashes URLs. Coordinate schema changes must also survive compaction; check for private paths. |


## Update workflow

Before the patch: npm run patch:baseline, then npm run patch:plan -- --python="C:/path/to/python.exe". The snapshot contains raw hashes, published data, images, rules, the registry and tools; baseline.json identifies the selected baseline. Containers and the old EXE are not copied.

After updating: npm run patch:extract, then npm run patch:report. Extraction starts in empty all-dungeons/ and planner/ directories; old data is archived in raw-before/. On a normal error it is restored, and the failed export is kept for diagnosis. After a forced interruption, inspect run.json and raw-before/ first.

The report compares GUID/XYZ, NPCs, abilities, tables, level selection, patrols, behavior, navmesh, the native EXE and textures. Texture checks compare metadata, raw pixels and decoded hashes. The new snapshot also stores every NPC Blueprint variant (characterId may be shared) and 3235 summon-audit hashes, checked against the catalog. The old baseline lacks these fields: comparisons are explicitly marked unavailable instead of treating everything as new. Export indices may change without content changes: compare textures by stable object name. A nonzero report exit code means incomplete sources or guards requiring review.

After reviewing changes: npm run patch:build. Generation, image cleanup, the local.html build and tests run in a transaction that rolls back published files on failure. Do not change reviewed hashes without inspection. New summon mechanics require a separate search: the 15 known rules alone do not prove there are no new summons.

patch:extract searches for spawn calls through NPC and ability dependencies; npm run patch:audit:summons runs this separately. The private/reports/summon-discovery.json report contains Blueprint hashes and candidates for manual review. For build 26122410, 3235 Blueprints were checked, 436 packages with spawn calls were found, and there were no export errors. These include projectiles, effects and inactive abilities; a call alone does not imply an NPC summon. Native code and missing dynamic references require separate analysis.

A rule was added for Ship Rats summoned through Bilgerat's channel, checking ability, time, position and a living parent; ambiguous matches are rejected. Eggbearer summons exactly two eggs. Blood Caster's crystal creation ability is disabled in its AI assignment and was not added as an active rule. No new NPC summons were found among reviewed spawn calls for new TreeVillage/SpiritJungle NPCs; this does not replace checking real combat logs.

Geometry recheck: the two Lost Souls in Silken remain separate packs because their independent patrols diverge beyond the social radius; merging requires in-game confirmation. The underground Icewyrm in Cithrel remains excluded by height/navmesh. Brogg is represented by two phase markers for one actor. Xul's textures and native calibrations were rechecked against the recipe; the End area was expanded to its native boundary to cover the lower part of the entrance.

## Cleanup and validation

- Catalogs and geometry are fully regenerated; availability is determined by difficulty tables, AvailableForCasual and enabled IsSeasonalPinnacleDungeon.
- prune-game-images.mjs preserves used images and catalog portraits, archiving extras in private/assets/unused/ before removal. The dist build uses an allowlist.
- Old recipes may remain as authored sources outside the active rotation. Unused runtime Full/placements/patrol overrides have been removed; calibrations and textures are checked separately.
- Before committing: npm test, npm run check, npm run build:site, npm run test:storage:browser, npm run test:site:browser. For miniboss changes, check both targets in the UI, JSON/compact and CRDT.
- For a new multi-layer map, check every layer, world-only log coordinates, empty layers and patrol transitions. Visually review seams, frame, background and area selection: tests alone are insufficient.

## Visually composing a multi-layer map

```powershell
npm run maps:editor
```

Open `http://127.0.0.1:4180`. The editor reads textures and areas from the fresh export, so new maps are available before rebuilding public data. Wyrmheart is selected by default for testing against an existing map. If the client has already been updated, old enemy markers are hidden.

1. Select a map and layer. Drag the layer and set X/Y and scale. The mouse wheel zooms the view; dragging empty space pans it. "Fit all" brings every layer into view.
2. Reduce opacity to align shared landmarks. "Lower"/"Raise" change layer order.
3. Click "Draw new outline" and mark the desired terrain boundary. Click again to finish; at least three points are required. "Entire layer" restores the rectangle.
   To reveal a lower map at an overlap, select the upper layer, enable "Cut rectangle" and drag over the area to remove, including any obstructing frame. For complex shapes, use "Cut polygon" and "Finish cutout". Multiple cutouts are supported and saved with the layer. Esc exits the tool; "Remove last cutout" removes the last area; undo and redo also work.
4. Save the draft. JSON and MJS files appear in `private/combined-map-drafts/`. Browser autosave is also scoped to the client build. "Download recipe" exports a module for the shared build process.

Preview build of an exported recipe:

```powershell
npm run maps -- --recipe=private/combined-map-drafts/IceCave.mjs --preview
```

The output is an SVG and coordinate JSON in `private/combined-previews/`; current maps and `data/combined-layouts.js` are unchanged. This uses the same renderer as the production planner. For a new map, it reads the fresh client catalog.

After reviewing textures and enemy placement, move the MJS file to `scripts/combined-maps/`, register it in `index.mjs` and rebuild the maps. When replacing an existing recipe, update the coordinate version if the coordinate system for saved drawings changes. Editor recipes do not depend on Methods. The first version supports translation, uniform scaling and polygon cropping; rotation, warping and complex retouching remain manual features of the main recipe format.

Tool validation: `npm run test:maps:editor`. The test exercises Wyrmheart dragging, scaling, outlines, undo/redo, save/load, export and preview builds, verifying that the published layout is unchanged.
