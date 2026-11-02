# Compact route links

R5 is the next format after R4. Intermediate experiments were never released.
Share/Export compare R3, R4, and both R5 profiles and emit the shortest result.
The route remains self-contained: no server record or shortening service.

## R5 representation

New Share URLs contain `#r5=` followed by unpadded Base64url. Raw Export strings
still start with `R5.`; old `#route=R5.` links remain supported. This URL-only
change saves six characters without changing the codec or version. R3/R4 Share
links retain their original `#route=` form. The first decoded
byte contains flags: bit 0 enables raw DEFLATE, bit 1 selects the generic
profile. Values outside 0–3 are invalid. Both profiles are tried raw and with
DEFLATE; the actual encoded lengths determine the winner.

Compression is optional, not an inherent part of the binary format. The sample
below takes 58 raw bytes, 63 with DEFLATE and 62 with Brotli quality 11, so raw
wins. In an experiment adding a 2400-character repeated note to that route,
the best raw candidate took 2625 bytes and DEFLATE took 137. Brotli was measured
in Node only; it adds no dependency to the browser application.

The **dense profile** (`route-dense.js`) knows the route schema:

- An immutable codebook ID and dungeon ID replace repeated build, map and
  preset strings. The exact game build is restored before normal validation.
  Known modifier presets use short flags only on an exact match; custom
  selections and inactive replacement settings remain explicit.
- Five membership candidates compete: ordered member/pack deltas; globally
  sorted placements with pull numbers; enumerated placement subsets; enumerated
  pack/individual subsets; and separate pack/individual subsets whose eligible
  populations shrink after each pull.
- Complete packs need not be contiguous in the original member list. Frozen
  pack compositions supply their members; sparse permutation records restore
  the exact original order. Partial packs remain individual placements.
- Enumerative coding stores a subset's rank in `C(n,k)` possibilities using
  `ceil(log2(C(n,k)))` bits. Exp-Golomb codes store counts and small deltas.
- Pull metadata is grouped by field with presence masks. Exact editor-generated
  titles (`Dungeon · #N`, `Route N`) and `Log segment-N.` notes use templates;
  arbitrary names, text and Unicode are retained verbatim.
- Geometry uses signed coordinate differences and an adaptive integer code.
  Exact hundredths are stored as integers, with a float64-capable fallback.
  R5 introduces no rounding beyond the existing export rounding in
  `route-model.js`. Maps and standard drawing colors use short references.

The **generic profile** (`route-binary.js`) retains typed tuples, string
references and ordered member coding. It also supports builds or dungeons that
have no dense codebook yet. Older formats can still win on unusual content.

`data/route-codebooks.js` is append-only. Never modify an existing book's IDs,
groups, names, maps or presets; append a new book when they change. A hash test
locks book 1. This dictionary covers all eleven dungeons, not particular user
routes; its compact JSON is 9242 bytes. No user route is cached in the codec.

Import bounds decompressed size, nesting, counts, references and expanded
content. Combinatorial ranks outside their range, duplicate assignments,
truncation and trailing bytes are rejected. Frozen groups prevent regrouping
in a later dataset from changing the meaning of a link.

## Lazy R1–R3 compatibility

`route-legacy.js` is imported dynamically only after an R1, R2 or R3 link has
been recognized. It contains historical dictionary/fingerprint reconstruction
and dispatch; validation shared with current formats stays in the core.

The site build emits a separate content-hashed module and leaves its dynamic
import external to the application bundle. A changed module also changes the
importing app's URL. The development server similarly serves a separate file.
Browser checks confirm zero compatibility requests at startup and for R4/R5,
then one cached request shared by R1/R2/R3. The minified optional module is
1189 bytes before HTTP compression.

The portable `local.html` embeds the optional module as a data URL, preserving
single-file/offline operation, but parses and executes it only on demand.

Format and game build are independent: a current-build R3 fixture still exists.
Removing legacy decoding solely because its format number is old is unsafe.
Compatibility has no effect on the length of newly generated links.

## Measured result, 2026-11-02

| Supplied Crown of the Wild example | Code characters | Full URL characters |
| --- | ---: | ---: |
| Original R4 | 461 | 491 |
| Final R5, all fields preserved | 82 | 106 |

R5 uses 58 bytes of route data plus one flags byte.
The full URL shrinks by 78.4% relative to the original R4. These measurements
apply to this fixture; savings vary with route content. It has seven pulls
containing 22, 11, 14, 1, 18, 1, 1 selected mobs and retains its
title, five notes, difficulty 46, drawing colors/fine coordinates, explicit
modifier selections, build identity and original member order.

Run `node scripts/benchmark-route-codecs.mjs [route-file]` for a size breakdown.
It reports the input length separately from canonical re-encodings.
Fixtures `compact-route-current-r4.txt` and `compact-route-current-r5.txt` lock
the input and output. Tests cover every dense mode, all dungeons, seeded partial
packs and permutations, Unicode, custom settings, precision boundaries,
unknown future builds, truncation, decompression limits and legacy formats.

Browser checks:

- `node tests/transfer-ui.mjs`: import/export/share and clipboard behavior in
  both the served app and the portable file.
- `node tests/route-legacy-browser.mjs`: real production bundles, deferred
  network requests, module caching and hash invalidation under a path prefix.
- `node tests/site-cache-browser.mjs`: existing warm-cache deployment behavior.
