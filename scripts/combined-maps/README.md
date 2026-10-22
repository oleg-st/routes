# Combined map recipes

These recipes generate the UI's **Full map** (formerly Combined). The Method comparison view is now **Referenced** and loads local JPGs from `private/images-referenced/`. Internal `Combined` IDs and the `referenceFrame: "Full"` recipe option retain their original names for compatibility; references to Full coordinates below mean the Referenced calibration.

Each module is the complete stitching recipe for one dungeon. The shared renderer is `../prepare-combined-maps.mjs`; its image inputs are textures from our installed-game export, resolved through `data/game-image-sources.json`. A recipe may opt into Full map coordinate metadata; no Method background image is read.

For visual authoring, run `npm run maps:editor` and open `http://127.0.0.1:4180`. It loads fresh exported map layers before a public rebuild, supports moving/scaling, tracing contours, undo/redo and exporting an independent recipe. Save drafts under `private/combined-map-drafts/`, then run `npm run maps -- --recipe=private/combined-map-drafts/IceCave.mjs --preview` to generate a private SVG without changing published maps. See [the patch workflow](../GAME-PATCHES.md) for review and registration steps.

## Первая версия полноценного редактора — разбор рецептов, 2026-10-21

Это требования к следующей версии, а не описание уже готового UI. Текущий редактор умеет только перенос, масштаб, порядок слоёв, контур и жёсткие вырезы. Его `model.mjs::draftRecipe` и сохранение в `map-editor-server.mjs` отбрасывают большинство возможностей рабочего формата. Существующий сложный рецепт пока нельзя безопасно открыть и сохранить через этот упрощённый формат.

### Что показали существующие карты

- **Wyrmheart (`wyrmheart.mjs`)**: два слоя, отдельные контуры игровой области и окружения, вырезы и разная мягкость переходов. `seamFeather: 2`, `contextSeamFeather: 9/14`, `context.feather: 15` показывают, что дороге и окружающему лесу нужны разные края. Дополнительно используются локальная заливка `textureFills`, перенесённый фрагмент гор `decorations`, фон из образца `backgroundTexture` и общая рамка `frame`.
- **Drakheim (`drakheim.mjs`)**: три слоя с фактическими масштабами изображения около 4.00, 3.79 и 3.08; порядок переднего плана `[0,2,1]`; у церковного слоя три выреза. Есть отдельный `terrainOutline`, общий фон и рамка. Остаток двойной стены/снежного шва исправлен внешней растровой заплаткой `canvasRepairs` — одно размытие маски не исправляет противоречащий рисунок.
- **Regath (`regath.mjs`)**: два слоя с фактическими масштабами около 7.52 и 4.29. Это полезный контроль совмещения фрагментов с заметно разным масштабом.

У этих рецептов `referenceFrame: 'Full'`: поля `at/scale/join` не определяют итоговое изображение. Для разбора брать `artworkTransform`, а для координат — отдельную калибровку/`coordinateTransform`. Нельзя импортировать только `scale` и ожидать воспроизведения готовой карты.

### Пять рабочих инструментов

| Задача | Управление в редакторе | Возможности формата и необходимое дополнение |
| --- | --- | --- |
| 1. Совместить 2+ карты | Перетаскивание, масштаб за углы с сохранением пропорций, точный ввод, порядок слоёв, скрытие/блокировка слоя, прозрачность только выбранного слоя. Две пары общих ориентиров для подгонки масштаба и смещения без вращения; показывать остаточную ошибку. | `at`, `scale`, `join`, `offset`; для сложных существующих рецептов отдельно сохранить `artworkTransform` и координатную привязку. Изменение декора не должно незаметно двигать мобов. |
| 2. Убрать перекрывающиеся куски | Прямоугольное и полигональное выделение; редактирование вершин существующего контура; список вырезов с выбором/удалением; восстановление скрытого участка. Маска сохраняется отдельно от исходной картинки. | `outline`, `terrainOutline`, `exclude`, `context.outline`, `context.exclude`. Дать простой выбор «карта», «окружение», «оба»; не заставлять пользователя разбираться в SVG. |
| 3. Обработать стык | Мягкость края отдельно для игровой части и окружения; управляемый размер перехода. «Заплатка из карты»: выбрать чистый фрагмент, положить на шов, изменить размер и смягчить края; можно вернуть под стык часть нижнего слоя. Просмотр без выделений и сравнение до/после. | `seamFeather`, `contextSeamFeather`, `context.feather`, `restore`, `overlays`/`decorations`. В v1 мягкость вырезов общая для слоя; отдельная мягкость каждого выреза потребует расширения формата. Внешние `canvasRepairs` сохранять при загрузке, не заменять автоматически размитием. |
| 4. Сделать общую рамку | Задать границы итогового холста и отступ от карты; включить/выключить рамку; выбрать слой-источник орнамента; настроить толщину полос, размер углов и мягкость. Старые рамки исходных слоёв убирать масками. | `frame.corner`, `frame.edge`, `frame.featherCorners` уже есть. Сейчас рендерер всегда берёт рамку из `source-0` и рисует её; выбор источника, отключение и управляемые размеры/отступы холста нужно добавить. Числа углов/полос не должны скрывать игровые области. |
| 5. Заполнить пустоты | Общая подложка из выбранного образца бумаги/снега/воды; масштаб, прозрачность и размытие образца. Локальное полигональное заполнение пустоты образцом с мягкими краями; показывать повторяющийся узор при увеличении. | `backgroundTexture` для всего холста, `textureFills` для локальных областей, `decorations` для крупных фрагментов ландшафта. Заливки лежат под картами и не меняют игровые координаты. |

