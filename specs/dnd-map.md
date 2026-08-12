# dnd-map — the campaign map

## What it is

`/dnd-map/` serves a self-hosted copy of **Azgaar's Fantasy Map Generator** that boots straight into
one D&D campaign map (`rugby.map`) instead of generating a random world. Players get a full
interactive map — pan, zoom, click a province, read the burg names — at a stable URL, with no
account and nothing to install.

Self-hosted rather than linked to azgaar.github.io because the campaign map has to load
automatically and outlive whatever upstream does next.

## Provenance

| | |
|---|---|
| Upstream | [Azgaar/Fantasy-Map-Generator](https://github.com/Azgaar/Fantasy-Map-Generator), MIT |
| Version | **1.122.12** (`dnd-map/versioning.js`) |
| Built with | `base=/dnd-map/` — absolute paths, so it only works at that path |
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

**That is the entire delta.** Everything else under `dnd-map/` is stock.

## `rugby.map`

The campaign save. 4.8 MB, FMG's native `.map` format.

- Converted from a 2018 FMG **v0.61b** map (the original campaign map) into the v1.122 format.
- `b412448` — regenerated to remove a rendering splotch on the cultures layer.
- `4768801` — **mobile performance pass**: coastline auto-filter off, paper texture off, text-shadows
  stripped. 130 lines removed from the save. The map is mostly read on phones, and those three
  settings were the expensive ones. Preserve this when replacing the map.

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

1. Build upstream at the target version with `base=/dnd-map/`.
2. Replace `dnd-map/` wholesale, keeping `rugby.map`.
3. Re-apply every patch in the list above; `checkLoadParameters()` may have moved.
4. Verify: `http://localhost:8000/dnd-map/` with no query string loads the campaign map.

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
  that can break from outside the repo. It only registers when the hostname isn't localhost, so it
  is live on pnutsuxnuts.com and inert during local testing.

### What the service worker caches

Relevant because it caches on its own terms, independently of the site's build-number
cache-busting (see [deployment.md](deployment.md)):

| Request | Strategy | Consequence |
|---|---|---|
| Navigation (`index.html`) | NetworkFirst, 15s timeout | HTML stays fresh. |
| Scripts, incl. `main.js` | **StaleWhileRevalidate**, 30 days | **A patch to `main.js` serves stale once** — returning visitors get the old copy on the visit after you deploy, and the new one the visit after that. |
| Stylesheets, `*.min.js` libs | CacheFirst, 30 days | Fine; they only change on a re-vendor. |
| `*.json`, images, `*.svg`, fonts | CacheFirst, 30–60 days | Fine; static assets. |
| **`rugby.map`** | **no matching route** | Not cached by the worker. Map updates reach players on the next load. |

`versioning.js` and anything path-matching `google` are explicitly excluded from script caching.

So: map changes propagate immediately, patches to `main.js` take one extra visit. If a patch appears
not to have deployed, load it once more before debugging.
