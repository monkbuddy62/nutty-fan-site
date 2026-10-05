# dnd-map — the campaign map

## What it is

`/dnd-map/?edit` is the DM's editor: a self-hosted copy of **Azgaar's Fantasy Map Generator** that
boots straight into one D&D campaign map (`rugby.map`) instead of generating a random world — the
full program, every layer and editor, at a stable URL with no account and nothing to install.

Players do not use it. Plain `/dnd-map/` (no `edit`, `maplink` or `seed` in the query) redirects to
the player viewer at `/dnd-view/` (patch 6), which shows the same map as pre-rendered tiles drawn
by this copy of FMG — see [dnd-view.md](dnd-view.md). FMG's live SVG ran at about 1 fps on an
iPhone; the viewer is what players pinch.

Self-hosted rather than linked to azgaar.github.io because the campaign map has to load
automatically, has to render the viewer's tiles (`map-build/` drives this copy), and has to
outlive whatever upstream does next.

## Provenance

| | |
|---|---|
| Upstream | [Azgaar/Fantasy-Map-Generator](https://github.com/Azgaar/Fantasy-Map-Generator), MIT |
| Version | **1.122.12** (`dnd-map/versioning.js`) |
| Built with | `base=/dnd-map/`; patch 5 makes its two absolute paths relative, so it serves from any path (the fork previews at `/nutty-fan-site/dnd-map/`) |
| Vendored in | commit `67c0862` |
| Size | 636 files, ~30 MB |

`main.js` is loaded with `?v=1.120.5` while `versioning.js` declares `1.122.12`; that mismatch is
upstream's, carried over as-is.

## Local patches

**This list must stay exhaustive.** It is the only record of what separates this copy from upstream,
and the only thing that makes a re-vendor survivable.

### 1. `main.js:313` — auto-load the campaign map

```js
// pnutsuxnuts.com/dnd-map: default to the campaign map when no params given
if (!params.get("maplink") && !params.get("seed")) {
  params.set("maplink", new URL("rugby.map", window.location.href).href);
}
```

Inside `checkLoadParameters()`. With no query string, FMG would generate a random world; this makes
`rugby.map` the default while leaving `?maplink=` and `?seed=` working for anyone who wants
something else.

### 2. `main.js` zoom block — composited gestures

The zoom block (`zoomRaf`, `commitZoom`, `adoptMap`, `padGestureLayer`, `pictureCovers`, the
`GESTURE_*` constants, `gesturePerf`) replaces upstream's `zoomRaf`. Upstream re-transforms
`#viewbox` on every frame of a pinch or drag, which repaints the whole map — ~4,700 SVG nodes —
each frame. Instead:

- **The map slides as one cached picture.** `<div id="gestureClip">` (screen-sized, clips) holds
  `<div id="gestureLayer">` (`will-change: transform`), which holds `<svg id="map">`. While the view
  moves, only `gestureLayer`'s CSS `transform` changes, which the GPU composites with no repaint.
  A transform on the `<svg>` itself does not work: browsers repaint the SVG for it. WebKit keeps
  such a layer's bitmap at its original scale while it scales (`GraphicsLayerCA::
  updateRootRelativeScale` returns early by default), so a pinch is soft until the commit.
- **It carries a margin.** `gestureLayer` reaches `GESTURE_PAD` (1) screen past every edge, with
  the `<svg>` (`overflow: visible`) in its middle, so a drag uncovers map drawn ahead of time. The
  clip must stay: a box sticking out past the screen makes a phone browser widen the page, which FMG
  then reads as a bigger screen (`svgWidth`), breaking the zoom clamp. The margin follows the
  `<svg>`'s `width`/`height` through a `MutationObserver`; a size in `%` is pinned to px first, or it
  would resolve against the larger wrapper.
- **Commits are rare, because each is a full repaint.** The real `#viewbox` transform — with
  upstream's per-zoom work (label rescale, markers, scale bar, minimap, coordinates) — is
  committed `GESTURE_SETTLE_MS` (120) after release (a new gesture that soon keeps the picture), after
  `GESTURE_REST_MS` (500) held still, or when `pictureCovers()` says the picture plus margin no
  longer covers the screen (a drag past one screen, a zoom-out past ⅓). Build 1 of this patch also
  committed past 2× / 0.7× / a third of a screen; that put 4–5 full repaints inside every gesture
  and was not smooth on an iPhone.
- **d3's pointer math is kept still.** The `<svg>`'s `getScreenCTM` is overridden to return the
  matrix from when it was last still. d3 reads pointers through it; without that, the slide feeds
  back into the gesture and a pinch zooms half as far. It must return the *identical* matrix, not a
  recomputed one — d3 re-anchors a wheel zoom whenever the pointer reads differently, and float
  rounding is enough.
- **A newly loaded map is adopted as committed**, its `#viewbox` transform read back, so its first
  gesture does not start with a repaint.
- **`?perf`** on the URL shows a readout per gesture: frames, median/p90/worst frame time, frames over
  34 ms, and each commit's time to the next frame. It is how this is measured on a phone; the dev
  box has no iPhone.

The scale bar and vignette ride along with the picture mid-gesture and snap back at the commit.

Measured on a simulated phone (Chromium, 390×844 @3×, CPU throttled 4×): mid-gesture commits per
pinch or long drag 4–5 → 0; main-thread time per finger move: pinch 143 → 26 ms, drag 40 → 17 ms.
Every gesture ends on the identical transform as upstream, checked in Chromium and WebKit.

### 3. `main.js` `checkLoadParameters()` — no 1 s wait

Upstream waits `setTimeout(…, 1000)` before fetching a `?maplink=` map. It runs on
`DOMContentLoaded`, after every script has executed, so the wait guards nothing; now `0`.
Map on screen: 2.7 → 1.8 s on a fast connection. (A `<link rel="preload">` of `rugby.map` was
tried and measured worse — it starves the scripts on slow connections.)

### 4. `index.html` — Azgaar Assistant defaults to Hide

The Options → "Azgaar assistant" select defaults to `hide`. Shown, it loads the OpenWidget support
chat (~320 KB, 15 requests) a few seconds into every visit and parks a bubble over the map. Still
one click away in Options; a stored choice wins.

### 5. `index.html` — relative bundle paths, and `main.js`'s cache key

`./index-CT-LUFbs.js` and `./index-B3l7mx48.css` instead of `/dnd-map/…`, so the copy works at any
path.

**The build number.** `main.js` draws a small **"map build N"** label at the bottom-left, from its
`DND_MAP_BUILD` constant, and `index.html` loads it as `main.js?v=1.120.5-nutty-bN`. Every patched
script carries the same suffix — since build 4 that is `main.js` and `modules/ui/general.js`
(patch 7). Bump the constant and every `-nutty-bN` together on every change to a patched script —
the `?v=` change gets past the CDN and the service worker (see below), and the label shows which
`main.js` a phone is really running: a stale copy shows its own older number, and builds before 3
show none. Currently **6**, shared with the player viewer's "map build 6" label.

### 6. `index.html` — players go to the viewer; the DM opens `?edit`

The first line of `<head>` is a one-line inline script: unless the query string has `edit`,
`maplink` or `seed`, it calls `window.stop()` and `location.replace("../dnd-view/" + location.hash)`.

Build 3 ran at about 1 fps on an iPhone — WebKit paints the live SVG into tiles on the main thread —
so players now get the pre-rendered viewer at `/dnd-view/`, and this copy of FMG is the DM's
editor at **`/dnd-map/?edit`**. `?edit` means nothing to FMG, so patch 1 still loads `rugby.map`;
`?maplink=` and `?seed=` keep working as before. Any other query alone (`?perf`) redirects; use
`?edit&perf`. The hash rides along, and `replace` keeps the bounce out of the back history.

`window.stop()` is there for Chromium: its preload scanner reads ahead of the parser and starts
FMG's ~70 scripts and stylesheets before this first line runs. Without it, 4 of them (114 KB)
finished on a local server before the redirect; with it, 0 — all 71 are cancelled. WebKit starts
none of them either way. FMG never rewrites its own URL (upstream's one `history.pushState` is
commented out in `options.js`), so a reload of `?edit` stays in the editor.

### 7. `modules/ui/general.js` — hover tooltips find their element again

`showMapTooltip` worked out what is under the pointer by counting back from the **end** of
`event.composedPath()` (`group = path[length - 7]`, `subgroup = path[length - 8]`, the burg at
`length - 10`, a zone at `length - 8`). Patch 2's two wrapper divs (`gestureClip`, `gestureLayer`)
sit between `<body>` and `<svg>` and shift every one of those by two, so since patch 2 the DM's
tooltip on a burg, river or marker fell through to the area underneath (*"Culture: X"*). The
indices now count from `#viewbox`'s own position in the path (`vb = path.findIndex(el => el.id ===
"viewbox")`; group `vb - 1`, subgroup `vb - 2`, burg `vb - 4`), right with or without wrappers.

Also, `handleMouseMove` (the 100 ms throttled `findCell` + tooltip `innerHTML`) returns at once
while `window.dndMapGesture` is set. `main.js`'s d3 zoom sets it on `start` and clears it on
`end` (in patch 2's `zoom` definition). A mouse drag never reached it — d3 swallows those
`mousemove`s — but on a touchscreen FMG's `touchmove` listener on `#viewbox` fires before d3's on
the `<svg>`, so a pinch ran the cell lookup every 100 ms. Measured over one scripted 40-move pinch:
`findCell` calls 39 → 0 (WebKit, 390×844), 15 → 0 (Chromium with touch); the end view is unchanged.