Поворот и деформация не требуются для перечисленных операций v1: в нынешнем редакторе и независимом координатном формате их нет. Если на новой карте без них не совпадут ориентиры, это отдельная доработка проекции и экспорта, а не только добавление ручки вращения в UI.

### Как проверить результат на существующем рецепте

1. Сначала дать редактору загрузку рабочего рецепта Wyrmheart и точный просмотр текущего результата. Загрузка/сохранение без действий должна сохранять смысл всех полей, масок, фона, рамки, названия и заплаток. Неизвестные/пока не редактируемые поля сохраняются и обозначаются в интерфейсе; упрощённый экспорт не должен их терять.
2. Для основного просмотра использовать тот же рендерер, что при сборке. Быстрые манипуляторы могут быть отдельным наложением; фон, маски и рамка должны совпадать с экспортом. Сейчас упрощённый SVG редактора этого не гарантирует.
3. На копии Wyrmheart воспроизвести масштаб/совмещение, вырез, мягкий стык, заплатку, локальную заливку и общую рамку. На Drakheim проверить три слоя, смену порядка и несколько вырезов; отдельно сохранить существующую внешнюю repair-заплатку.
4. Все пять инструментов проходят undo/redo, сохранение/повторную загрузку и экспорт/пробную сборку. Проверить, что декор и обработка швов не меняют положения мобов и патрулей.
5. На новой независимой карте проверить отсутствие обязательной Full-калибровки, работу с двумя/тремя слоями разных масштабов и заполнение пустого участка. Для однослойной карты объединение пропускается; оформление фона/рамки может использоваться отдельно.

Порядок реализации: без потерь открыть существующий рецепт → общий точный просмотр → удобное совмещение/маски → швы и заплатки → общий холст/рамка → общий и локальный фон. Это позволяет проверять каждый инструмент на уже принятой карте, не ожидая патча.

| Recipe | Dungeon |
| --- | --- |
| `empyrean-sands.mjs` | Empyrean Sands |
| `tuzari.mjs` | The Heart of Tuzari |
| `wyrmheart.mjs` | Wyrmheart |
| `regath.mjs` | Ruins of Regath |
| `stormwatch.mjs` | Stormwatch |
| `wraithtide.mjs` | Wraithtide Vault |
| `xul.mjs` | Xul, The Blood Monolith |
| `silken-hollow.mjs` | Silken Hollow |
| `drakheim.mjs` | Ransack of Drakheim |

From the project root:

```sh
npm run maps -- empyrean-sands --guides
npm run check
npm test
```

This rebuilds only Sands and its entry in `data/combined-layouts.js`. Other private SVGs, public AVIFs and entries remain intact. Omit the name to build all nine. `--guides` also writes `tmp/combined-guides/<name>.svg`, with colored source contours, layer names and crosses at each independent incoming join. Generated SVGs and raster intermediates live in `private/images-combined/`; only AVIFs go to `images/dungeons/combined/`. Raster resolution follows native source density without enlarging any source layer; logical route coordinates remain unchanged. Open the standalone SVG in a browser; the guides are never added to the application map. Unknown names/options fail before files are written. If the dataset build changed, rebuild all maps first.

