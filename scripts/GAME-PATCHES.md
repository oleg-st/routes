# Обновление данных клиента

## Текущее состояние: 0.5.0.0, build 26122410

Данные полностью извлечены из обновлённого клиента. В текущей ротации 10 карт, 17 исходных слоёв, 1546 размещений и 628 вычисленных паков. TreeVillage / Crown of the Wild содержит один слой T_TreeVillage_Global. Пять многослойных карт используют Combined. Исходники и отчёты остаются в private/patches/ и не публикуются.

Eternal 1–32 и назначения модификаторов взяты из новых таблиц. Sparse HP curve разворачивается по её линейной интерполяции; native индекс и формулы перепроверены. Casual и скейлинг от экипировки пока не реализованы. Нельзя переносить числовые сложности старых логов в новый билд.

Позиции и патрули пересозданы из AlwaysLoaded enemy levels. Stripped patrol columns восстанавливаются из Followers/PositionIndices. Пак — результат нашей геометрической модели, не явный ID игровой группы. Native bounds/calibration доступны и новым картам без Full; map-area-selection.json хранит отдельно проверенные правила отображения перекрывающихся областей, а не утверждение об игровом выборе этажа.

В Wraithtide две Witch: у стартовой по native capsule/cylinder нет заменяемых акторов, верхняя убирает шесть. Каждый spawner имеет собственный placementId; выбор, score, CRDT и компактный импорт поддерживают оба. Наличие спавнера Ghorn не означает доступность модификатора на текущей сложности.

Маршруты другого/неизвестного билда отклоняются до декодирования индексов. IndexedDB разделена по buildId; прежние сохранения не читаются и автоматически не удаляются. Старая история паков, aliases и миграции Combined удалены. Два проверенных портретных якоря боссов остаются только настройками отображения.

## Список зависимостей

Пересоздание заменяет весь результат свежим экспортом. Проверка означает разбор смысла изменения, а не простую смену хеша. Это перечень областей проекта, не доказательство полного покрытия всех механик игры.