**That is the entire delta.** Everything else under `dnd-map/` is stock.

## `rugby.map`

The campaign save. 4.8 MB, FMG's native `.map` format.

- Converted from a 2018 FMG **v0.61b** map (the original campaign map) into the v1.122 format.
- `b412448` — regenerated to remove a rendering splotch on the cultures layer.
- `4768801` — **mobile performance pass**: coastline auto-filter off, paper texture off, text-shadows
  stripped. 130 lines removed from the save. The map is mostly read on phones, and those three
  settings were the expensive ones. Preserve this when replacing the map.
- **Map build 5 — the Turgythe skytrain.** A hub-and-spoke skytrain network centred on Ka: 20 major cities across the other cultures, a dense local web of Turgythe towns, and dashed under-construction extensions. Three route groups (`skytrain`, `skytrainLocal`, `skytrainBuilding`) and a tappable `skytrain` marker per station, written into the save through FMG itself by `map-build/skytrain/` (see its README). Sawyen, Suenth, the Isle of Death (Lich influenced) and the Free Isles are excluded.
- **Map build 6 — the Squiyles split and Jessigath.** The Territories became **West Squiyles (New
  Republic)**, which also took 30% of the Changelings' land and an island stronghold (🏰 marker), and
  **East Squiyles (Lawless)**; the lower-right island chain became **Jessigath**. New cultures, towns
  re-cultured to match, and refitted FMG-native labels (West/East Squiyles with subtitles, Changelings,
  Troll Mountains, Jessigath), all written through FMG by `map-build/lore/` (see its README).