All source coordinates use a **1024 × 512 reference frame**, regardless of the original image resolution. Independent logical canvases use twice that scale; reference mode uses Full map’s dimensions and source calibration. Raster pixel dimensions are computed separately from the original image sizes and their artwork transforms.

- `referenceFrame: "Full"`: use the dungeon’s Full dimensions, source calibration, marker overrides and patrols. Ignores layer `at`, `scale`, `join` and `offset`; image inputs are textures from the installed-game export. The generated reference hash is checked for staleness.
- `artworkTransform: {scale,x,y}`: optional registration of original artwork into Full canvas pixels, separate from marker/source-drawing calibration. `scale` is output pixels per source-reference pixel. Sands fits five `landmarks` (temple, lake, gate, canyon and south edge); these are matched image features, not enemy coordinates. Landmark residuals are verified by tests. The build still embeds only original artwork.
- `coordinateTransform: {scale,x,y}`: explicit source-drawing transform only for layers without enough encounters to fit world calibration. Regath's chamber is anchored to its single encounter; Silken Hollow's empty lair follows its registered artwork. Known world positions and encounter overrides still use Full coordinates.
- `seamFeather` and `contextSeamFeather`: separate blend widths for playable terrain and surrounding background; this keeps cliff linework sharp while blending parchment.
- `artWarp`: optional per-layer artwork mesh with increasing `xs`/`ys` source coordinates and an `offsets[row][column]` XY displacement for each vertex. Triangles interpolate the artwork locally, without changing marker, patrol or drawing coordinates.
- `layers`: source fragments, in painting order; `suffix` identifies the original image.
- `at: [x,y]`: position of the first layer in the working reference frame.
- `scale`: uniform source scale.
- `join: [previousLayer, ax, ay, bx, by]`: align point `(bx,by)` on this source with `(ax,ay)` on the earlier source. Indices refer to recipe order, starting at zero.
- `offset: [dx,dy]`: intentional displacement in the working frame; `transition: true` draws a dotted link between displaced anchors.
- `outline`: source terrain polygon used for canvas bounds. Every enemy/patrol point is also included automatically. `terrainOutline` can refine the visible cut without changing canvas bounds.
- `exclude`: polygons cut from both foreground and context, for a deliberate seam between overlapping sources.
- `labels`: source-anchored text labels (`source`, `at`, `text`, `size`), without a copied rectangular paper patch.
- `version`: Combined view version, incremented when the coordinate frame changes.
- `placementAdjustments`: independent manual group calibration (`groupId`, `source`, `anchor`, `target`, XY `scale`, optional `slope`). Members retain their ordering; same-layer patrols move at the near end and taper to their original far endpoint. These are visual calibrations, not verified current-game coordinates.
- `context.expand` and `context.feather`: surrounding landscape mask stroke width and blur radius. Context is painted under **all** playable fragments.
- `context.edgeFade`: optional normalized X/Y stop arrays `[transparentStart, opaqueStart, opaqueEnd, transparentEnd]` to preserve more original landscape near image borders.
- `context.outline`: optional separate landscape polygon. `context.exclude`: optional polygons hiding unwanted background fragments, such as duplicated floors or titles. These never erase foreground terrain.
- `context.excludeFeather` / `context.excludeExpand`: exclusion mask blur and outward padding in source pixels. Padding keeps removed lettering and ornaments hidden while a wider feather softens the surrounding paper transition.
- `restore`: source rectangles `[x,y,width,height]` copied over the finished terrain at their original positions, useful when a later fragment cuts off a label. Keep these away from other layers' playable geometry.
- `decorations`: individual artwork crops with `source` index, `crop: [x,y,w,h]`, canvas `at` and `size`, `feather`, and optional `shape: 'ellipse'`. These paint below playable terrain.
- `decorations[].underContext`: paint decorative artwork beneath source landscapes. `soften` optionally blurs that fill without blurring the foreground. `overlays` uses the same crop fields but paints above terrain; Wraithtide uses this for its separately displayed deck and original compass. `maskPolygon` gives a normalized crop contour instead of a rectangular fade. `wideFeather: true` expands the SVG filter bounds for wide feathering on small crops, preventing a rectangular cutoff of the blur.
- `captionInset`: right margin of the text title in output pixels. `caption: false` suppresses it when using original title artwork.
- `titleArtwork`: source crop placed over the finished background, using the same fields as `decorations`. `ink: true` removes the light paper via an SVG luminance-to-alpha filter, retaining the original lettering and glyphs.
- `inkThreshold`: optional luminance-to-alpha intercept (default 5.7). Lower values remove darker source scenery but can also erase fine letter strokes; check the complete lettering after changing this. `ink: 'contrast'` separates fine lettering/ornaments from their locally estimated paper colour; Wraithtide uses this to avoid a rectangular sea-paper patch around its original nautical title.
- `textureFills`: native texture crops mirrored within an explicit canvas `outline`, below every landscape and foreground layer. Fields: `source`, `crop`, `scale`, `outline`, `feather`, optional `irregularity` (displacement amplitude). Wraithtide uses a clean sea crop with displacement and a small blur to avoid a repeated tile grid; the effect never touches terrain or markers.
- `backgroundTexture`: original parchment crop (`source`, `crop`, `scale`), mirrored into a seamless background with overlapping tile edges.
- `backgroundTexture.soften`: optional blur radius for a subdued native-paper wash over the procedural paper base, avoiding conspicuous repeats when only a small clean sample is available.
- `frame.corner` / `frame.edge`: output sizes of the original nine-slice border. Sands uses matching 5× scaling for corners and edges. `frame.featherCorners` uses the complete 64px original corner, mirrored four ways with a feathered inner mask and continuous border strips, avoiding square paper patches or cropped flourishes.