| Область | Источник нового клиента | Обработка и результат | Что заменить, удалить или проверить |
| --- | --- | --- | --- |
| Чтение клиента | Steam build, контейнеры, EXE, asset inventory | `private/game-data/static-mappings.mjs`, `extractor/`, `run-all-dungeons.mjs`, `run-planner-export.mjs` → `native-*.json`, `provider-files.txt`, `all-dungeons/`, `planner/` | Полная выгрузка без кеша; старые raw-каталоги архивируются. Если изменился формат/расположение пакетов, обновить экстрактор и правила обхода ссылок в `export-planner-data.mjs`. |
| Состав карт и метаданные | `DT_LevelInfo`, `LI_*`/`CRLevelInfo`, локализация | `discover-dungeons.mjs` → реестр; `scripts/prepare-game-catalogs.mjs` → `data/dungeons.json`, `manifest.json` | Пересоздать список включённых Dungeon/Adventure, названия, required score и timer. Удалённую карту не переносить из прежнего каталога. |
| NPC и способности | NPC Blueprint/defaults, CharacterTags, GUID CSV, таблицы способностей, локализация | `prepare-game-catalogs.mjs` → `enemies.json`, `abilities.json`, `heroes.json`, `game-modifier-stats.js` | Пересоздать записи и game IDs. Проверить исключения Boss tags, роли героев и `data/ability-corrections.js`; новые классы способностей могут потребовать расширения обхода. |
| Позиции мобов и состав групп | Акторы выбранных уровней, GUID, world XYZ, behavior/social aggro, patrols, navmesh | `build-game-planner-overlay.mjs` → временный overlay; `prepare-game-data.mjs` → `game-dungeons.js`, `custom-dungeons.js`, `dungeons.json` | Пересоздать позиции, этажи, патрули и группы. Проверить `game-height-filter.mjs`, `game-patrol-*.mjs`, `geometric-pack-model.mjs`: это наша модель, а не готовые игровые паки. |
| Слои и координаты карт | `BP_DungeonMapAreaBox_C`, bounds/scale, `DungeonAreaTexture` | `prepare-game-catalogs.mjs` → `game-map-frames.json`, `dungeons.json.mapImages` | Заменить границы и проекцию из клиента. Attached/rotated области сейчас требуют доработки преобразований; перекрывающиеся области требуют проверки выбора этажа. |
| Текстуры, портреты, иконки | `planner/textures-manifest.json`, `images.json`, decoded images | `prepare-game-catalogs.mjs` → `game-image-sources.json` и image jobs; `prepare-game-images.mjs` → AVIF | Пересоздать изображения и хеши. Удалять старые только после определения полного набора используемых изображений; обычный `patch:build` пока не вызывает очистку лишних AVIF. |
| Объединение слоёв | Новые текстуры + авторский рецепт | `scripts/combined-maps/*.mjs`, `index.mjs`, `prepare-combined-maps.mjs` → `data/combined-layouts.js`, `images/dungeons/combined/` | Для нескольких слоёв создать/проверить рецепт; для одного рецепт не требуется. Убрать регистрацию рецептов удалённых карт и бывших многослойных карт, ставших однослойными. |
| Ручная калибровка и оформление | Авторские transforms, контуры, обрезки, фон, рамка, repairs | `data/full-maps.js`, `marker-anchors.js`, `combined-maps/`, `private/images-combined/patches/` | Старые координаты, якоря и графические заплатки не являются новым game data. Проверить или убрать их; смена `fullMapBuildId` без проверки недостаточна. Независимой новой карте не нужна Methods-калибровка. |
| HP и скейлинг | `CT_CharacterBaseAttributes`, `CT_CharacterScalingBaseAttributes`, gameplay effects, native код | `game-catalog-source.mjs`, `game-scoring-source.mjs`, `prepare-game-services.mjs` → `enemies.json`, `game-service-rules.js`; runtime `game-scoring.js`, `route-model.js` | Обновить значения и проверить индекс сложности, интерполяцию/форму кривых, округление и порядок модификаторов. Новая таблица сама не меняет интерпретацию формулы в JS. |
| Сложности и назначение модификаторов | `DT_DifficultyToLevel`, `DT_GameFinderLeagues`, `DT_ModifersInDungeons`, unlock curves | `export-game-difficulty.mjs`, `prepare-difficulty-data.mjs` → `game-difficulty.js`, `scripts/difficulty-source.json` | Пересоздать доступные варианты. В билде 26122410 опубликованы Eternal 1–32 по ротации. Casual Easy/Medium/Hard пока не предлагаются: персональный скейлинг экипировки не моделируется. |
| Очки, орбы, Empowered, Stone Skin, Ultimatum, Polymorph | Эффекты, spawner Blueprint, `DefaultGame.ini`, native targets | `game-scoring-source.mjs`, `prepare-difficulty-data.mjs`, `game-service-semantics.json` → `game-service-rules.js`, `game-difficulty.js` | Проверить множители/лимиты/targets. Старый override Polymorph удалён: новый экспорт задаёт границы 2 и 3.5. |
| Входы, костры, замена мобов мини-боссами | PlayerStart, respawn actors, modifier spawners, hit capsules | `prepare-game-services.mjs` → `map-starts.js`, `map-campfires.js`, `modifier-placements.json`, `game-modifier-positions.js` | Пересоздать позиции и заменяемые группы. Проверить `game-service-model.mjs` и `game-service-semantics.json`, особенно несколько spawners одного типа и выбор этажа. |
| Призывы и особые бои | Spawn bytecode, AI, ability constants, Brogg retreat proof | `prepare-game-summons.mjs`, `game-summon-semantics.json`, `build-game-planner-overlay.mjs` → `game-summon-rules.js`, phase markers | Проверить старые правила и найти новые призывы/фазы. Пересмотреть `data/boss-encounters.js` и `log-import/boss-encounters.js`; старый список не покрывает автоматически новые механики. |
| Импорт логов | Новые game IDs, координаты, сложности и реальные логи | `log-import/`, `map-views.js`, runtime catalogs | Проверить сопоставление NPC/способностей, world → layer → combined, призывы/реликвии/переходы. `log-import/fight-label.js` пока использует прежние лиги и offset 20. |
| Исторические ID и маршруты | Прежние placement IDs, алиасы и индексы | `scripts/game-source-registry.json`, `data/route-mapping.js`, `route-dictionary.js`, `placement-corrections.js`, `route-build.js` | JSON/compact/CRDT требуют текущий buildId. Словарь сбрасывается между билдами и дополняется внутри билда. Старые aliases, pack history и миграции Combined удалены; GUID registry остаётся авторским источником идентичности. |
| Готовый сайт и кеш | Пересозданные data/images + runtime | `build-local.mjs` → `local.html`; `build-site.mjs`, `compact-public-data.mjs`, `build-site-assets.mjs` → `dist/` | Сборка сайта создаёт `dist/` заново по allowlist и хеширует URLs. Изменения схемы координат нужно сохранить также при compaction; проверить отсутствие private paths. |


## Порядок обновления

До патча: npm run patch:baseline, затем npm run patch:plan -- --python="C:/path/to/python.exe". Снимок содержит raw hashes, опубликованные данные, изображения, правила, реестр и инструменты; baseline.json указывает выбранную базу. Контейнеры и старый EXE не копируются.

