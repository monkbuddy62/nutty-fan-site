# Media pipeline

## What it is

How photos and videos of Nutty get from a phone into the game. The game reads exactly one file —
`media/manifest.json` — so adding a file to `media/` does nothing until the manifest is regenerated
and committed.

This is the step everyone forgets.

## The contract

`media/manifest.json` is a committed JSON array of filenames, relative to `media/`:

```json
[
  "IMG_0055.JPG",
  "IMG_1004-ANIMATION.gif",
  ...
]
```

`script.js` fetches it on load, and every filename in it becomes a possible target. Filenames are
`encodeURIComponent`'d at request time, so spaces and punctuation are fine. Nothing else is
inferred: no directory listing, no globbing, no fallback.

If the fetch fails, the loading screen stays up with *"Add files to media/ and run
build-manifest.py"*. That message is the only diagnostic the game gives.

## Adding media

Two scripts, run in order, then commit everything including the regenerated manifest.

```bash
bash convert-heic.sh       # 1. HEIC → JPG, if any (Linux/macOS, needs ImageMagick)
python3 build-manifest.py  # 2. rewrite media/manifest.json
git add . && git commit -m "add media" && git push
```

### `convert-heic.sh`

Converts every `media/*.HEIC` and `media/*.heic` to `.jpg` via ImageMagick's `convert`, then
**deletes the original**. Exits with a message if ImageMagick isn't installed. Bails on nothing
else — a failed conversion is reported and the original is kept.

Needed because iPhones shoot HEIC and no browser will render it. Run this on a Linux or macOS box;
it's a bash script and depends on `convert` being on PATH.

### `build-manifest.py`

Scans `media/`, keeps files whose extension (lowercased) is in
`.jpg .jpeg .png .gif .mp4 .webm .mov`, sorts them, and writes `media/manifest.json`. Prints the
count. Anything else in the directory — including `manifest.json` itself and unconverted HEICs — is
silently skipped.

Extension matching is case-insensitive, so `.JPG` and `.MP4` are picked up.

## Current inventory

143 media files, **142 in the manifest**:

| Type | Count |
|---|---|
| `.jpg` / `.jpeg` | 99 |
| `.mp4` | 28 |
| `.png` | 14 |
| `.gif` | 1 |

Several `.MP4` clips ship alongside a same-named `.jpg`. Both are separate manifest entries and both
spawn as independent targets.

**`media/IMG_2488.HEIC` is committed but unconverted**, so it is invisible to the game — the one
file in `media/` that isn't in the manifest. Running `convert-heic.sh` on a Linux box and rebuilding
the manifest would pick it up.

## How the game uses it

See [shooting-gallery.md](shooting-gallery.md) for spawn behavior. Relevant to ingestion:

- **Video vs image is decided by extension** — `mp4`, `webm`, `mov` become `<video>` elements
  (autoplay, muted, looped, `playsInline`), everything else becomes `<img>`.
- **Aspect ratio is read from the file at load**, not from the manifest. Targets are square until
  the media reports its dimensions, then correct. Any aspect ratio works.
- **No duplicates on screen** — the spawn pool excludes files already in play. With 142 files and a
  cap of 12, this never runs dry, but a pool smaller than `MAX_ON_SCREEN` would fall back to
  allowing duplicates.

## Size limits

| Limit | Value | Status |
|---|---|---|
| Per file | 100 MB — GitHub hard-rejects the push | Fine. |
| Repo total | ~1 GB soft limit | **`media/` is ~267 MB; `.git` is ~284 MB.** |

The `.git` figure is the one to watch. Media is committed binary, so every replaced or deleted file
stays in history forever — the repo only grows. Trim long MP4s before committing rather than after.

## Open questions

- **No image optimisation step.** Full-resolution phone photos are committed and served as-is, then
  scaled down to at most ~320px on screen. A resize pass during ingestion would cut both repo size
  and mobile load time substantially, and nothing in the game would look different.
- **`convert-heic.sh` is POSIX-only** while the working machine is Windows, which is why an
  unconverted HEIC is sitting in the repo. Either port it to PowerShell or note the Linux box as a
  required part of the workflow.