Sands uses the reviewed Full coordinate frame with freshly extracted enemy positions and patrols. Its complete End image is registered using five visual landmarks, independently of the world-coordinate calibration. The earlier local gate deformation is removed; an explicit seam retains the Start cliffs. Gate masks and the original sun insignia are explicit parts of its recipe. The added Feidalan Gate text label is omitted to match Full. The reference positions are visual planner positions, not a claim of independently measured game accuracy.

Background changes can safely adjust context, decorations and restores. Changing `at`, `join`, `offset`, `scale`, or an outline that determines canvas bounds changes the coordinate frame: update the Combined view version and migrate existing Combined drawings before releasing such a change. Original-layer annotations and mobs use the generated source transforms. Verify both geometry and appearance; passing tests alone does not prove a seamless illustration or correct in-game transitions.

The current selection builds six Combined maps, including seasonal Pinnacle Xul. Previous-build drawing migration and combined-legacy-layouts.js have been removed: route imports require the current build ID. Full and Combined annotations remain independent.

## Full-source map checklist

All nine maps that previously used Method Full backgrounds now have locally composed equivalents. Full is retained for comparison. Registration uses measured image landmarks; only coordinates are retained from the reference, never its pixels. Enemy positions and patrols exactly match Full. Original source-layer images remain unchanged.

| Dungeon | Combined | Composition work |
| --- | --- | --- |
| Empyrean Sands | v4 | Accepted gate/lake alignment, cliff seams, native sand transitions, sun, compass, title and frame; unchanged in this batch |
| The Heart of Tuzari | v3 | Four independently registered floors, overlapping stair landings, floor exclusions, native title and forest surroundings |
| Wyrmheart | v3 | Registered upper/lower snow corridor, mountain and forest surroundings, original labels, native title and frame |
| Ruins of Regath | v3 | Registered main garden and separate chamber, single-encounter coordinate anchor, complete labels and relocated original title |
| Stormwatch | v3 | Matched forest junction, landscape contours around insignia, soft woodland edges and original title |
| Wraithtide Vault | v3 | Four source layers, separate deck/interior display, coastline exclusions, sea fill, restored compass and nautical title ornament |
| Xul, The Blood Monolith | v3 | Three registered levels, corridor joins, desert-to-stone background transition, original crest and title |
| Silken Hollow | v3 | Registered forest and lair, woodland contours, preserved compass, title extracted without neighboring foliage |
| Ransack of Drakheim | v3 | Three registered village sections, overlapping church/river seams, native snowy coast and original title |

Validation: all mapped encounters, patrols and modifier groups project into Full's coordinate frame; original artwork is embedded once per source; measured landmark residuals stay under 10 canvas pixels (Sands End under 3). Migration tests cover v1, previous v2 layouts and Sands v3. Browser review covers every map with and without enemy markers. The handmade border of each source artwork can differ from Full outside the playable areas.

## Seam and background review — 2026-10-15

Compared every non-Sands composition directly with Full, then reviewed enlarged Combined renders. The recipes retain all original artwork registrations, marker/source transforms, placement overrides and patrol paths. Sands SVG hash is unchanged; Artistic Sands is unchanged.

