# map-build — the player viewer's tile pyramid

`build-map-tiles.mjs` drives FMG's own renderer (`dnd-map/index.html?edit`, served from the repo
root on an ephemeral port) in headless Chromium and writes what `dnd-view/` shows to players:

| Output | What |
|---|---|
| `dnd-view/t/<mapHash12>/<z>/<x>/<y>.webp` | 512 px tiles, WebP q 0.85, levels 0–5 (z = level + zOffset) |
| `dnd-view/t/<mapHash12>/backdrop.webp` | the whole map at level 0 (1 px per map unit) |
| `dnd-view/t/<mapHash12>/data.json` | tap data: every cell (sites at map units × `cells.scale` = 100, exact), names, burgs, markers, per-level hit boxes |
| `dnd-view/meta.js` | `window.DND_META = {...}`: hash, geometry, paths, LQIP, background colour, tile counts, `renderer`, `rev` |

`mapHash12` is the first 12 hex of sha256(`dnd-map/rugby.map`), so a new map gets new URLs and
never mixes with cached tiles of the old one. Two more hashes (12 hex each) make the output
self-checking:

- **`renderer`** hashes what draws the tiles besides the map: `build-map-tiles.mjs`,
  `package-lock.json` (it pins Chromium), `fonts/`, and FMG itself (`dnd-map/` minus `rugby.map`).
  `--check` fails when it no longer matches, so a dnd-map patch or a build-script edit asks for a
  rebuild. A rebuild whose bytes come out the same only rewrites `meta.js`.
- **`rev`** hashes the published files (every tile, the backdrop, `data.json`). The viewer adds
  `?r=<rev>` to every tile URL, so a re-render under the same map hash gets new URLs in the HTTP
  cache and the service worker, never a mix of old and new tiles.

Nothing carries a timestamp: the same map, fonts and Chromium give the same bytes (a rebuild of
rugby with the build-4 script wrote 0 of 6,157 tiles).

## Running it

```bash
cd map-build
npm ci                                   # playwright 1.63.0
npx playwright install chromium          # once per machine (--with-deps on a bare Linux box)
node build-map-tiles.mjs                 # full build, levels 0-5 (6-10 min on 2 cores)
node build-map-tiles.mjs --levels 0-3    # quick run; data.json and the backdrop are always complete
node build-map-tiles.mjs --check         # exit 0 if meta.js matches rugby.map and the renderer, and every file has meta.rev's bytes
node build-map-tiles.mjs --prune         # delete dnd-view/t/<12-hex>/ dirs other than meta.js's and the map's
```

`--map <file>` (or `DND_MAP_FILE`) uses another `.map` in place of `dnd-map/rugby.map`, and
`--out <dir>` writes somewhere other than `dnd-view/`. `meta.js` is written only when every tile
of every level exists for the current map, so a partial run never publishes a broken pyramid; such
a run exits **2**, so `build && --prune && --check` stops there. `--prune` keeps both the
directory `meta.js` names and the map's own, and deletes only 12-hex directory names, so a
`--map` scratch run or a partial build never deletes the live tiles.

The `dnd-tiles` workflow (`.github/workflows/dnd-tiles.yml`) runs on pushes to `master` that touch
`dnd-map/**`, `map-build/**`, `dnd-view/t/**` or `dnd-view/meta.js`, and by hand (with **force**).
It runs `--check`; when that fails it builds. Then, every run, it prunes, re-checks and commits
`dnd-view/meta.js` + `dnd-view/t` back to the branch if anything changed (a merge that brought in
another map's tiles is cleaned up even when the tiles are current).

## How a level is drawn

Level n is the map at 2^n device px per map unit, with labels and markers drawn by FMG for zoom
K = 2^n / 3 — what FMG would show a 3× iPhone at that size. The trick: set FMG's global `scale` to
K, call `invokeActiveZooming()`, then give `#viewbox` `scale(2^n)` at deviceScaleFactor 1. Each
2048 px window (4 × 4 tiles) is captured with a 64 px margin, cut into tiles, and every pixel
beyond the map is cleared to transparent (that also drops FMG's stray "Map Rev. 3"). Markers are
baked; their emoji need an emoji font (Noto Color Emoji on Linux) and the build fails if an
emoji-presentation icon falls back to a text font.

Hit boxes in `data.json` are measured in the same page at each level's K: burg label text and
burg icons (kind 0) and marker pins (kind 1), in paint order, in map units × `HIT_SCALE` (10).
`CELL_SCALE` (100) and `HIT_SCALE` are in the script's config block.

## Fonts

FMG asks for two web fonts from `fonts.gstatic.com` (the URLs are stored in `rugby.map`). They are
vendored under `fonts/gstatic/` at those exact paths, each with its SIL Open Font License
(`OFL.txt`), and served to the page by request interception — the build makes no font request to
the network and fails if the page asks for one that is not vendored. `Almendra_SC.css` and
`Gloria_Hallelujah.css` are Google's CSS for the same families (FMG's font picker requests them);
they point at newer file versions that are not vendored, and the current map never requests them.

Comfortaa (burg labels) is declared nowhere, so the build pins it to `local('Liberation Serif')`,
the Times-metric serif an iPhone falls back to. Other text uses whatever the machine's fontconfig
resolves, so tiles built on another OS image can differ in a few glyphs.
