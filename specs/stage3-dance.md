# Stage 3 — The dance-off / Patticus Maximus

## What it is

The game's true ending. When the third bomb destroys Ozamatron, the wreckage clears and the
screen becomes a dance floor: **PATTICUS MAXIMUS**, "Galactic Dance Champion // Undefeated" —
a furious pipe-chomping leprechaun sprite (`boss/patticus.png`) — dances to the site's own song —
`audio/pnutsuxnuts_mixdown.mp3` — and the player must match his moves, DDR-style. Arrows rise
through a 4-lane track toward receptors; hit them on the beat. There is **no fail state**:
surviving the routine wins the game. When the routine ends Patticus crumples, the victory screen
shows the player's dance rating, and **the mixdown keeps playing** — it owns the audio for the
rest of the session, even back in the gallery.

## Behavior

### Trigger and hand-off

- `s2Detonate()` (stage2.js) now ends in `s2VictoryHandoff()` instead of the old Ozamatron
  victory screen: it tears stage 2 down (restoring the 2D starfield, which keeps drawing behind
  the dance floor), restores the WPNS HUD cell, and calls `startStage3()`. The old
  *OZAMATRON DESTROYED* screen survives only as a fallback if `stage3.js` isn't loaded.
- Stage 3 is pure DOM + CSS — no THREE, no canvas of its own. `loop()` in `script.js` stays the
  only RAF loop; while `STAGE3.active` it calls `stage3Tick()` (and `drawWarp()` for the
  starfield) instead of the gallery update.
- Shooting is disabled for the phase: the crosshair canvas is hidden, and the document-level
  shot handlers return early while `STAGE3.active`. The lane tap zones are real `<button>`s, so
  they're skipped by the shot handlers' `closest('button')` guard by construction.
- Debug warp: `?fight=dance` jumps straight to the dance-off on load.

### The chart is locked to the actual song

- The mixdown was beat-mapped offline (onset-strength autocorrelation + grid fit over the whole
  200s track): **130.7 BPM, first beat at 0.175s**. `S3_BPM` / `S3_OFFSET_S` carry those values;
  if the mixdown file is ever replaced, re-measure rather than eyeballing.
- All timing hangs off `audio.currentTime` polled per frame — never wall-clock — so RAF jank
  can't drift the chart, and pausing the track (mute) freezes the dance mid-air.
- The routine is deterministic: a fixed density ramp over `S3_MEASURES` (36) measures of 4/4 —
  8 measures of half notes, 14 of three-per-measure, 10 of quarter notes, then a 4-measure
  eighth-note finale — 122 notes ending ~73s in, so the whole dance-off wraps inside ~1:15
  (the song is 3:20; it doesn't need all of it). Lanes come from a seeded LCG and never repeat
  back-to-back. The first arrow waits `S3_LEAD_BEATS` (16) beats while Patticus solo-grooves.

### Dancing

- 4 lanes ← ↓ ↑ →. Arrows spawn below the track's bottom edge and rise for `S3_TRAVEL_S` to the
  receptor row. Input: tap the lane column (buttons), or arrow keys / WASD on desktop.
- Judgment: |tap − beat| ≤ `S3_PERFECT_S` (0.10s) is PERFECT (+2 hype, star burst at the
  receptor), ≤ `S3_GOOD_S` (0.22s) is GOOD (+1); an arrow that crosses unhit by +0.22s is a MISS
  (−4 hype, combo break). A tap with no arrow in the window is a free whiff — no penalty,
  mashing is not punished (mobile-friendly).
- **Patticus strikes the pose of each arrow the moment it reaches the receptors** (or when the
  player hits it early) — the fiction is that he leads and Pnut matches. Each pose swaps the
  sprite to a frame from that lane's move set (`S3_FRAMES.lanes`, alternated for variety) via
  `background-position-x`, plus a small lane-flavored body-english transform (`pose-l/d/u/r`)
  pivoted at his feet. From measure 32 (`S3.finaleT`, the eighth-note section) the lane sets are
  ignored and he steps through the **breakdance sequence** — handstands and one-arm spins — one
  frame per note. Misses flash his fist-pump gloat (frame 22); the 3-miss taunt gets the finger
  wag (frame 11). His idle bob and the floor washes run on `--beat`-derived CSS durations.
- He talks: an intro taunt, mockery after 3 consecutive misses, and escalating panic lines at
  15/30/60 combo. The **CROWD HYPE** meter (starts 50%) rises with hits and falls with misses —
  purely cosmetic pressure; it can't kill you.

### Victory

When the last note resolves (+1.4s), Patticus drops to his knocked-flat frame (15), desaturated
and settling, a golden flash
and a four-note fanfare play over a Nutty clip, and the victory screen shows: *PATTICUS MAXIMUS
OUT-DANCED*, a rating — FLAWLESS FUNK (no GOODs or MISSes) / CERTIFIED GROOVE MACHINE (acc ≥ 90%)
/ FUNKY ENOUGH (≥ 65%) / SLOPPY, BUT THE GALAXY IS SAVED — the PERFECT/GOOD/MISS/combo tally, and
`[ RETURN TO THE GALLERY ]`. Accuracy = (perfect + good/2) / total notes. The gallery button is
**invisible and unclickable for the first `S3_BTN_DELAY_MS` (15s)** of the victory screen, then
fades in — the win (and the song) get their moment before an exit is offered.

**The mixdown keeps playing** (it loops): the victory screen doesn't stop it, and returning to
the gallery respawns targets **without** restarting the gallery theme — `galleryActive()` treats
`STAGE3.done` as "the mixdown owns the audio now". `STAGE3.done` also makes the finished
dance-off unrepeatable.

### Edge cases

- **Muted at entry:** the track can't start, so the intro waits (nothing moves — all timing is
  `audio.currentTime`) and Patticus periodically demands you unmute. Unmuting resumes via
  `s3ThemeMute()`, which the mute button calls alongside the other theme hooks.
