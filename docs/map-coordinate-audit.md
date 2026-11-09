# Map registration audit — October 30, 2026

Reviewed 11 active maps, 20 game layers, 1768 placements and 22186 patrol points. Sources: extracted `worldPosition`, `gameFrame`, original game textures and our recipes in `scripts/combined-maps/`. No third-party enemy positions are used.

Normalized game coordinates for all placements matched the world XYZ projection. Discrepancies were between the old combined-map projection and the `artworkTransform` actually used to draw the texture.

| Map | Result |
| --- | --- |
| Wraithtide Vault | Checked Lower, Upper, Jungle, Ship interior and the separately cropped deck. The four layers' projections now align with their textures; the deck displacement is preserved. |
| Empyrean Sands | Start already matched. Corrected a small offset and scale difference in End; the previous Sinnari portrait anchor is no longer needed. |
| Ruins of Regath | Corrected a small difference in both layers; the underground chamber uses full game calibration. |
| Stormwatch | Both layers align with their textures. |
| Xul, The Blood Monolith | All three layers align with their textures. |
| Silken Hollow | Forest and lair use game calibrations and our transforms. The Vexira portrait exception is described below. |
| Godfall Quarry, Cithrel’s Fall, Scryer’s Peak, Crown of the Wild, Urrak Markets | Single-layer maps: no comparable mismatch found; registration unchanged. |

At a total canvas width of 1500 px, the previous difference in Sands End was typically about 8 px, with a maximum of 14 px; the Sinnari portrait differed by about 2 px. Typical differences in Regath, Stormwatch and Xul were a few pixels. These are substantially smaller than the original Marrow error of about 37 px at the same scale.

Vexira: the game spawn projects north of the arena on the source texture, into an area cropped out of the combined map. The existing portrait anchor inside the arena, near the skull on our texture, is retained. It applies only to the portrait on the combined map; world/log coordinates now use the exact game projection. This is a display exception, not a correction to the game actor's position.

The combined map now preserves the layer selected by the export: the previous additional check against old floor bounds no longer redirects already assigned game positions to another texture. The canvas, background and drawing coordinates saved directly on the combined map are unchanged. Drawings on source layers project through the corrected registration.

## Reproduction

```powershell
node scripts/register-map-coordinates.mjs
npm run maps
npm run build:local
npm run check
node --test tests/native-map-registration.test.mjs tests/wraithtide-projection.test.mjs tests/map-views.test.mjs tests/marker-layout.test.mjs
```

`verify-data.mjs` checks registration during regular builds. Regression tests compare game positions, patrols, modifier spawners, log points and annotation projections against the textures actually used. Expected coordinates for Wraithtide's deck are calculated independently from the recipe's mask and crop.

All 11 maps were also opened in a browser and visually reviewed; screenshots from this audit are in the local `tmp/map-audit/` directory.