| Map | Refinement |
| --- | --- |
| Tuzari | Narrower stair/floor cuts, original landing caps, less forest masking, complete native title |
| Wyrmheart | Opened mountain/snow surroundings, tighter crest/title exclusions, mountain artwork with soft crop edges |
| Regath | Chamber cut follows its overlap with the main garden; preserved the main native background |
| Stormwatch | Removed broad fog band at the forest junction and the rectangular label restore; traced outer forest contours |
| Wraithtide | Opened island surroundings, removed duplicate north-room fragment, continuous native sea texture and softly masked compass |
| Xul | Tighter caption/crest cuts, preserved more stone and desert around the three levels |
| Silken Hollow | Removed broad title exclusion from the forest, preserved native title position, restored upper forest, cave-edge cut |
| Drakheim | Custom village/forest contours, narrower church/river cuts, restored snowy passage, removed dangling title fragment |

The decorative outskirts are locally composed and still differ from Full; these are not pixel-identical copies. Source compass rays and intentional source lettering remain. Validation: all nine geometry snapshots unchanged, all 33 tests pass, data hashes and local build verified.

## Detailed overlap review — follow-up

Silken Hollow was compared with markers in Full and Combined: the independently reduced lair scale (1.9194 versus 5.9223 for the forest) matches Full. Its SVG and Sands remain unchanged.

- Tuzari: removed transplanted landing caps, refined the lower-floor/forest boundary and added the inter-floor arrow.
- Wyrmheart: wider native mountain chain and native soil fill in the former empty patch.
- Regath: smaller map title against the lower-right margin, with more native marsh visible. The follow-up removes Garden of Mallory and its glyphs using a localized imagegen repair from our source crop; see `private/images-combined/patches/regath-garden-restored.prompt.txt`. Obscured details are artistically reconstructed. Native assets and marker coordinates remain unchanged.
- Stormwatch: river/forest seam follows the landscape. Follow-up replaces the shifted mountain fragment and rectangular ink-only Beacon restore with one native-position landscape overlay. Its contour follows mountains, river and forest; the upper source exposes more lower-right woodland. Source caption masking is localized and softened. Artwork registration, encounters and patrols are unchanged.
- Wraithtide: tighter deck/hull/stern crop, retained jungle fork and added ship-entry arrow. Follow-up replaces the straight jungle-top cut and branch restore with a foliage contour; a localized, hash-verified `canvasRepairs` patch removes the remaining fog scar and overlapping cliff lines. See `private/images-combined/patches/wraithtide-junction-restored.prompt.txt` for imagegen provenance and masking. No source or marker transforms change.
- Xul: native rock patch fills the parchment notch between levels; complete title lettering retained.
- Drakheim: lower foreground paints after the church, using a shaped north cut to hide the duplicated building. Removed the rectangular passage restore; church cut follows the snow bank. Follow-up trims the church image's northern parchment along the road and treeline, exposing the intact market artwork beneath instead of a pale cross-road band. No generated repair is used for this junction; all transforms and marker coordinates are unchanged.

Recipe options: foregroundOrder is a validated permutation affecting foreground painting only; arrows uses canvas-space from/to, width and head. backgroundTexture.opacity and irregularity retain native parchment colour and grain without obvious mirrored repetitions. Overscan avoids transparent marks at the frame. All new options are opt-in.

Stormwatch decorative follow-up: two hash-verified `canvasRepairs` reconstruct the pale mountain/forest seam and the right woodland gap from local Combined crops. Exact prompts, canvas positions and masks are recorded in `private/images-combined/patches/stormwatch-restored.prompts.txt`. Lettering is explicitly excluded from the right repair mask. No playable source transforms, placements or patrols change.

Drakheim snowy-junction follow-up: a localized `canvasRepairs` patch repairs the doubled west wall and pale stripe crossing the east building and hillside. Built-in imagegen reconstructs only two masked seam bands from a Combined crop; the remaining artwork and all coordinates stay unchanged. Prompt and provenance: `private/images-combined/patches/drakheim-snow-junction-restored.prompt.txt`. Full is comparison-only.

Validation: all nine artwork/source/placement/patrol snapshots unchanged; Sands and Silken Hollow SVG hashes unchanged. 33 tests, data hashes and local bundle checks pass. Full is used only for comparison and coordinate reference, never as a source of image pixels.