Replacing it: edit in FMG (locally or at azgaar.github.io), save the `.map`, and drop it in as
`dnd-map/rugby.map`. Nothing needs to change in code — the filename is fixed. Re-check it on a
phone afterwards; the perf settings above are stored *in the save*, not in the app, so a fresh
export from FMG will have them back on.

## Vendoring rules

- **Do not hand-edit anything under `dnd-map/`** except to add a patch, and record every patch in
  the list above the moment you make it. An unrecorded patch is lost at the next re-vendor and the
  loss is silent.
- Do not reformat, lint, or "clean up" vendored files. Diff noise against upstream is what makes
  re-vendoring impossible.
- Treat it as one opaque unit at review time — a change touching `dnd-map/` should be either "new
  map save" or "one recorded patch", nothing in between.

### Re-vendoring

1. Build upstream at the target version (`base=/dnd-map/` or `./`).
2. Replace `dnd-map/` wholesale, keeping `rugby.map`.
3. Re-apply every patch in the list above; `checkLoadParameters()` may have moved.
4. Verify: `http://localhost:8000/dnd-map/?edit` loads the campaign map, and `/dnd-map/` with no query string lands on `/dnd-view/`.

Expect a large diff. The hashed bundle names (`index-CT-LUFbs.js`, `index-B3l7mx48.css`) change
every build.

## Known upstream leftovers

Neither is broken, both are wrong:

- **`manifest.webmanifest`** still carries upstream's identity — `scope` and `start_url` of
  `/Fantasy-Map-Generator/`, name *"Azgaar's Fantasy Map Generator"*, `url` pointing at
  azgaar.github.io. The scope doesn't match where this is served, so installing it as a PWA will
  not behave. Fixing it means editing a vendored file, so it needs a patch-list entry.
- **`sw.js`** registers a Workbox service worker that imports its runtime from
  `storage.googleapis.com` — a third-party CDN dependency on every page load, and the one thing here
  that can break from outside the repo. It only registers when the hostname isn't localhost, and a
  browser only offers service workers in a secure context (https or localhost). The live hosts are
  http only (pnutsuxnuts.com has no certificate of its own; [deployment.md](deployment.md) › Local
  testing), so today it registers **nowhere**: not on the live site, not locally. The table below is
  what it would do if the site moved to https.

### What the service worker caches

Relevant because it caches on its own terms, independently of the site's build-number
cache-busting (see [deployment.md](deployment.md)):

| Request | Strategy | Consequence |
|---|---|---|
| Navigation (`index.html`) | NetworkFirst, 15s timeout | HTML stays fresh. |
| Scripts, incl. `main.js` | **StaleWhileRevalidate**, 30 days | **A patch to `main.js` serves stale once** unless its `?v=` changes — hence patch 5's suffix. |
| Stylesheets, `*.min.js` libs | CacheFirst, 30 days | Fine; they only change on a re-vendor. |
| `*.json`, images, `*.svg`, fonts | CacheFirst, 30–60 days | Fine; static assets. |
| **`rugby.map`** | **no matching route** | Not cached by the worker. Map updates reach players on the next load. |

`versioning.js` and anything path-matching `google` are explicitly excluded from script caching.

So, on https: map changes would propagate immediately and patches to `main.js` would take one extra
visit. On today's http-only hosts the only cache is Pages' `max-age=600`: a patch whose `?v=` did
not change can take up to 10 minutes to reach a phone.