- **Missing/broken mp3:** the `error` listener concedes the dance-off after ~2s (straight to the
  victory flow, silent) — a 404 must not soft-lock the ending, same rule as the stage-2 CDN
  guard.
- **Mute mid-dance** pauses the track and therefore the whole phase in place; unmute resumes.

## Constants

All in the config block at the top of `stage3.js`.

| Constant | Value | Controls |
|---|---|---|
| `S3_TRACK` | `audio/pnutsuxnuts_mixdown.mp3` | The song (3:20, 192kbps, in-repo). |
| `S3_BPM` / `S3_OFFSET_S` | 130.7 / 0.175s | Measured beat grid of the mixdown. Re-measure if the file changes. |
| `S3_VOLUME` | 0.7 | Louder than the boss themes (0.55) — the song is the point. |
| `S3_TRAVEL_S` | 1.8s / 2.0s mobile | Arrow flight time; mobile gets longer sight-lines. |
| `S3_PERFECT_S` / `S3_GOOD_S` | 0.10s / 0.22s | Judgment windows; GOOD's edge is also the miss line. |
| `S3_LEAD_BEATS` | 16 | Patticus solo before the first arrow (~7s of music). |
| `S3_MEASURES` | 36 | Routine length — last note ~73s in, victory by ~1:15; the song plays on after. |
| `S3_BTN_DELAY_MS` | 15000 | How long the victory screen withholds the RETURN TO THE GALLERY button. |
| `S3_FRAME_N` / `S3_FRAMES` | 23 / frame map | The strip's cell count and the pose vocabulary (lane sets, breakdance run, taunt 11, gloat 22, defeat 15). |
| hype deltas | +2 / +1 / −4 | PERFECT / GOOD / MISS effect on the (cosmetic) CROWD HYPE meter. |

## Implementation

- `stage3.js` — the whole subsystem, plain script tag after `stage2.js` (build-number `?v=`
  applies). Shares globals with the other scripts: uses `IS_MOBILE`, `muted`, `frameCount`,
  `playWithGestureFallback`, `playNuttyClip`, `explodeStars`, `spawnTarget`, `MAX_ON_SCREEN`
  from `script.js` and `s2Banner`, `s2Flash`, `s2Tone` from `stage2.js`.
- `script.js` bridges: the `STAGE3.active` branch in `loop()`, early returns in the
  mousedown/touchstart shot handlers and `spawnTarget()`, the `STAGE3` guard in
  `galleryActive()`, `s3ThemeMute()` in the mute button, and the `?fight=dance` warp.
- Styling in the `STAGE 3 — DANCE-OFF` section of `style.css`. `#danceStage` is z-index 90 —
  above the game layers, **below the HUD (100)** so the mute button stays reachable; the
  victory overlay reuses the `#victoryScreen` / `.gameover-*` styles at z 9999.
- Per-frame work is transform-only translateY on the live arrows (≤ ~12 elements at peak);
  everything decorative (bob, washes, disco ball) is CSS animation, opacity/transform only.
  Judgments, combo text, and meter writes happen on events, not per frame.
- Patticus is one background-image div stepping through `boss/patticus.png` — a **23-frame
  strip** (231×230 cells, frames bottom-aligned and centered, ~1.1MB) built from the
  user-supplied `Downloads/dance-sprite.png` sheet: white background flood-keyed from the
  borders, figures found as 8-connected components (≥3000px; smaller blobs attach to the
  nearest figure), ordered row-major, each cell trimmed and placed on a uniform bottom-aligned
  canvas. Border flood-fill can't reach background trapped inside arm-body loops, and interior
  whites can't be keyed blindly (eyes and grins are white too) — the four enclosed pockets
  (frames 0, 2, 10, 11, all on his left side) were identified visually and zeroed by
  frame+centroid; a re-run of the pipeline needs that visual pass repeated. `s3SetFrame(i)` sets `background-position-x = i·100/(N−1)%` against
  `background-size: 2300% 100%`; `image-rendering: pixelated` keeps the pixel art crisp. If the
  sheet is replaced, re-run that segmentation and re-measure the `S3_FRAMES` vocabulary rather
  than eyeballing cells. Poses only touch `.px-fig`'s transform, so the scale-down at
  `max-height: 640px` (applied to `#patticus` itself) composes with them.

## Open questions

- **The chart is authored by density ramp, not by ear.** It's locked to the real beat grid but
  ignores the song's structure (drops, fills). Hand-placing sections against the actual mixdown
  would feel better if anyone ever wants to tune it.
- **The routine covers ~73s of a 200s song.** Deliberate — the dance-off should end by ~1:15,
  and the win screen arrives while the track still has life left to keep playing over. A
  "full song / endless encore" mode is undecided.
- **After the win, the gallery theme is gone for good** (`STAGE3.done` gates `galleryActive()`).
  Deliberate: the mixdown is the trophy. Revisit if anyone misses the old loop.