После обновления: npm run patch:extract, затем npm run patch:report. Выгрузка начинается в пустых all-dungeons/ и planner/; старые данные архивируются в raw-before/. При обычной ошибке они восстанавливаются, неудачный экспорт сохраняется для диагностики. После принудительного прерывания сначала проверить run.json и raw-before/.

Отчёт сравнивает GUID/XYZ, NPC, способности, таблицы, выбор уровней, патрули, behavior, navmesh, native EXE и текстуры. Для текстур сверяются metadata, raw pixels и decoded hashes. Экспортные индексы могут меняться без изменения содержания: сравнивать текстуры по стабильному имени объекта. Ненулевой код report означает неполные источники или необходимость пересмотра guards.

После разбора изменений: npm run patch:build. Генерация, очистка изображений, сборка local.html и тесты входят в транзакцию с откатом опубликованных файлов. Не менять reviewed hashes без проверки. Новые summon-механики требуют отдельного поиска: 14 известных правил сами по себе не доказывают отсутствие новых призывов.

## Очистка и проверка

- Каталоги и геометрия пересоздаются целиком; активная ротация определяется таблицами сложности и AvailableForCasual.
- prune-game-images.mjs сохраняет используемые изображения и портреты каталога, лишнее архивирует в private/assets/unused/ перед удалением. Сборка dist использует allowlist.
- Старые рецепты могут оставаться авторскими исходниками вне активной ротации. Лишние runtime Full/placements/patrol overrides удалены; калибровки и текстуры проверяются отдельно.
- Перед коммитом: npm test, npm run check, npm run build:site, npm run test:storage:browser, npm run test:site:browser. Для правок мини-боссов проверить обе цели в UI, JSON/compact и CRDT.
- Для новой многослойной карты проверить каждый слой, world-only координаты логов, пустые слои и переходы патрулей. Визуально проверить стыки, рамку, фон и выбор области: одних тестов недостаточно.

## Визуальная сборка многослойной карты

```powershell
npm run maps:editor
```

Откройте `http://127.0.0.1:4180`. Сборщик читает текстуры и области свежей выгрузки, поэтому новая карта доступна до пересборки публичных данных. По умолчанию выбран Wyrmheart для проверки на существующей карте. Если клиент уже обновлён, старые маркеры мобов не показываются.

1. Выберите карту и слой. Перетаскивайте слой, задавайте X/Y и масштаб. Колесо меняет масштаб вида, перетаскивание пустого поля перемещает вид. «Вписать всё» возвращает все слои в кадр.
2. Уменьшите прозрачность для совмещения общих ориентиров. Кнопки «Ниже»/«Выше» меняют порядок слоёв.
3. Нажмите «Рисовать новый контур» и отметьте границу нужной территории. Нажмите кнопку ещё раз, чтобы закончить; нужно минимум три точки. «Весь слой» восстанавливает прямоугольник.
   Чтобы проявить нижнюю карту в месте пересечения, выберите верхний слой и включите «Вырезать прямоугольник», затем протяните мышью область удаления, включая мешающую рамку. Для сложной формы используйте «Вырезать по точкам» и «Завершить вырез». Вырезов может быть несколько; они сохраняются вместе со слоем. Esc выходит из инструмента, «Удалить последний вырез» убирает последний участок; отмена и повтор также работают.
4. Сохраните черновик. Файлы JSON и MJS появятся в `private/combined-map-drafts/`. Автосохранение в браузере дополнительно привязано к билду клиента. «Скачать рецепт» экспортирует модуль для общей сборки.

Пробная сборка экспортированного рецепта:

```powershell
npm run maps -- --recipe=private/combined-map-drafts/IceCave.mjs --preview
```

Результат — SVG и координатный JSON в `private/combined-previews/`; текущие карты и `data/combined-layouts.js` не меняются. Это тот же рендерер, что используется в рабочем планировщике. Для новой карты он читает свежий каталог клиента.

После проверки текстур и расположения мобов перенесите MJS в `scripts/combined-maps/`, подключите его в `index.mjs` и пересоберите карты. При замене существующего рецепта измените версию координат, если поменялась система координат сохранённых рисунков. Рецепт сборщика не зависит от Methods. Первая версия поддерживает перенос, единый масштаб и полигональную обрезку; поворот, деформация и сложная ретушь остаются ручными возможностями основного формата рецептов.

Проверка инструмента: `npm run test:maps:editor`. Тест проходит на Wyrmheart через перетаскивание, масштаб, контур, отмену/повтор, сохранение/загрузку, экспорт и пробную сборку, проверяя неизменность опубликованного layout.
