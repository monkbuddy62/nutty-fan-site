# Deployment

## What it is

Push to `master` and GitHub Pages serves it. No CI, no build step, no staging environment, no
rollback beyond `git revert`. Everything in the repo root is the live site.

| | |
|---|---|
| Repo | `monkbuddy62/nutty-fan-site` |
| Branch | `master` |
| Host | GitHub Pages |
| Domain | **pnutsuxnuts.com** via the `CNAME` file |
| Propagation | ~60 seconds after push |

`CNAME` contains a single line, `pnutsuxnuts.com`. It must stay in the repo root — Pages reads it
from there on every build, and deleting it drops the custom domain back to
`monkbuddy62.github.io/nutty-fan-site/`.

Both deployables ship together: `/` is the shooting gallery, `/dnd-map/` is the campaign map. There
is no way to deploy one without the other.

## Bump the build number

This is the release process. `index.html` carries the version in **four places** that must move
together:

| Line | What |
|---|---|
| 7 | `<link rel="stylesheet" href="style.css?v=28">` |
| 53 | `<div id="buildId">build 28</div>` |
| 62 | `<script src="script.js?v=28"></script>` |
| 63 | `<script src="stage2.js?v=28"></script>` |

`libs/three.min.js` is loaded dynamically by `script.js` **without** a `?v=` — it is a vendored
immutable file; if it is ever upgraded, rename it (e.g. `three-r150.min.js`) rather than relying
on cache-busting.

Why it matters:

- **The query strings are the only cache-busting there is.** `index.html` is revalidated by Pages,
  but `script.js` and `style.css` are cached by the browser and the CDN. Without a new `?v=`,
  returning visitors — especially phones — keep running the old JS indefinitely, and the bug you
  just fixed is still there for everyone who has already visited.
- **`#buildId` is the only way to tell what a device is actually running.** It sits bottom-right in
  dim cyan. When someone says the site is broken, the first question is which build they see.

Bump all four on any change to `script.js`, `stage2.js`, or `style.css`. Half the history is build bumps
(`ba32703` is one for cache-busting alone) — that is the mechanism working, not churn.

`dnd-map/` has its own caching story and does not use this scheme; see
[dnd-map.md](dnd-map.md).

## Local testing

```bash
python3 -m http.server    # http://localhost:8000
```

A web server is required — the game fetches `media/manifest.json`, which browsers block over
`file://`. Opening `index.html` directly leaves the loading screen up forever, which looks like a
broken build but isn't.

`http://localhost:8000/dnd-map/` serves the map locally too. The FMG service worker does **not**
register on localhost, so local behavior there is cleaner than production.

## Deploy checklist

1. Build number bumped in all four places, if `script.js`, `stage2.js`, or `style.css` changed.
2. Spec updated in the same commit, if behavior changed.
3. `media/manifest.json` regenerated and committed, if media changed
   ([media-pipeline.md](media-pipeline.md)).
4. Tested over `http://localhost:8000`, not `file://`.
5. `git status` clean of stray files — everything committed goes live.
6. After pushing: hard-reload the live site and confirm `#buildId` shows the new number.

## Repo size

Pages has a **1 GB** soft limit. `media/` is ~267 MB and `.git` is ~284 MB. History is the binding
constraint — every replaced or deleted media file stays in the pack forever. See
[media-pipeline.md](media-pipeline.md).

## Known gaps

- **No rollback but `git revert`.** A bad push is live for however long the fix takes. Given the
  stakes, that's fine — but there's no staging URL to check against first.
- **The `audio/` directory is not in the repo** while `script.js` references 20 clips from it. If
  those files are being uploaded to the host out of band, that is an undocumented deploy step and
  belongs in this file. See [audio.md](audio.md) — it's unresolved which.
