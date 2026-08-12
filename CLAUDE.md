# nutty-fan-site

Two independent things served from one GitHub Pages site at **pnutsuxnuts.com**:

1. **The shooting gallery** (`/`) — a browser game. Photos and videos of Nutty fly at the screen,
   you shoot them, Jake the Snake shows up at 10 kills and swallows the gallery; beating him goes
   straight into a 3D on-rails flight ending in the Ozamatron bomb fight; Ozamatron's defeat warps
   you into the Suess slash-combo duel, and beating him leads into the final phase: a DDR-style
   dance-off against Patticus Maximus. `index.html` + `script.js` (gallery + Jake) +
   `stage2.js` (3D stage) + `suess.js` (the duel) + `stage3.js` (dance-off) + `style.css`.
2. **The campaign map** (`/dnd-map/`) — a vendored copy of Azgaar's Fantasy Map Generator that
   auto-loads one D&D campaign map.

No build step, no package.json, no test suite. The one dependency is a vendored
`libs/three.min.js` (r140 UMD), lazy-loaded only when stage 2 is reached. Edit files, commit,
push; Pages serves the change in about 60 seconds.

## Specs are the source of truth

Design and behavior live in `./specs/*.md`, not in the code.

- **Before changing behavior**, read the spec that governs it. `specs/00-overview.md` is the index.
- **Change the spec in the same commit as the code.** If the two disagree, the spec is the bug.
- **New system → new spec file.** Add it to the index in `specs/00-overview.md`.
- Specs carry the tuning constants (spawn rates, boss HP, radii) with the reasoning behind them.
  If you change a number in `script.js`, change it in the spec too.

## Bump the build number on every user-facing change

`index.html` carries the version in six places that must move together — one per script tag, so
adding a stage adds a place:

```html
<link rel="stylesheet" href="style.css?v=28">   <!-- line 7  -->
<div id="buildId">build 28</div>                 <!-- line 53 -->
<script src="script.js?v=28"></script>           <!-- line 62 -->
<script src="stage2.js?v=28"></script>           <!-- line 63 -->
<script src="stage3.js?v=28"></script>           <!-- line 64 -->
<script src="suess.js?v=28"></script>            <!-- line 65 -->
```

This is the repo's only release mechanism. The query strings bust the Pages CDN cache; the
`#buildId` text is how you tell which build a phone is actually running. Skip the bump and users
keep the old JS indefinitely.

## Local testing

```bash
python3 -m http.server    # then http://localhost:8000
```

The game fetches `media/manifest.json`, which browsers block over `file://` — opening `index.html`
directly shows the loading screen forever.

## Adding media is a two-step operation

Dropping a file into `media/` does nothing on its own. The game only reads
`media/manifest.json`, which must be regenerated and committed:

```bash
bash convert-heic.sh       # HEIC → JPG (Linux/macOS, needs ImageMagick)
python3 build-manifest.py  # rewrites media/manifest.json
```

See `specs/media-pipeline.md`.

## Don't hand-edit `dnd-map/`

636 files of vendored upstream code. It has exactly **one** local patch, recorded in
`specs/dnd-map.md`. If you must patch it again, append to that list — an unrecorded patch is lost
the next time the directory is re-vendored.

## Conventions to match

- **Vanilla ES6.** No framework, no modules, no imports, no transpiler. `script.js` and
  `stage2.js` are plain `<script>` tags sharing one global scope; everything is a top-level
  `function` or `const`. `stage2.js` must never touch `THREE` at parse time — the library loads
  lazily.
- **Config block at the top.** Tunable constants go in the `const` block at the head of each
  script, in SCREAMING_CASE, not inline at the use site.
- **`// === SECTION ===` banners** separate subsystems in both `script.js` and `style.css`.
- **Transform-only animation.** Per-frame motion writes `el.style.transform` and nothing else.
  Never animate `left` / `top` / `width` in the game loop — that change was deliberate (commit
  87c758b) and reverting it reintroduces per-frame layout reflows that tank mobile framerate.
- **Guard per-frame work.** The loop runs at 60fps with up to 12 DOM targets. Existing guards —
  the every-8-frames z-index re-sort, the AABB pre-check before `Math.hypot` — are load-bearing on
  mobile (commit c076b86). Match that discipline when adding to `loop()`.
- **Mobile is a first-class target.** `IS_MOBILE` halves the on-screen target count. Most of this
  site is played on phones.
