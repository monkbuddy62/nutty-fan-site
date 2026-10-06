# dnd-view — the player map viewer

## What it is

`/dnd-view/` is the campaign map as players see it: the whole `rugby.map` world, pinch and drag
on a phone, tap a town or a marker or a stretch of land to read what it is. It is a picture of the
map, not the map program: every pixel was drawn ahead of time by FMG itself (`map-build/`), so it
looks like `/dnd-map/` at that zoom, and nothing is computed while a finger moves.

The editor stays at **`/dnd-map/?edit`** (the DM's URL). Plain `/dnd-map/` (no `edit`, `maplink`
or `seed` in the query) redirects here, keeping the hash (dnd-map patch 6, [dnd-map.md](dnd-map.md)).
The viewer's "Open full map" link goes to `../dnd-map/?edit`.

## Why WebGL, not FMG's SVG or Leaflet

| Option | Measured | Verdict |
|---|---|---|
| Build 3: FMG's live SVG moved with a CSS transform (dnd-map patch 2) | about 1 fps on the owner's iPhone; WebKit paints SVG into 512 px tiles on the main thread, and the commit after a gesture re-lays out ~1,165 labels and re-renders masks (one commit traced at 431 ms) | replaced for players |
| Leaflet 1.9.4, pre-rendered `<img>` tiles (derisk E1, Playwright WebKit, 180-frame gestures) | pinch/drag pass: rAF p50 16-22, p90 18-27 ms. **Settle fails:** inserting 28 tiles after a zoom gave a worst frame of 79-96 ms in every variant, about 3 ms per tile; decode-first, fade off, async decode and 2-4 tiles per frame all stayed at 52-153 ms worst | rejected |
| **MapLibre GL JS 6.12.0, raster source, one WebGL canvas** | Chromium 390×844@3, real CDP touch: main-thread task per frame median 0.85-1.39 ms, p90 3.0-5.2 ms against a < 4 ms target (stream B1; the p90 misses, see Acceptance); longest task in the 2 s after release 2.3-8.7 ms; **0 DOM mutations** during every gesture in Chromium and WebKit | chosen |

A tile in MapLibre is a texture, never a DOM node: a pinch or a drag is a uniform change on the
GPU, and a tile arriving after a zoom is one texture upload, not a layout + paint. The absolute
frame times above come from software GL on a shared 2-core box; the iPhone is the real gate (below).

## Geometry

All of it is fixed by `meta.js` (`window.DND_META`), which the build writes.

- **Map units** are FMG's: `graphWidth × graphHeight` (rugby: 1600 × 731), origin top-left, y down.
- **Level n** (0..5) is the map at 2^n device px per map unit, with labels and markers baked by FMG
  at zoom **K = 2^n / 3** (`labelDpr` 3: the audience is 3× iPhones). Tiles are 512 × 512 px WebP.
- **WORLD** = 512 · 2^ceil(log2(max(w,h)/512)) map units (2048); **zOffset** = log2(WORLD/512) (2).
  A map point (x, y) is `MercatorCoordinate(x/WORLD, y/WORLD)`; MapLibre tile z = n + zOffset.
- MapLibre zoom Z shows **s = 2^Z · 512 / WORLD** CSS px per map unit.
- The raster source's `tileSize` is `512 / dpr` (dpr = clamp(devicePixelRatio, 1, 3), read once at
  boot), so MapLibre's covering rule picks **z = round(Z + log2 dpr)**: the level whose texels match
  device px. On a 3× phone, level n is shown at s = 2^n / 3 = K, which is FMG's own CSS scale for
  that picture, so hit boxes and "22 CSS px" mean the same thing in both.
- `bounds` = the map extent inset by 1e-3 units, so an edge exactly on a tile boundary never asks
  for the tile past it; `minzoom` zOffset, `maxzoom` zOffset + 5. Only tiles touching the map exist.
- Zoom range: [whole map fits (contain), s = 20]; the view centre is clamped to the map
  (`transformConstrain`, replacing MapLibre's Mercator constrain, which would forbid seeing a
  portrait map whole). Recomputed on resize.

## Files

| Path | What | Owner |
|---|---|---|
| `dnd-view/index.html` | Viewport, inline critical CSS, page-zoom guards, LQIP at the initial view, load order | hand |
| `dnd-view/viewer.js` | Map setup, view hash, taps and the info card, stale guard, `?perf` HUD | hand |
| `dnd-view/viewer.css` | The few MapLibre rules used, notes, card, HUD; loaded without blocking first paint | hand |
| `dnd-view/sw.js` | Cache-first service worker for `t/` and `libs/` (inert on the live http-only hosts) | hand |
| `dnd-view/libs/maplibre-gl-6.12.0/` | Vendored `maplibre-gl.mjs`, `-shared.mjs`, `-worker.mjs`, `.css`, `LICENSE.txt`, byte-identical to the npm package: the `.css` (83 KB) is not linked (`viewer.css` carries the rules used), and the `.mjs` files' `sourceMappingURL` lines name `.map` files that are not vendored (DevTools logs 404s for them; nothing else asks) | vendored |
| `dnd-view/meta.js` | `window.DND_META`: hash, geometry, paths, LQIP, `bg`, tile counts, `renderer`, `rev` | **generated** |
| `dnd-view/t/<mapHash12>/<z>/<x>/<y>.webp` | Tiles, levels 0-5 (6,157 tiles, 36.8 MB for rugby) | **generated** |
| `dnd-view/t/<mapHash12>/backdrop.webp` | The whole map at level 0 (1600 × 731), under the tiles | **generated** |
| `dnd-view/t/<mapHash12>/data.json` | Tap data (below); 1.34 MB raw, 277 KB gzip -9 | **generated** |
| `map-build/` | The generator (`build-map-tiles.mjs`, Playwright 1.63.0, vendored fonts with OFL) — see its README | hand |
| `.github/workflows/dnd-tiles.yml` | Rebuilds the generated files when the map or the build changes | hand |

Never hand-edit a generated file: change `map-build/` and run it. `mapHash12` is the first 12 hex
of sha256(`rugby.map`), so a new map gets new URLs and cannot mix with cached tiles of the old one.
`meta.rev` is the first 12 hex of a hash over every published file's bytes (tiles, backdrop,
data.json); the viewer appends `?r=<rev>` to every tile, backdrop and data.json URL, so a
re-render under the same map hash (a renderer change, the × 100 cells below) also gets new URLs
in every cache. `meta.renderer` hashes what draws the tiles (build script, its lockfile, fonts,
FMG); `--check` fails when it changes ([map-build/README.md](../map-build/README.md)).

### data.json

```
{ v, cells: { n, scale: 100, x[], y[] /* site * scale, exact (FMG stores 2 decimals) */, h[], f[],
              state[], province[], culture[], religion[], biome[], river[] },   // every cell, ocean too
  features[] /* by id: {i, type: ocean|lake|island, name?} */, states[], provinces[], cultures[],
  religions[] /* by id, null for removed */, biomes[] /* names */, rivers[] /* list, find by i */,
  burgs[] /* by id: {i, name, x, y, population (people), type, group, culture, state, capital, port, link} */,
  markers[] /* list: {i, type, icon, x, y, name, legend} */,
  hits: { "<n>": [[kind 0 burg|1 marker, id, x0, y0, x1, y1] /* map units * 10, paint order */] } }
```

Cell sites were at map units × 10 in the first build; that rounding flipped 6 of 500 nearest-site
answers against FMG's `findCell`. At × 100 (`cells.scale`) they are exact: 500/500, for +29 KB gzip.
The viewer reads `cells.scale` (10 if absent). This deviates from the build-4 contract, which said
× 10; `CELL_SCALE` and `HIT_SCALE` (10, hit boxes) are in `build-map-tiles.mjs`'s config block.

## Load

1. `meta.js?v=4`, then an inline script (`// === EARLY ===`): page-zoom guards (`gesture*`,
   `dblclick`); `window.DND_CFG`, the constants both scripts need (`MAX_S`, `VIEW_KEY`, the tile
   loader, the `#s/x/y` parser), defined only here; the initial view (hash `#s/x/y`, else
   localStorage `dndView.v1` for this map hash, else s = clamp(1, contain, cover) at the centre);
   the LQIP (64 px wide, inline in meta.js) placed at that view's exact rect, which paints before
   MapLibre exists (it lies under `#map`, earlier in the document: below, the LQIP section); and **the first view's tiles**, fetched at once: the level MapLibre's covering
   rule will pick (round(log2(s · dpr))) and the tiles under the viewport, so their ~570 KB
   downloads alongside MapLibre's ~294 KB instead of after it. The tile loader takes these
   promises (`DND_CFG.pre`), and the default `worker` loader sends each to a decode worker as soon as
   `viewer.js` boots (Tile loading › The first view's decodes); the `?imgpath` loader just warms the
   HTTP cache with `new Image()`.
   The page background is the map's sea, `meta.bg`, on `<html>` only (`#6faebd` in the inline
   CSS, then the script sets `meta.bg`); `<body>` stays transparent so it cannot paint over it.
   The canvas is transparent and the style has no background layer: this page colour is the
   map's background (Tile loading › Draws per frame).
2. An inline `<script type="module">` imports `maplibre-gl.mjs` and sets `window.maplibregl`
   (MapLibre 6 is ESM-only; there is no UMD file). `modulepreload` hints fetch both bundles early.
3. `viewer.js?v=4` (classic, `defer`, so it runs after the module). No module support or no
   WebGL2 shows a note with the full-map link instead.
4. On the first `idle`: unused preloads (and their pre-decoded pixels) are dropped, the backdrop image source is
   added under the tiles (the LQIP goes in the frame that first draws it) (decoded in a decode worker, handed to MapLibre only while the view is
   still: Tile loading), the stale guard runs, the service worker registers (https only), and
   `data.json` is fetched at low priority (parsed only while the view is still: Taps).

The player path requests nothing from FMG except one `HEAD` of `rugby.map` (stale guard).

### The LQIP follows the camera

The LQIP used to sit fixed **over** the canvas until the first idle. A drag or pinch before then
(a player who sees the map picture tries to move it at once; the first crisp view is 0.6-1.1 s away
on Wi-Fi-class links, more on cellular) moved the map under a picture that did not move: a frozen
screen, then a jump at idle (round-3 hunters, both engines: centre moved, LQIP still at its boot
rect; a rotation left it ~227 px off on both axes). A gesture also asks for tiles nobody preloaded,
so idle came later still. Now it lies **under** the transparent canvas, so tiles land on it as they
arrive, and `followLqip` moves it on every `move` (`translate(map.project(0,0)) scale(s / s0)`, one
compositor-only transform per frame). It goes in the frame that first draws the backdrop (the same
picture, sharper, inside the canvas), so a zoom-out or fling before the backdrop arrives shows the
blurred map, not bare sea. Measured (tiles delayed 3 s, drag, pinch, rotate, all before the first
idle): the LQIP's rect equals `map.project` of the map corners to 0 px at every frame and after the
rotation, both engines. Without a delay it goes 0.1-0.3 s after the first idle in WebKit here,
~0.55 s in Chromium (the backdrop's fetch and decode). The cost: one style write per frame for a
gesture made before the backdrop is drawn (30 mutation records in a 30-move pinch started at the
first idle; none after).

## Tile loading

How a tile's bytes become a texture decides the viewer's memory and its settle on an iPhone, so
there are three loaders, chosen in the query string, for the on-device A/B:

| Loader | How | Query |
|---|---|---|
| **worker** (default) | A custom protocol (`dndtile://`, `maplibregl.addProtocol`) fetches the bytes; a pool of `DECODE_WORKERS` (2) small workers of the viewer's own decodes them (`createImageBitmap`, drawn on an `OffscreenCanvas`, `getImageData`, premultiplied) and transfers the **raw RGBA** back, never an `ImageBitmap` (below) | none |
| bitmap | The same protocol; `createImageBitmap(blob, {premultiplyAlpha: "premultiply"})` on the main thread | `?bitmap` |
| img | MapLibre's own path for a plain URL with `refreshExpiredTiles: false`: one `new Image()` per tile, uploaded with `texSubImage2D(img)` | `?imgpath` |

The protocol loaders keep `Cache-Control` from reaching MapLibre (no expiry timers) and hand it
decoded pixels:

- **worker:** the raw pixels as an image MapLibre uploads as is (`rawImage`). MapLibre's image
  request passes a protocol's answer through only if it is an `ImageBitmap` or an
  `HTMLImageElement` (anything else is taken for encoded bytes), and its `Texture` uploads any
  object with a `data` field from that array (`texSubImage2D`). So the object is created on
  `HTMLImageElement.prototype` with its own `width`, `height` and `data`. The pixels are already
  premultiplied (only edge tiles have alpha), and the tile source is told not to premultiply
  (`setPremultiplyAlpha(false)` on every `style.load`, before the first tile request); otherwise
  MapLibre's raw path premultiplies in JS on the main thread, allocating 1 MB per tile.
- **bitmap**, and the worker loader's main-thread fallback: a premultiplied `ImageBitmap`,
  **closed on the next task**: MapLibre uploads it synchronously right after its `await`
  (`RasterTileSource.loadTile`) and never closes it, and an unclosed bitmap holds its decoded
  pixels until GC.

Screenshots at the map's edges and the whole map (5 views) are byte-identical to `?imgpath` for
both protocol loaders in both engines, so the alpha is right.

**Why raw pixels, not a transferred `ImageBitmap`.** In Playwright's WebKit (Linux WPE), a bitmap
transferred out of a worker kept its pixels only until **that worker made its next image**; then it
showed that image. Tiles drew other tiles' pictures (a town in the open sea), and the 64-tile cache
showed them again on every revisit (round-2 hunter: the in-worker fingerprint right, the one on the
main thread wrong, always a picture the same worker decoded later). Outside the viewer, one worker
decoding 36 tiles gave 268-350 of 360 wrong bitmaps in every mode (concurrent, one at a time, copied
with `createImageBitmap(b)`, `OffscreenCanvas.transferToImageBitmap()`); Chromium 0/360. Before the
fix, a 1.5 s animated zoom left 1-3 of 15 tiles wrong in 7/10 runs (3/6 here), a still jump in
1/3-8/16. This was one cause of the "band" seen after a deep jump in earlier rounds, which round 1 had put
down to a WPE presentation lag: its check (`readPixels` at idle vs after a repaint) could not see
it, because both frames were equally wrong. The band WebKit's *screenshot* still shows after
`#6/881/138` is the other cause, and it is WPE's: the screenshot equals the second-to-last GL frame
exactly (round-3 hunter, 3/3 runs, held 3 s; the GL frame at idle has 15/15 right tiles, and one GL
draw refreshes the screenshot). Why (round-4 hunter): with a non-antialiased WebGL canvas, Linux WPE
always presents the frame before the last one. A bare canvas with no MapLibre shows the stale frame every
time with `antialias: false` and the last frame with `antialias: true` or `preserveDrawingBuffer: true`;
Chromium shows the last frame in every case. With only `antialias: true` patched in, the band is gone
(0 px differ in 4/4 runs, against 963-12,375 px). Tile retention is right in every intermediate frame
(each loaded level-4 tile matches the idle frame exactly; the parent level is drawn only where children
are still missing). `antialias` stays off: a multisampled 3× drawing buffer is a real GPU cost on the
phone, for a bug of WPE's presentation. If the iPhone ever shows a stale band after a jump, it is the
switch to try (Open questions). Every WebKit `worker` figure measured before this change
(settle, first crisp, memory) was taken with some tiles wrong; timing is probably unaffected.
iOS backs images differently (CoreGraphics/IOSurface), so the device may not have the bug;
`?perf` reports it (Acceptance). **The acceptance check for any loader change is the frame against
the tile files, per tile** (every in-view tile's rect in the GL frame read inside MapLibre's own
`idle` handler, compared with that tile's file), in both engines, for a still jump and an animated
zoom.

**What WebKit here can and cannot say about the settle.** After the change, the WebKit gap probe
after a drag got worse: a worst gap of 54-109 ms with 2-3 gaps over 40 ms after every drag, against
5-12 ms after most drags before (6-12 drags each, `:8784`). Neither the removed background layer
nor `index.html` does it (both swapped back: unchanged). Timing `map._render` shows why: each render
after release blocks the main thread 81-98 ms with raw-uploaded textures, **and with MapLibre's own
`?imgpath` textures (84-99 ms)**, but 1-6 ms when every texture came from an `ImageBitmap` (`?bitmap`,
or the old worker path), with or without an upload in that frame. The number of renders and their
cadence are unchanged (old renders 130-170 ms apart, new ~100 ms), so the frame's software-GL work
did not grow: WPE's in-process GL runs it on the main thread unless the textures came from
`ImageBitmap`s. The same effect is the `img` loader's 60-100 ms settle gaps in the table below,
which were read as decode cost. An iPhone sends WebGL commands to its GPU process whatever the
texture source, so this says nothing about the device; the raw uploads themselves took 0-1 ms each
here, against 71-91 ms for the old bitmap uploads. `?perf` on the device decides (Open questions).

**Decode workers that die.** iOS may terminate a backgrounded page's workers and fire no event
(WebKit bug 211018, MapLibre #8461). A dead worker takes messages and never answers, so every tile
after it stayed `loading`, `idle` never fired again, and only a reload recovered (hunter: both
decode workers terminated, then a jump: 15 and then 28 tiles loading, 0 idles, both engines). Now
each decoder keeps its jobs' bytes (it posts a copy) and a watchdog: a worker with work that has said
nothing for `DECODE_STALL_MS` while the page is visible is replaced by a new one from the same blob
URL, and its jobs are posted again; a watchdog timer that itself ran late (a busy main thread, so
answers may be queued behind it) only re-arms. Past `DECODE_RESPAWNS` replacements **in a row** (no
answer from any of them) the pool stops and decoding moves to the main thread, as for a worker that
fails to start or cannot decode (no `OffscreenCanvas`; verified by replacing `Worker` with a failing
stub: all tiles loaded in both engines). Any answer resets the count. It used to count every
replacement for the page's life, so the 4th lock or app switch of a session (each kill costs both
decoders one replacement) moved decoding to the main thread for good: then 72 main-thread decodes in
4 jumps, `createImageBitmap` 190-203 ms median, worst main-thread gaps 500-521 ms in WebKit
(round-4 hunter). Now 6 kills: 0 main-thread decodes; workers that never answer (a stub, every start)
still reach the cap after 3 replacements each and every tile loads (both engines).

**Returning to the page** (`visibilitychange` to visible after a hide, or a `pageshow` from the
back-forward cache) **replaces every decode worker outright** (`restart`), not counted against the
cap, and posts again any job it held. It used to ping them, and the ping waited out the same
`DECODE_STALL_MS`: with dead workers the first zoom after a return had no tiles for ~1 s, and after a
context loss nothing but the sea colour was drawn for that long. Measured (hidden 300 ms, a jump
100 ms after "visible", time until its tiles are in; A/B against the round's start):

| | Chromium live | Chromium dead | WebKit live | WebKit dead |
|---|---|---|---|---|
| before (ping) | 88-156 ms | 963-1045 ms | 462-838 ms | 1234-1704 ms |
| now (restart) | 75-165 ms | 79-177 ms | 480-763 ms | 426-937 ms |
| context lost while hidden, tiles / backdrop back after the restore, before | 195 / 58 | 1185 / 1138 | 959 / 97 | 1767 / 1088 |
| the same, now | 174 / 78 | 183 / 59 | 1005 / 104 | 734 / 113 |

A worker start costs nothing measurable here (the live columns match). Under `?perf` the old worker is
asked once before it goes, and the HUD notes "decode worker n alive on return" or "dead on return":
the on-device answer to whether iOS kills them. A watchdog replacement is noted as "replaced".

**Immutable fetches.** Every tile, the EARLY preloads, the backdrop and `data.json` carry `?r=<rev>`,
so they are fetched with `cache: "force-cache"` (`fetchImmutable`): a cached copy is used however
old it is. With the default mode, once Pages' `max-age=600` ran out each revisited tile cost a
304 round trip, and offline the tiles errored although the bytes were on disk (hunter, Chromium,
`max-age` 20 standing in for 600: 18 × 304 on returning to a view, 18/18 errored offline; with
force-cache 0 requests, 18/18 loaded). A non-2xx answer (a 404 cached in a deploy race) is retried
once with `cache: "reload"`. A request that fails outright (no response: a network blip) is tried once
more `FETCH_RETRY_MS` later, unless MapLibre aborted it meanwhile: MapLibre never asks for an errored
image source again, so one blip lost the backdrop for the session, and errored tiles stayed in view
until the player moved away (round-4 hunter). Now, with the first backdrop fetch failed: backdrop
drawn, LQIP gone, idles as usual; with 4 tiles of a jump failed once: none errored (both engines).
The `?imgpath` loader cannot do this (MapLibre's `<img>`).

**Upload pacing.** MapLibre's request throttle (8 in flight while moving) caps fetches, not
uploads; each decoded tile it receives is a synchronous `texStorage2D` + `texSubImage2D` +
`generateMipmap` in that task, and the two decode workers answer in clusters. Measured before
pacing: a 1 s pinch over two levels in Chromium put up to 5 uploads in one 8.3 ms window and 19
in the frame at the end, 40 % of them tiles of a level zoomed through and replaced in the same
gesture; WebKit's zoom-out settle put 3-7 in one frame interval. So the protocol handler holds
each decoded tile for a slot (`uploadSlot`): while the view moves (or a finger is on it: below), `UPLOADS_MOVING` (1) per frame,
released by a `MessageChannel` task posted from `requestAnimationFrame`, i.e. right after that
frame is drawn; while still, up to `UPLOADS_STILL` (4) per frame at once; the first view (before
the first idle, nothing moving) is not capped. Nothing animates while the view is still, so the
still cap only bounds how long a new touch can wait behind a burst (~4 uploads); 2 made a jump to
an uncached place take 9 frames to sharpen. Tiles of the level being drawn go first, and a
tile MapLibre aborts while it waits (a level zoomed through) is dropped without an upload. The
slot holds MapLibre's request slot too, so fewer tiles are fetched for levels that will be passed.
`?nopace` turns it off for the on-device A/B.

**Decode pacing.** The upload slot only bounded uploads: every tile was still decoded the moment its
bytes arrived, and in a fast zoom (bytes from the HTTP cache: the common case after the first
minute) the decoded tiles queued for a slot while MapLibre aborted the levels zoomed through, so a
decode (1 MiB transferred to the main thread, then garbage) was thrown away. Only the page heard
the abort; the worker decoded on, FIFO, so the final level's tiles waited behind dead ones
(round-3 hunters, WebKit: 228 decoded / 75 uploaded over six fast eases; a 1.5 s ease from the whole
map to s 20 posted 33-38 decodes, 24-32 after their abort, final-tile decode latency 0.4-1.2 s). Now
(`decodeSlot`, `pumpDecodes`), **while the view moves** (or a finger is on it) a tile waits with its compressed bytes
until decodes in flight plus decoded tiles waiting for an upload are under `DECODED_AHEAD_MOVING`
(3), the level being drawn first; a tile aborted while it waits never reaches a worker; and an abort
mid-decode sends the worker `{cancel: id}`, which skips the draw, the read-back and the transfer.
Every job is answered once, so a decode's slot is held until its worker is free, and decodes go to
the least-loaded worker. While still nothing waits: a cap of 2 per worker at all times made the
first crisp view ~210 ms later in Chromium (its workers decode several images at once). Measured
(`:8784`, A/B against the round's start): the 1.5 s ease, WebKit 24-25 decodes against 46-47,
Chromium 32-35 against 54-56, idle unchanged within noise (WebKit here is render-bound); the six
eases, WebKit 125-142 decoded against 225 for ~77 uploads (92-113 tiles dropped before a decode, 5-13
cancels that crossed a finished decode). The rest of the gap is decoded tiles aborted while
waiting for an upload: with WPE's 85-200 ms frames here, 3 tiles ahead is up to 0.6 s of backlog;
at 60 Hz it is 50 ms. `DECODED_AHEAD_MOVING` 2 saved little more here (125 against 139) and leaves
an iPhone's 1-per-frame upload less margin. In 40 s of CDP-touch gestures no frame found the
upload queue empty while decodes waited (cap 3 and 6 alike). First crisp unchanged (Chromium
100 Mbit / 10 ms 610-732 against 611-733, 15 Mbit / 50 ms 1055-1062 against 1017-1043; cold local
555-714 against 589-723; WebKit 651-706 against 640-765).

**A finger counts as moving** (`busy()`, `// === FINGERS ===`). A touch that catches a moving map (a
fling's inertia, an ease) makes MapLibre stop the camera: `moveend` fires at once with `isMoving()`
false, and `movestart` only once the finger passes the pan tolerance, 2 frames later. Everything keyed
on `isMoving()` read those frames as still, so the `moveend` released the whole paced decode queue,
uploads went `UPLOADS_STILL` per frame, and the view was written, in the frames before the drag: the
"fling, catch, keep dragging" motion (round-4 hunter: catch frame 3-4 uploads and 2-17 decodes posted in
WebKit, 4+4 uploads in Chromium; every other moving frame ≤ 1 upload). Now a count of the touches that
began inside the map (capture listeners on the canvas container, `e.touches` filtered by target, so a
finger on the card is not one) makes upload pacing, decode pacing, `whenStill` and the view write treat
a finger as movement; the last finger lifting from a map that is not moving (`onFingersOff`: a catch
with no drag, a tap, a finger that rested) lets the held work go at once, and a drag ends in MapLibre's
own `moveend`. Measured (the hunter's harnesses, 6 places each): catch frames ≤ 1 upload and ≤ 1-2 decodes
posted in WebKit and Chromium; decoded but never uploaded from a flick's release to the next idle, with a
catch, WebKit 25 of 178 and Chromium 26 of 183 (hunter, before: 51/227 and 44/229), from rest 16/116 and
22/102. The cost: a finger resting on a still map sharpens at 1 upload per frame (measured: 1 per
frame while it rests, then 3-4 per frame from the frame after it lifts). Finger changes inside a gesture
fire no `moveend` and were already paced. A mouse that catches inertia on a desktop is not counted.

**The first view's decodes.** The EARLY preloads' bytes were all in at 66-154 ms (WebKit, cold), but
MapLibre asked for its first tile at ~256 ms and its last at ~400-436 ms, so the 24 decodes started
only then (round-4 hunter). Now `installTileLoader` (default loader, workers up) sends each preload to a
decode worker as its bytes arrive, during MapLibre's start-up, and keeps the pixels' promise per tile
path (`PREDECODED`); the protocol handler takes them straight to an upload slot, skipping the decode
slot. A failed pre-decode takes the normal path; what MapLibre never asks for is dropped at the first
idle. A/B against the round's start (cold cache, interleaved, 10 runs): WebKit first idle 528-732 ms,
median ~610, against 649-796, median ~710; Chromium unchanged (local 281-364 against 289-326; 15 Mbit /
50 ms 681-701 against 696-730). 24/24 tiles loaded, no errors, both sides.

**The backdrop** goes through a second protocol, `dndimg://` (`IMAGE_PROTOCOL`), with the same
fetch and decode: WebKit decodes `createImageBitmap(blob)` on the main thread, and the backdrop
was the one image left there (a 37-79 ms main-thread stall within ~50 ms of the first crisp view
in WebKit here; Chromium decodes off-thread). The worker hands back straight (not premultiplied)
pixels, and only while the view is still (`whenStill`) the page makes them a main-thread
`ImageBitmap` (`createImageBitmap(ImageData)`, 0-8 ms in WebKit, ~2 ms in Chromium, once): an image
source has no premultiply switch, so raw pixels would be premultiplied by MapLibre's JS loop
(3-9 ms, 4.7 MB). That bitmap is **not** closed: MapLibre keeps it as the image source's `image`
and uploads it in a later render (`ImageSource.prepare`, ~4.5 MiB); the 1600 × 731 upload is the
largest single one. After a WebGL context restore MapLibre asks for it again (one more worker
decode). `?imgpath` keeps MapLibre's own image load.

`whenStill` resolves at once while the view is still and no finger is on it; else once the view has
stopped, the last finger has lifted **and the tile layer has its tiles** (`map.isSourceLoaded("tiles")`, checked at `moveend` and after each
render), in a task of its own; or `STILL_FALLBACK_MS` after a `moveend` if the view is still
stopped then (tiles that never load). It used to wait for MapLibre's `idle`, which waits for every
source, the backdrop included, and the backdrop was itself waiting here: a gesture started before
the backdrop arrived held the backdrop, every idle, the tap data and the `?perf` settle reading off
until the fallback ran out (round-3 hunter, WebKit, a drag from the first idle: backdrop exactly
3.0 s after `moveend` in 3/3 runs; five gestures 1.2 s apart: no idle after the first two). Now,
the same harness: backdrop 150 ms after `moveend` (or before the drag moved anything), idle
160-200 ms after it, an idle after every one of five gestures.

**Draws per frame.** The style has no background layer. It drew nothing visible (the canvas is
transparent, `alpha` and `premultipliedAlpha` true, and the page behind it is the same colour:
round-2 hunter, screenshots with it hidden byte-identical in both engines at the whole map, a corner
and level 4; painted red, they differ), yet each frame it ran a second `coveringTiles`, 1-4 more
draws, 11-12 % of render JS and 12-15 % of per-frame garbage (~23 KB), and one blended fill of the
whole 3× drawing buffer. Now 5 views are byte-identical to `?imgpath` (the old style was 1 level off
on 841 edge pixels in Chromium). An opaque canvas (`alpha: false`) would need it back: transparent
clears would show black.

**Why the default is `worker`** (Playwright WebKit, Linux WPE, software GL, a shared 2-core box;
none of it is an iPhone; measured while the worker still transferred `ImageBitmap`s):

| | img | bitmap | worker |
|---|---|---|---|
| Settle: worst main-thread gap in the 400 ms after each of ~55 scripted gestures over 120 s (median / p90; gestures over 16 ms), two runs (worker: three) | 67-68 / 96-99 ms; 38-40 of 54-56 | 6-7 / 112-120 ms; 9-11 of 54-56 | 5-8 / 88-114 ms; 10-16 of 53-56 |
| Settle: longest gap in the 2 s after release, 4 gestures (`perf.mjs`) | 62-97 ms in all 4 | 10-15 ms in 3, 290 ms in 1 | 9-12 ms in 3, 95 ms in 1 |
| Texture upload per tile, median / over 16 ms | 2 ms / 0 of 561-610 | 9 ms / 194-206 of 485-528 (decode happens at upload) | 2 ms / 13-16 of 412-456 |
| First crisp view, cold cache, local server, 4 loads (WebKit) | 410-515 ms | 648-1005 ms | 643-696 ms (737-1089 with one worker) |

Memory did **not** separate them here. The review saw the `img` path's web process grow ~0.7 MB
per tile load and never shrink (586 → 1096 MB in 120 s) while the bitmap path levelled off. With
`maxTileCacheSize` 32 in place, two 120 s runs here gave: run 1, `img` flat at 860-950 MB while
`bitmap` and `worker` (bitmaps not yet closed) swung up to 1.6 GB and 1.4 GB before a GC brought
them back to ~900; run 2 (bitmaps closed), all three climbed steadily by ~4 MB/s to 1.26-1.37 GB;
a third `worker` run ended its web process at 810 MB. Linux WPE's memory is not iOS's, and the box
was shared, so memory is left to the device. What did separate them is the settle: `img` left a
60-100 ms main-thread gap after almost every gesture, `worker` after about one in five. The cost
is the first crisp view: ~200-250 ms later than `img` in WebKit here, ~100-300 ms in Chromium
(below), because the first view's 24 decodes queue behind MapLibre's start-up on two cores.
**The on-device check decides**: `?perf`, then `?perf&imgpath`, then `?perf&bitmap`, each with
3 minutes of pinching (Open questions).

**The garbage of raw pixels** (round-3 hunter): every `worker` decode brings ~1 MiB of pixels to the
main thread as an `ArrayBuffer`, garbage after its upload. WebKit's web process swung by 400-500 MB
before a collection (623 → 1128 MB in 30 s, 501 decodes, then 726), with live textures flat at
89-95, so it is buffers waiting for the GC. Chromium ran **7× the major GCs of `?imgpath`** over the
same ~95 s mix (21 MajorGC and 482 marking steps against 3 and 37), almost all within 250 ms of a
frame, each freeing next to nothing of a ~7 MB JS heap: external-memory (ArrayBuffer) triggered.
Transferring each buffer on to a sink worker after its upload did not help (V8 counts the arrival).
Decode pacing removes the decodes that were never uploaded; what remains scales with uploads
(Chromium, 60 s of gestures: 12 MajorGC for 109 uploads against 17 for 149 before, the same ratio).
iOS has JSC and a jetsam limit, not this; whether it reloads the tab is the device A/B above. The
levers left if it does: fewer arrivals per tile (a worker filling a reused buffer, or transferred
`ImageBitmap`s again if `?perf` says "worker bitmaps ok" on the iPhone).

**Decode is main-thread work** in WebKit on both of MapLibre's own paths: `<img>` decodes inside
the texture upload, and WebKit's `createImageBitmap(blob)` decodes on the main thread (24
concurrent decodes blocked it for up to 46 ms in a microbenchmark here, 4 ms in Chromium). Only
the `worker` loader moves decode off the main thread. Each tile is its own task, so the settle
gate (Acceptance) is per task. Even there, WebKit here does not start a worker's
`createImageBitmap(Blob)` while the main thread is busy (0 of 16 decodes finished during an 800 ms
main-thread block; Chromium 16 of 16; round-4 hunter): the decode still runs off the main thread, but
it waits for a free moment. `ImageDecoder` in the worker instead made the first idle slower (881-992
against 621-752 ms) and the idle frame varied from run to run, so it is not used.

**Texture memory.** `maxTileCacheSize: 64` (`TILE_CACHE_TILES`) and a spare-texture pool of 24
(`TEXTURE_POOL`, MapLibre's `Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET`, default 50, which never
shrinks). MapLibre's default out-of-view cache on a 390 × 844 phone is 120 tiles; at 1.33 MiB per
512 px tile (a full mip chain) the review measured 150-153 live textures, 203-207 MiB, never
freed. The first cap was 32, but a zoom in and back out at the same place then reloaded 13-22 of
the 24 start tiles (48: 6; 64: 0; hunter, WebKit `easeTo` 2 → 4.42 → 2), and those loads were
exactly the uploads in the zoom-out settle. 64 keeps the start view; the pool cut to 24 pays for
it, so the worst case, (in view ~24-40 + 64 + 24) × 1.33 MiB ≈ 150-170 MiB, stays near the old
(in view + 32 + 50). Revisited tiles beyond that come back from the HTTP cache (force-cache).

## Resize and context loss

- **Resize.** MapLibre's own `trackResize` calls `map.resize()`, which stops the camera: a
  viewport change mid-pinch (rotation, Safari's bottom bar) froze the zoom where it was (review:
  WebKit stuck at z 4.115 against 4.737 without the resize). The viewer sets `trackResize: false`,
  watches `#map` with a `ResizeObserver`, and while `map.isMoving()` defers `map.resize()` to the
  next `moveend`. The canvas keeps its old size until the gesture ends. The document itself cannot
  scroll (`scrollHeight` = `innerHeight`, `touch-action: none`, `overscroll-behavior: none`), so
  this is rare. A callback for the size the canvas already has is skipped: the observer always
  fires once on `observe`, and that `map.resize()` re-sized the canvas (clearing its drawing
  buffer), fired a movestart/moveend (a "gesture" in `?perf`) and wrote the hash before any input.
  Now the boot makes MapLibre's own 2 canvas writes and no move events, and a rotation still
  resizes (both engines).
- **WebGL context loss.** MapLibre restores a lost context itself (442 ms in WebKit, 1.1 s in
  Chromium here; the out-of-view cache is empty afterwards). If iOS drops the context while the tab
  is in the background and never restores it, the map would sit frozen on its last frame: on
  `webglcontextlost` the viewer starts a `CONTEXT_RESTORE_MS` timer, and on that timer or on
  `visibilitychange` to visible, a context still lost (`gl.isContextLost()`) writes the view to the
  hash and reloads the page.

## Taps

**Data.** `data.json` loads after the first idle, or at once if a tap comes first. It is parsed
with `JSON.parse` (3.3-4.1 ms in Chromium, 6 ms in WebKit here; 13 ms at 4× CPU throttle, 22.5 ms
at 6×) and the cell sites go into a bucket grid (16-unit buckets, ~5 sites each) built in slices of
at most ~8 ms (one 2.0-2.5 ms slice in Chromium; 6-10 ms total in WebKit, in one or two slices).
The parse and each grid slice wait while the view moves (`whenStill`: until the view has stopped
and the tiles are in, Tile loading): a
download that finished mid-pinch (a phone link; `data.json` delayed 1.2 s here) used to parse
inside the pinch, 7-14 ms in WebKit. A tap sets `tapWaiting`, which releases the wait at once.
The nearest site in that grid is FMG's `findCell`: 500/500 seeded random points agree.

**Which taps count.** MapLibre's `click`. A touch tap's card waits `TAP_DELAY_MS`; it is dropped
if a zoom starts first, if a second tap falls within MapLibre's double-tap rule (500 ms, 30 px),
and a card already shown closes when a zoom starts from a touch that began within 500 ms of its
tap (a slow double-tap). Times are event timestamps, as MapLibre's own. A mouse click shows the card
at once (1.4-3 ms after the click).

**What is picked**, at level n = clamp(round(Z + log2 dpr) − zOffset, 0, maxLevel) — the level
MapLibre is drawing:

1. The topmost `hits[n]` box containing the point (last in paint order). A marker box is its pin's
   bounding box, whose corners are empty in FMG's own hit test, so a marker counts only inside the
   ellipse inscribed in its box.
2. Else the burg or marker drawn at level n whose nearest box in `hits[n]` (label, icon or pin;
   zero inside, else the distance to the rectangle) is within `NEAR_PX` CSS px; of equal
   distances the topmost. Distance is to the boxes, not the site: a label sits to one side of its
   own burg, so a tap just off a label's edge used to land nearer another burg's site (3 of 8 such
   misses in the review picked a neighbour).
3. Else the nearest cell: off the map or ocean closes any card; a lake gives a lake card (its name,
   if any); land gives an area card.

Map labels (state, region, added labels) are not tappable: a tap on a burg under a state label
picks the burg, where FMG's editor would pick the label.

**The card** (textContent only; nothing from data is ever parsed as markup):

| Kind | Content |
|---|---|
| Burg | name; "Capital of <state>" or "<Group> (<type>)"; population with thousands separators; culture; state full name (or "No state"); province if any; "City map" (`burg.link`, new tab, `rel=noopener`) when present |
| Marker | icon + name, or icon + the type in words ("★ Party visited"); the type under a name; the legend as plain text (HTML in a note is reduced to its text with an inert `DOMParser`) |
| Lake | the lake's name and "Lake", or just "Lake" |
| Area | state full name or "No state"; province; culture; religion; biome; river name and type if the cell has one |

It is a bottom sheet under 600 px wide (over the safe area, at most 45 % of the height) and a
300 px panel top-left otherwise; a close button, Escape, a tap elsewhere (replaces it) or an ocean
tap close it. It is a sibling of `#map`, fixed: a drag that starts on it does not move the map, a
drag anywhere else does, and the canvas never resizes for it. A yellow ring (`RING_PX` inner
radius, `RING_STROKE_PX` wide) marks the picked burg's site or marker's point. It is a **custom
WebGL layer**: one quad at `map.project(point)` drawn while a card is open, added on a pick and
removed on close; its program is built once per GL context. It used to be a GeoJSON circle layer,
which needs MapLibre's worker: with that worker terminated (as iOS may do in the background) the
source never loaded, so there was no ring and `idle` never fired again (hunter, both engines); and
while a card was open the source added its own `coveringTiles` and draws to every frame and loaded
a worker tile at every zoom crossed. A custom layer has no source and is not serialized, so the
style MapLibre rebuilds after a context restore comes without it, and `style.load` adds it back only
if a card is open (a card closed while the context was lost used to leave its ring on the restored
map). Tested across `WEBGL_lose_context` in both engines: ring back with the card open, none after a
close during the loss.

**Per-frame work.** The tap code adds no move handler: `click`, `zoomstart` (once per gesture) and
a passive capture `touchstart` that stores a timestamp. A drag with the card open made 0 DOM
mutations. With a card open, the ring adds one draw call and one `map.project` per frame.

## Stale guard

The tiles are cut from one `rugby.map`. After the first idle, one `HEAD ../dnd-map/rugby.map`
(`cache: no-store`) reads Pages' ETag `W/"<mtime hex>-<size hex>"` (strong form also accepted;
live: `"6ac17efd-4c6201"`, 0x4c6201 = 5,005,825 = `meta.mapBytes`). The ETag is read only when the
response says `Server: GitHub.com`: Express / serve-static (VS Code Live Server) send
`W/"<size hex>-<mtime hex>"`, the other way round, and read as Pages it sent the viewer to the
editor. Any other server, ETag shape, error, or no ETag skips the check.

If the size differs from `meta.mapBytes`, the page's own `meta.js` may simply be an HTTP-cached
copy (Pages sends `max-age=600` on everything, and `meta.js?v=4` keeps its URL across map
versions) from before new tiles landed. So `meta.js` is fetched once more with `cache: "reload"`
(past the cache, and stored in it); if that copy's `mapBytes` matches the live size, the page
reloads onto it, at most once per map size (`sessionStorage` `dndView.staleReload`). Otherwise a
note says "The map was updated - opening the full version" and the page goes to
`../dnd-map/?edit` after `STALE_NOTE_MS`. So a map saved and pushed without new tiles sends
players to the editor until the tiles catch up, and a player who loaded the page in the 10 minutes
before new tiles deployed lands on the new tiles instead.

## Service worker

**Inert on the live site.** Both live hosts are http only: `https://pnutsuxnuts.com` presents
GitHub's `*.github.io` certificate, and `unsetbit.github.io` redirects to `http://unsetbit.com`.
Service workers exist only in a secure context, so today `sw.js` never registers, and repeat
visits rely on the HTTP cache: `force-cache` for the `?r=` URLs (Tile loading), Pages'
`max-age=600` plus ETag revalidation for the rest. It would start working if the owner turns on
**Enforce HTTPS** for the custom domain.

What it does where it can run: `sw.js`, scope `dnd-view/`, registered only on https in a secure
context. Cache-first for same-origin GETs under `libs/` (versioned paths; cache **`dnd-view-8`**)
and under `t/` **only with an `?r=` query** (the content hash, so the URL is immutable even when a
re-render keeps the map hash; one cache per tile version, `dnd-view-4/t/<hash>?r=<rev>`), whole
200 basic responses only, no Range requests, writes held by `waitUntil`. The first tile request
of a worker's life deletes the caches of every other tile version (one map is ~38 MB): one
`caches.keys()` over cache names. It used to scan every cached tile request (`cache.keys()`)
each time the worker restarted, and in WebKit a tile's `cache.match` waited behind that scan.
Everything else (index, meta.js, viewer.js, the HEAD) goes to the network. `activate` deletes
every other build's `dnd-view-*` caches. **Bump the cache name with the build number.** (FMG's `versioning.js` clears every cache on the origin when its
version changes, this one included; harmless.)

## Build number and the Action

The viewer shares the map build number with FMG (`DND_MAP_BUILD` in `dnd-map/main.js`):
**4**. On any user-facing viewer change, bump together: `meta.js?v=`, `viewer.css?v=`,
`viewer.js?v=` and the "map build N" label in `index.html`, and `CACHE` in `sw.js`.

The `dnd-tiles` workflow runs on pushes to `master` touching `dnd-map/**`, `map-build/**`,
`dnd-view/t/**` or `dnd-view/meta.js` (and by hand, with a **force** input). `--check` first: the
map hash and size, the renderer hash (build script, lockfile, fonts, FMG), every file present,
and the content hash `rev`. Only if that fails does it `npm ci`, install Chromium and build (6-10
min). Every run then prunes other 12-hex tile directories, re-checks, and commits
`dnd-view/meta.js` + `dnd-view/t` back as `github-actions[bot]` if anything changed. See
[deployment.md](deployment.md) for when it actually runs.

## Constants

| Constant | Value | Why |
|---|---|---|
| `labelDpr` | 3 | Labels baked for the audience, 3× iPhones. On a 1× desktop at low zoom they look ~3× FMG's size. |
| WebP quality | 0.85 | 36.8 MB for the pyramid; the colour profile is stripped (−7 %). |
| `MAX_S` | 20 CSS px/unit | Deepest zoom; level 5 is 32 device px/unit, so 20 at 3× is mild overscale. |
| `RASTER_FADE_MS` | 0 | A crisp tile replaces its parent at once; a fade keeps MapLibre rendering frames after the settle. |
| `MAPLIBRE_WORKERS` | 1 | Raster tiles never use MapLibre's workers (they decode on the main thread, or in the `?worker` loader's own worker); each extra worker re-imports the 148 KB (gz) shared bundle. |
| `TILE_CACHE_TILES` | 64 | `maxTileCacheSize`: MapLibre's out-of-view cache, default ~120 tiles on a phone (≈ 270 MiB of textures with the pool). At 32 a zoom in and back out reloaded 13-22 of the 24 start tiles; at 64, none (Tile loading). |
| `TEXTURE_POOL` | 24 | MapLibre's spare-texture pool (`Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET`, default 50, never shrinks): cut so the cache at 64 keeps the worst case near the old 32 + 50, ≈ 150-170 MiB. |
| `UPLOADS_MOVING`, `UPLOADS_STILL` | 1, 4 | Decoded tiles handed to MapLibre (one synchronous upload + mipmap each) per frame while the view moves or a finger is on it / is still; the first view is not capped (Tile loading › Upload pacing, A finger counts as moving). |
| `DECODED_AHEAD_MOVING` | 3 | While the view moves, decodes in flight + decoded tiles waiting for an upload slot stay under this (Tile loading › Decode pacing): uploads go at 1 per frame, so a deeper queue is thrown away when MapLibre aborts a level. 3 keeps an iPhone's 1-per-frame upload fed with ~2 decodes of margin (no frame here found the upload queue empty while decodes waited); 2 saved little more. No cap while still. |
| `IMAGE_PROTOCOL` | `dndimg` | The backdrop's protocol: decoded in the decode workers, made a main-thread `ImageBitmap` while still, never closed (MapLibre keeps it). |
| `DECODE_STALL_MS` | 1000 | A decode worker with work and no message this long, page visible, is replaced (iOS may kill a backgrounded page's workers silently). A decode takes 5-50 ms; a first view's queue of ~12 per worker still answers every few tens of ms, so 1 s of silence is death, and a false alarm only re-posts a few jobs. |
| `DECODE_RESPAWNS` | 3 | Replacements in a row, none of them answering, before decoding moves to the main thread for good: a worker that fails on every start must not loop. Any answer resets the count, so separate background kills (one per lock or app switch on iOS) never add up to it; the replacement on returning to the page is not counted. |
| `FETCH_RETRY_MS` | 1000 | A tile, backdrop or `data.json` fetch that failed outright (no response) is tried once more after this: MapLibre never asks for an errored image source again, so one blip lost the backdrop for the session. |
| `STILL_FALLBACK_MS` | 3000 | `whenStill` stops waiting for the tile layer this long after a `moveend` (the view still stopped): its tiles normally land within 0.2-2.5 s here; only tiles that never load reach it. |
| `fadeDuration` | 0, with the placement skip | No symbol fades exist. 0 alone makes MapLibre start a full symbol placement every frame (two `CollisionIndex` grids, ~4,000 empty arrays at 390 × 844): `tuneMapLibre` skips placement once one exists and no layer is a symbol layer. 300 instead would leave a stale placement repainting for up to 300 ms after each gesture. |
| `CONTEXT_RESTORE_MS` | 3000 | A lost WebGL context MapLibre has not restored by then (it takes 0.4-1.1 s here) reloads the page, once visible. |
| `DECODE_WORKERS` | 2 | The `worker` loader's decode threads: a first view decodes ~24 tiles at once; one worker took the WebKit first crisp view to 737-1089 ms, two to 643-696 ms here. |
| `TILE_PROTOCOL` | `dndtile` | The custom protocol of the `bitmap` and `worker` loaders. |
| `BOUNDS_INSET` | 1e-3 units | An edge on a tile boundary must not request the next tile. |
| `HASH_WRITE_MS` | 400 | At most one `replaceState` (and `localStorage` write) per 400 ms (iOS throttles them); a write whose time comes while the view moves or a finger is down waits for that gesture's end (pans every 400 ms put 10 of 12 writes mid-gesture in Chromium; now 0 of 12, both engines). |
| `STALE_NOTE_MS` | 1500 | Time to read the note before the editor opens. |
| `TAP_DELAY_MS` | 250 | A double-tap's second tap normally lands inside it, so no card flashes. |
| `DOUBLE_TAP_MS`, `DOUBLE_TAP_PX` | 500, 30 | MapLibre's TapRecognizer: a second tap this soon and near is a zoom. |
| `TOUCH_CLICK_MS` | 800 | A click this soon after a touchstart came from a finger. |
| `NEAR_PX` | 22 | The forgiveness radius for a finger that misses a small icon or a label, measured to the nearest box. |
| `HIT_SCALE` | 10 | `hits` boxes are map units × 10 (the build's `HIT_SCALE`); 0.1 unit is 0.03-1.1 CSS px across levels 0-5 (s = K). |
| `CELL_SCALE` (build) | 100 | `cells.x/y` are map units × 100, exact (FMG stores 2 decimals): nearest site = `findCell` 500/500. |
| `WATER_H` | 20 | FMG's rule: a cell below height 20 is water, so an ocean tap (no card) rather than an area card. |
| `HASH_DECIMALS` | 2 | `#s/x/y` precision: 0.01 units is under 0.2 CSS px even at `MAX_S`. |
| `PERF_HUD_MS`, `PERF_LONG_FRAME_MS` | 250, 34 | `?perf` only: the HUD text is rewritten at most every 250 ms and never mid-gesture; a frame interval over 34 ms (two 60 Hz frames) counts as dropped. |
| `GRID_UNITS` | 16 | ~5 sites per bucket; a lookup visits 1-2 rings (0.075 ms per pick here). |
| `GRID_SLICE_MS` | 8 | Grid build tasks stay well under a 16 ms frame. |
| `RING_PX`, `RING_STROKE_PX`, `RING_RGB` | 14, 3, `#ffd23f` | Visible on land, sea and the pale card colours; the stroke lies outside the radius, as MapLibre's circle stroke did. |
| sw `CACHE` | `dnd-view-8` | Follows the build number. Inert on the live http-only hosts. |
| `MAX_S`, `VIEW_KEY`, the loader, the hash parser | | Defined once, in `index.html`'s EARLY script (`window.DND_CFG`); `viewer.js`'s config block reads them. |

## Acceptance

What can be proven off-device (Playwright 1.63.0 Chromium and WebKit, 390 × 844 @ 3 with touch,
software GL, a 2-core box shared with other work at load 3-7). Re-measured after the review fixes
on a Pages-like local server (gzip, `W/"mtime-size"` ETags, `max-age=600`, `Server: GitHub.com`):

- **Player path:** no FMG JS, no GET of `rugby.map`: the only request to `dnd-map/` is the HEAD.
- **Gestures, target < 4 ms main thread per frame in Chromium:** 0 DOM mutations in every gesture
  in both engines once the backdrop is drawn (before it, the LQIP's one transform per frame: Load ›
  The LQIP follows the camera). (One exception outside gestures: each programmatic camera call, `jumpTo` or
  `easeTo` (a hash change, a double-tap zoom), makes MapLibre's box-zoom handler rewrite the map
  container's `class` to the same value, `classList.remove` of a class it does not have: one
  mutation record, no style change. A touch drag makes none. Box zoom (shift-drag on a desktop) is
  kept.) Main-thread busy time between animation frames (CDP touch, 60-move pinch,
  drag, pinch-in; the harness's own CDP tasks included) median 3.5-4.7 ms, p90 8.7-15.7 ms
  (25-35 ms for a pinch started at the first idle, while data.json loads), the same within noise
  for all three loaders (img 3.3-4.1 / 8.6-29, bitmap 3.6-3.9 / 9.1-15.7). Stream
  B1 measured median ≤ 1.4, p90 4.1-5.2 ms with a different breakdown. **The median meets the
  target only in B1's breakdown and the p90 misses it in both**; the worst frames (0.2-12 s) are
  the main thread waiting on the saturated SwiftShader GPU process (B1: 1.9 s in
  `CommandBufferProxyImpl::WaitForToken`). rAF intervals here measure that software rasteriser,
  not the viewer: Chromium 200-270 ms, WebKit 73-120 ms per frame for every loader alike.
- **Settle, target no main-thread task > 16 ms after a gesture ends:** Chromium, longest task in
  the 2 s after release 0.7-4.8 ms (every loader). WebKit has no long-task API; a MessageChannel
  gap probe shows the default `worker` loader at 9-12 ms after 3 of 4 gestures and 95 ms after one
  (`img`: 62-97 ms after all 4); over 120 s of deep pinching, median 5-8 ms, p90 88-114 ms (Tile
  loading). **Not met in WebKit here**; the iPhone decides.
- **Load, target first crisp view ≤ ~0.6 MB:** 31 requests, 888 KB before the first idle
  (MapLibre 294 KB, 24 level-2 tiles 574 KB, the rest 20 KB). **Over the target**; the tiles now
  start 57-120 ms after navigation (127-348 ms before the EARLY preload). First crisp, Chromium,
  cold cache, throttled: 777 / 1139-1212 / 701 ms at 30 Mbit 30 ms / 15 Mbit 50 ms / 100 Mbit
  10 ms (`?imgpath`: 649 / 867-920 / 580; before this round, with `img`: 767 / 872 / 648). The owner's 1 s is missed at 15 Mbit with the default
  loader. LQIP before MapLibre: 59-128 ms.
- **Texture memory:** live textures plateau at 64-67 (88-93 MiB) in both engines over 60-120 s of
  deep pinching, against 150-153 (203-207 MiB) before `maxTileCacheSize`. With the cache at 64 and
  the pool at 24 (48 scripted jumps and eases over every level, Chromium): 85-89 live, peak 91
  (124 MiB), against 67 (92 MiB) at 32 + 50 in the same script; the pool held 2-22 textures.
- **Round-1 hunt fixes, re-measured** (A/B against the round's start, the same harnesses, `:8784`):
  - *Per-frame garbage* (300 `map.redraw()` with a moving camera, GC held off, after a card was
    opened and closed): 162-204 KB per frame against 315-360; median render 0.2-0.4 against
    0.3-0.5 ms. `GridIndex` (`$o`) is gone from the gesture heap profiles' top sites. Scavenge
    counts in the CDP traces do not separate (the harness's own allocations dominate them).
  - *Uploads* (Chromium, wall-paced synthetic pinch): at most 1 per frame while moving, every
    gesture ending `map.loaded()` with the full top level. WebKit, zoom-in pinch 2 → 4.42: 27
    uploads during the gesture against 44-45, at most 1 per frame interval against 4, 0 of 39
    intervals with 2+ against 14-16; 12 tiles then finish after release at ≤ 4 per frame (idle
    643-723 against 411-417 ms). Zoom-out 4.42 → 2.09: 0 uploads after release against 14-16
    (the 64-tile cache), idle 442-559 against 945-1011 ms, worst gap 25-41 against 114-200 ms.
    WebKit's worst gap after the zoom-in grew (117-191 against 13-14 ms) for a reason of this box:
    WPE's software GL makes the first GL call after a frame wait for that frame's rasterisation
    (an upload right after a frame took ~80 ms, the same upload ~90 ms later 1-2 ms; unpaced
    uploads simply landed after it), so the post-release uploads absorb the rasterising of their
    frames. A real GPU rasterises off the main thread; `?perf&nopace` on the device settles it.
  - *Chromium traces* (CDP touch, 60 moves; busy time per frame, the harness included): pinch
    p90 13.1 against 23.4 ms, pinch-in 13.4 against 19.3, drags the same within noise (median
    3.5-4.5 both); longest task in the 2 s after release 0.6-2.2 against 0.7-4.2 ms. 0 DOM
    mutations in every gesture.
  - *First idle, WebKit*: no main-thread `createImageBitmap` left (the backdrop's took 37-79 ms
    of main thread before); worst gap within 400 ms of the first idle 29-106 against 40-108 ms
    (the box is noisy; the structural change is the decode moved). First crisp unchanged:
    WebKit 631-789 against 644-830 ms; Chromium 236-265 against 247-274 ms local, 585-630
    against 590-608 ms at 15 Mbit / 50 ms; 31-32 requests and the same bytes before it.
  - *Ring*: MapLibre worker messages after a card was opened and closed, three gestures: 0/0/0
    against 13/4/2. A new pick after a close draws the ring at the new place 2 frames later and
    never at the old one.
  - *data.json*: delayed 1.2 s with a pinch from the first idle, its parse ran inside the pinch
    in 2/2 runs before; now 0/2, at the next idle after release (5 ms).
  - *Revisit* (server `max-age=20`, Chromium, 12 far views and back, which outlasts 20 s): 0 tile
    requests at the server and all 18 tiles loaded from the cache, online and offline; before,
    18 full re-downloads on each return. (The hunter's offline case, 18/18 errored before, was
    not reproduced here: offline, the far views failed to load and so never evicted A.)
- **Round-2 hunt fixes, re-measured** (`:8784`, the same box; A/B against the round's start by
  serving the old `viewer.js` and `index.html`):
  - *Wrong tiles* (frame vs tile files, per tile, WebKit): a 1.5 s animated zoom 0/10 runs with a
    wrong tile (3/6 before), a still jump to `#6/881/138` 0/10, `?bitmap` 0/4, the deepest zoom
    reached from the whole map 0/5 jumps and 0/5 eases; Chromium 0/4 and 0/4. The micro-repro
    (one worker, 36 transferred bitmaps) still shows WebKit's bug: 88-105 of 108 wrong.
  - *Picture*: 5 views (whole map, three edges, level 4) byte-identical to `?imgpath` for both
    protocol loaders in both engines.
  - *Per frame* (Chromium, 300 `jumpTo` + redraw, two loads each): draws 30 against 34 at level 4
    and 10 against 11 at the whole map; garbage 170 against 194 KB per frame at level 4 and 120
    against 130 at the whole map; with a card open 167 against 217 and 120 against 141 (the
    GeoJSON ring's source is gone); JS busy per frame the same within noise (0.85-1.46 against
    1.08-1.36 ms).
  - *Chromium CDP-touch traces* (busy time per frame, the harness included; two runs each): pinch
    median 3.4-4.0 against 3.6-4.9 ms, drag 2.5-3.6 against 3.9-4.3, pinch-in 3.3-4.3 against
    4.3-5.0, p90 8.0-12.2 against 10.0-13.9; longest task in the 2 s after release 0.7-6.5 against
    0.5-4.5 ms, none over 16. 0 DOM mutations in every gesture.
  - *WebKit gap probe*: during gestures the worst gap equals a WPE frame (61-211 ms, both). After
    release, see Tile loading › What WebKit here can and cannot say: renders with raw textures
    block WPE's main thread ~85 ms each, so the drag settles read 54-109 ms against 5-26 ms, the
    pinch settles 78-229 against 93-119. Raw uploads 0-1 ms each against 71-91 ms.
  - *First load*: 31-32 requests, the same tiles, no tile requested twice (so
    `setPremultiplyAlpha` lands before the first request). First crisp, Chromium local 285-332
    against 281-320 ms, WebKit 770-832 against 671-921; at 15 Mbit / 50 ms 679-714 against 627-647,
    a gap that matches the old page's head start in this A/B (its HTML is served by the harness,
    unthrottled: LQIP 76-79 against 130-132 ms). `viewer.js` is 4.0 KB larger gzipped.
  - *Dead workers*: decode workers terminated after the first idle, then two jumps and a tap: all
    tiles load, `idle` fires, card and ring show, both engines (before: 15 and 28 tiles loading, 0
    idles); MapLibre's worker terminated: the same (before: no ring, idle stopped). A visibility
    ping replaces killed workers 1.0 s after "visible", before any tile (since round 4 a return
    replaces them outright: Tile loading). A worker that never
    answers: three replacements each, then the main thread; all tiles load.
  - *Context restore with a card open*: the ring is back (2,500 ring-coloured px); closed during the
    loss: none, both engines.
  - *Long session* (WebKit, 120 s, 191 gestures): live textures 89-93, upload queue and still
    waiters 0, web process 820-873 MB, flat (the hunter's bitmap run: 745-863 MB).
- **Round-3 hunt fixes, re-measured** (`:8784`, A/B against the round's start by serving the old
  `viewer.js` and `index.html`; the box at load ~3.4):
  - *LQIP*: tracks the camera to 0 px through a drag, a pinch and a rotation before the first idle
    (tiles delayed 3 s), both engines; before, it stayed at its boot rect.
  - *Backdrop vs idle* (WebKit, drag from the first idle): see Tile loading › `whenStill`.
  - *Decodes*: see Tile loading › Decode pacing. Frame against the tile files, per tile: a still jump
    to `#6/881/138` and a 1.5 s ease from the whole map to s 20, 0/4 runs with a wrong tile in each
    engine. Dead decode workers, and all workers, terminated after the first idle: every tile loads,
    idle fires, the card shows (both engines); a `Worker` that fails to start: main thread, all
    tiles loaded.
  - *Chromium CDP-touch traces* (busy per frame, two runs): pinch median 3.6-5.2 / p90 10.7-14.4 ms
    (old 3.1-4.7 / 10.0-11.6), drag 2.8-3.0 / 7.6-7.8 (2.6-3.5 / 8.3-9.7), pinch-in 3.4-4.9 /
    11.2-18.1 (3.8-5.6 / 11.9-13.7): the same within this box's noise. Longest task in the 2 s after
    release 0.7-9.3 ms, none over 16, except the pinch started at the first idle: 7.8 and 36 ms.
    The 36 ms task is `data.json`'s parse (18.5 ms that run, 4.9 in the other) plus a 9 ms
    incremental GC, now released 0.43 s after that gesture's release; before, the parse waited for
    the 3 s fallback and fell outside the window (Open questions: a worker parse).
  - *WebKit gap probe* (4 gestures): during, a WPE frame (rAF median 87-125 ms, both); after
    release, worst gap 62-129 against 71-125 ms (two runs and one), the WPE raw-texture render cost (Tile loading).
  - *First load*: 31 requests, 897 KB before the first idle (MapLibre 294, 24 tiles 574, the rest
    29); first crisp at 15 Mbit / 50 ms 1055-1062 ms, LQIP 121-127 ms (the A/B's old page, served
    unthrottled by the harness: 1017-1043 / 82-84).
  - *Boot*: no `resize` or move event and no hash write before input (before: one of each in WebKit).
  - *`?perf` HUD*: 0 text mutations during 4 gestures with an `idle` forced mid-gesture.
  - *Taps*: cells 500/500 against `findCell`; burgs and off-centre taps as below.
- **Round-4 hunt fixes, re-measured** (`:8784`, A/B against the round's start by serving the old
  `viewer.js`; the box at load 2-9 with other work):
  - *Catch during inertia*: see Tile loading › A finger counts as moving.
  - *First crisp view*: see Tile loading › The first view's decodes. The first view's tiles-only frame
    (backdrop hidden) is byte-identical to the round start's in both engines.
  - *Workers*: see Tile loading › Decode workers that die (respawn count, restart on return).
  - *Fetch retry*: see Tile loading › Immutable fetches. *View writes*: `HASH_WRITE_MS` (Constants).
  - *Chromium CDP-touch traces* (busy per frame, two runs each): pinch median 3.3-3.7 / p90 9.3-10.8 ms
    (old 3.1-3.9 / 9.7-10.3), drag 2.7-2.9 / 7.8-9.0 (2.9-3.1 / 8.8-9.3), pinch-in 3.4-3.7 / 13.5-15.2
    (3.5-4.5 / 12.1-13.1): the same within noise. Longest task in the 2 s after release 0.9-11.8 ms,
    none over 16, except the pinch started at the first idle: 12.6 and 25 ms (old 7.3 and 23.7), the
    `data.json` parse (Open questions).
  - *WebKit gap probe* (4 gestures, two runs each): during, worst gap 73-130 ms (old 73-193), a WPE
    frame (rAF median 78-128 ms, both); after release 62-118 (64-102). 0 DOM mutations in every gesture.
  - *First load* (Chromium, cold): 32 requests, 896 KB before the first idle, no URL fetched twice.
  - *Long session* (Chromium, 90 s, 27 gestures and jumps): live textures 89-91, decode and upload queues,
    decodes in flight and still waiters 0 at the end, no errors. A WebGL context lost mid-ease and
    restored: every counter back to 0, eases reach idle, no reload (both engines).
  - *Taps*: cells 500/500 against `findCell`; burgs and off-centre taps as below.
- **Taps vs FMG** (`/dnd-map/?edit`, at each level's K, FMG at DSF 3 with the build's fonts):
  cells 500/500 (`findCell`); burgs at their own site 29/30 (level 2), 28/30 (level 4), 30/30
  (level 5), every difference a state or added label over the burg in FMG (not tappable here, by
  design). Off-centre taps (40 objects × 8 points within ±14 CSS px, levels 2/3/4): wherever FMG
  hits a burg or marker, the viewer picks the same one, 18/18, 29/29, 129/129 (9 of them by the
  near rule); the review's three neighbour picks now go to FMG's burg.
- **Robustness:** a malformed hash leaves the view as it was with no error; a lost WebGL context
  that is never restored reloads the page after 3 s onto the same hash, and a context MapLibre
  restores does not reload; a resize mid-pinch no longer stops it (zoom 4.737 at the end, as with no resize; the canvas
  resizes at `moveend`); the stale guard reads Pages (current), skips an Express-style ETag,
  sends a truly stale map to the editor, and reloads once onto a fresh `meta.js` when its own copy
  was the stale one. All in both engines.

**The real gate is the owner's iPhone with `?perf`**: open `/dnd-view/?perf`, pinch, drag and
zoom out to the whole map. The HUD shows per-gesture frames (median, p90, worst, frames over 34 ms),
the settle time and worst settle frame, load marks (LQIP, map, crisp), tiles and bytes (including
the 6 level-1 tiles of the worker-bitmap check), the stale check, long tasks (Chromium only), the
tap-data parse/grid times, `worker bitmaps ok n/6` or `CROSSED n/6`, and a note for each decode
worker replaced. Pass: gestures median ≤ 17 ms and no settle frame over ~50 ms; tap a town, a
marker, land and the sea. **Low Power Mode off:** iOS Safari runs `requestAnimationFrame` at most at
60 Hz even on a 120 Hz ProMotion screen, and at 30 Hz in Low Power Mode, where every frame reads
~33 ms whatever the viewer does.

## Implementation

- `viewer.js` — `boot` (style, `transformConstrain`, handlers), `tuneMapLibre`, `onStyleLoad`, `onFirstIdle`, `addBackdrop`;
  `// === RESIZE ===` `requestResize`, `flushResize`; `// === WEBGL CONTEXT ===` `watchContext`,
  `checkContext`; `// === TILE LOADING ===` `tileTemplate`, `fetchImmutable`, `PREDECODED`, `tileBytes`, `installTileLoader`
  (both protocols, the pre-decode), `rawImage`; `// === FINGERS ===` `busy`, `trackFingers`, `onFingersOff`; `// === UPLOAD PACING ===` `uploadSlot`, `releaseUploads`, `whenStill`,
  `checkStill`, `armStillFallback`; `// === DECODE PACING ===` `decodeSlot`, `decodeDone`, `pumpDecodes`;
  `// === LQIP ===` `followLqip`, `syncLqip`, `dropLqip`; `// === DECODE WORKERS ===` `DECODE_SRC`, `createDecoder` (`decode`, `restart`, `stop`); `// === TAPS: DATA ===` `loadTapData`, `prepareTapData` (sliced grid), `nearestCell`, `pickAt`,
  `inPin`; `// === TAPS: GESTURES ===` `onMapTap`, `onZoomStart`; `// === TAPS: CARD ===`
  `showPick`, `closeCard`, `setRing`, `syncRing`, `RING_LAYER`, `buildRing`; `checkStale`, `freshMeta`;
  `createPerf` (`checkWorkerBitmaps`).
- `syncRing` waits for the style's `load`, not `isStyleLoaded()` (a quick second tap or a close must
  still land); during a context restore's style rebuild `addLayer` throws and `style.load` retries.
- **MapLibre internals the viewer depends on — re-check each on a MapLibre upgrade:**
  `Style.prototype._updatePlacement` (patched by `tuneMapLibre`; its signature and the
  `placement` / `_order` / `_layers` fields), `Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET` (a static,
  set by `tuneMapLibre`; a `?perf` note says when either is missing), and
  `RasterTileSource.loadTile` uploading in the continuation of the protocol's promise (the pacing
  and the main-thread bitmaps' next-task `close` rely on it); the image request passing a
  protocol's `HTMLImageElement` through untouched and `Texture.update` uploading any object with a
  `data` field as raw pixels (`rawImage`: if either changes, every `worker` tile errors, and the
  `?perf` HUD counts the errors); `RasterTileSource.setPremultiplyAlpha` (a `?perf` note if
  missing; edge tiles would then be premultiplied twice); custom layers left out of
  `Style.serialize()` (the ring's context-restore handling). The two tuning hooks fail soft: without
  them the viewer works as before, with more garbage per frame and a larger pool.
- Asset query strings and the label: `index.html`. Card styles: `viewer.css` `=== CARD ===`.

## Open questions

- **Nothing has run on a real iPhone yet.** WebKit here is Playwright's Linux build with software
  GL; Chromium's software GL also dispatches a second tap up to ~770 ms late, so a fast double-tap
  flashed a card for a few hundred ms there (WebKit: no card at 40-200 ms gaps). Confirm on device.
- **Which tile loader** (Tile loading): on the iPhone, `/dnd-view/?perf`, `?perf&imgpath` and
  `?perf&bitmap`, each with 3 minutes of pinching from the whole map to the deepest zoom and back:
  does the tab reload (memory), and which has the smaller settle frames and the faster crisp
  view? Make the winner the default.
- First-load budget: 888 KB vs ~0.6 MB, and 1.14-1.21 s at 15 Mbit with the default loader. Options: a
  smaller default s (~2/3 → ~10 level-1 tiles), biasing the covering level down, or lower WebP
  quality.
- Whether iOS restores a lost WebGL context on its own (the reload fallback is untested on a
  device).
- Headless WebKit's page screenshot can differ from its GL frame (WPE presents the second-to-last frame
  of a non-antialiased canvas: Tile loading) after a jump from the whole map to
  the deepest zoom (a dark smear in the top-left, up to 54k device px; old and new code alike,
  3/3 each), while the GL frame read in MapLibre's `idle` handler matches the tile files: a WPE
  presentation artifact. Judge WebKit pictures by the GL frame, not the screenshot. If the iPhone ever
  shows a stale band after a jump, try `canvasContextAttributes: { antialias: true }` (it costs a
  multisampled 3× drawing buffer).
- **Does iOS corrupt worker-transferred `ImageBitmap`s?** WebKit/WPE here does (Tile loading); the
  `worker` loader no longer transfers them. `?perf` decodes 6 level-1 tiles the old way after the
  first idle and shows `worker bitmaps ok 6/6` or `CROSSED n/6` (WebKit here: CROSSED 4-5/6;
  Chromium: ok). If the iPhone says ok, a transferred bitmap may again be an option, measured
  against raw pixels for settle and memory.
- The faint straight lines at map x = 900 and y = 100 are FMG's own 100-unit ocean-pattern seams,
  baked into the tiles at every level and in both engines.
- **Upload pacing on the device:** `?perf` vs `?perf&nopace`, a whole-map-to-deep pinch and a zoom
  back out: frames over 34 ms during the pinch and the worst settle frame. If the still cap makes
  the settle visibly slow to sharpen, raise `UPLOADS_STILL`.
- Each frame fills the 3× canvas up to twice (backdrop raster, tile raster; the background layer is
  gone, and the canvas composites non-opaque). A GPU fill-rate question only the device can answer;
  the cheap levers would be hiding the backdrop layer once the tiles cover the view, and an opaque
  canvas (which needs a background layer again).
- Do the decode workers die on iOS? After returning from the background, `?perf` notes "decode worker
  n dead on return" (yes) or "alive on return" (not this time); the workers are replaced either way.
- WebKit private browsing (hunter): `maplibre-gl-shared.mjs` (148 KB) was downloaded twice before
  the first crisp view, once by the page and once by MapLibre's module worker. Not reproduced or
  fixed here; check whether iOS Safari's private mode does the same.
- The ring sits at a marker's point (the pin's tip), not around its head.
- `data.json` parse is one task; at 6× CPU throttle it reaches 22.5 ms, and on this loaded box one
  run took 18.5 ms. Since `whenStill` no longer waits out its fallback, a gesture made in the first
  second can have that parse land 0.2-0.5 s after its release. A worker parse would remove it (the
  structured clone back costs main-thread time too: measure before adopting).
- Backdrop overdraw (round-4 hunter, WebKit software GL, a moving frame): nothing 28 ms, tiles only
  66-67 ms, backdrop + tiles 96-97 ms, so the backdrop's raster costs ~0.77× the tile layer's in every
  moving frame, even where tiles cover the view. Not changed: the lever (hiding the backdrop layer once
  the tiles cover the view) needs a coverage test per frame and a style change mid-gesture, and only the
  device's GPU says whether fill rate matters. `?perf` frames over 34 ms during a pinch would point here.
- Mipmaps (round-4 hunter): a tile's mip levels are sampled only in zoom-out frames (by retained
  children drawn smaller: up to 2.5-2.7 M of 2.96 M device px), never in still views, yet every upload
  builds a full chain (`generateMipmap`, +1/3 texture memory). Skipping them would need a MapLibre
  internal and would alias zoom-out frames; left unless the device shows upload cost or memory trouble.
- The backdrop is the full 1600 × 731 picture (267 KB): it downloads in the first second, competes with
  the first zoom's tiles and stays in memory (~4.5 MiB texture), though on a 3× phone it is only a
  placeholder under the tiles. A half-size backdrop (build change) is the lever; on a 1× or 2× screen
  zoomed right out it is the picture itself, so not changed blind.
- MapLibre's own worker starting up costs the first crisp view 46-90 ms here (round-4 hunter), although
  raster tiles never use it; the style needs one, so `MAPLIBRE_WORKERS` 1 is the floor.
- iOS 16.4 is MapLibre 6.12.0's effective floor (static blocks, WebGL2, module workers).
