# Shooting gallery — the core loop

## What it is

Photos and videos of Nutty drift in from the edges of a starfield, growing as they approach. The
player shoots them with a crosshair that replaces the mouse cursor. Every kill explodes the target,
plays a Nutty voice clip, and increments the score. Targets shy away from the cursor, so they are
never quite sitting still.

Governs `script.js` outside the boss and HUD sections. The boss encounter is
[boss-fight.md](boss-fight.md); the overlay is [hud-and-crosshair.md](hud-and-crosshair.md).

## Startup

1. `fetch('media/manifest.json')`. On failure the loading screen stays up with the text
   *"Add files to media/ and run build-manifest.py"* and no targets spawn — the starfield still
   animates, so a broken manifest looks like an empty game rather than a dead page.
2. On success: hide the loading screen, init the starfield, spawn `MAX_ON_SCREEN` targets at once,
   start the RAF loop.
3. 1.2s later, show the tap-to-shoot hint (see *Shoot hint* below).

## Spawning

A target enters from a random one of the four screen edges, 100px outside it, and is aimed at a
random point inside the **middle 50%** of the screen. It never targets the exact center — a fixed
destination would make every target converge on one point.

- Velocity is `1.0 + rand*1.4` px/frame along that aim vector, fixed at spawn.
- It starts at `scale 0.15` and grows by `GROW_RATE` per frame to a cap of `1.0` — roughly 120
  frames, or 2 seconds, to full size. This is what sells the depth: targets arrive from far away.
- Base size is `200 + rand*120` px wide. Height follows the media's true aspect ratio, read from
  `naturalHeight/naturalWidth` (images) or `videoHeight/videoWidth` (video) once loaded, and
  defaults to square until then.
- Rotation starts at `±15°` and drifts by `±0.075°` per frame.
- **No duplicates on screen.** The spawn pool excludes files already in play; it falls back to the
  full list only if every file is already on screen.
- Videos autoplay muted, looped, `playsInline`. `playsInline` is required or iOS takes them
  fullscreen.

The population is held at `MAX_ON_SCREEN` — every removal path (kill, fade, off-screen) schedules a
replacement spawn after a short random delay so respawns don't arrive in lockstep.

## Motion and fleeing

Each frame, for every live target:

1. **Flee.** If the cursor is within `FLEE_RADIUS`, push velocity directly away from it with a force
   that scales linearly from 0 at the rim to `FLEE_FORCE` at the center, then clamp total speed to
   `MAX_MOVE_SPD`. The force modifies *velocity*, not position — targets accelerate away and keep
   coasting, rather than snapping.
2. Integrate position and rotation, grow the scale.
3. Write a single `transform: translate() scale() rotate()`.
4. Cull if more than 450px outside the viewport, and schedule a replacement.

**Depth ordering:** targets are sorted by scale and assigned `zIndex` so smaller (further) targets
sit behind larger (nearer) ones. Sorting on real depth rather than spawn order was a fix for
z-fighting flicker (commit c2d18e0).

## Shooting

- **Hit test:** on each shot, find the nearest live target within `HIT_RADIUS` of the cursor and
  kill it. One shot kills one target. A shot that hits nothing is still a shot — it plays the pew
  and draws the flash ring.
- **Autofire:** mouse-down or touch-start fires immediately, then repeats every `FIRE_RATE_MS`
  until release. Holding is the intended way to play.
- **Touch:** each tap sets the cursor position from the touch point before firing, so taps hit where
  you tapped. `touchmove` drags the crosshair. All three touch handlers `preventDefault()` to stop
  scroll and double-tap zoom.
- Clicks on a `<button>` (the mute toggle) and any click while the game-over screen is up do not
  fire.

Shot resolution order — see `fireShot()` at `script.js:529` — is **boss panels → boss weak point →
normal targets**, first match wins. During the boss fight there are no normal targets, so the order
only matters for the panels-vs-boss case: an incoming panel in front of the mouth shields it.

### On kill

Score increments, `killStreak` advances, the boom and a random Nutty clip play, and the target
explodes in place (see [visual-effects.md](visual-effects.md)). At `score === BOSS_SCORE` the boss
encounter starts — and beating it leads directly into stage 2
([stage2-ozamatron.md](stage2-ozamatron.md)); the gallery only returns after stage 2 is won.

## Kill streaks

Kills within **1600ms** of each other chain. At 3+ the streak message shows in the top-right HUD
slot *and* as a large centered popup.

| Streak | Message |
|---|---|
| 3 | 🔥 TRIPLE KILL |
| 4 | 💀 QUAD KILL |
| 5 | ⚡ RAMPAGE |
| 6 | 🌀 PNUT OBLITERATED |
| 7 | ☠️ UNSTOPPABLE |
| 8+ | 🌀 *N*x CHAOS |

## Target lifetime

A target that is never shot fades out after `TARGET_LIFETIME_MS`, over a 2.5s opacity transition,
then is removed and replaced. Without this, targets that drift slowly across the screen accumulate
and crowd out fresh media.

## Shoot hint

1.2s after load, a pulsing `⊕` and *TAP OR CLICK TO SHOOT* fade in near the bottom. It hides on the
first `mousedown`/`touchstart`, or automatically after 4.5s. Mobile players had no way to know the
game was interactive (commit f5c82ff).

## Reminiscing mode

If nothing is clicked or tapped for `REMINISCE_IDLE_MS`, the game enters *reminiscing* — a drifting
italic banner reading *"reminiscing like a bitch..."* fades in over the still-running gallery. Any
interaction exits it immediately.

The idle check runs every 180 frames (~3s), not every frame, and is suppressed during the boss
fight. It is an attract mode: the site is as much a photo album as a game.

## Constants

All in the config block at the top of `script.js`.

| Constant | Value | Controls |
|---|---|---|
| `MAX_ON_SCREEN` | 12 desktop / **6 mobile** | Live target count. Mobile is halved for framerate. |
| `IS_MOBILE` | UA test or `innerWidth < 768` | Selects the mobile budget. |
| `FLEE_RADIUS` | 150 px | How close the cursor gets before targets bolt. |
| `FLEE_FORCE` | 0.12 | Flee acceleration at point-blank range. |
| `MAX_MOVE_SPD` | 3.2 px/frame | Speed cap after fleeing, so targets can't be flung off screen. |
| `HIT_RADIUS` | 110 px | Shot and lock-on radius. Generous on purpose — this is a phone game. |
| `FIRE_RATE_MS` | 90 ms | Autofire interval while held. |
| `BASE_PX` | 260 px | Fixed DOM width; visible size comes from `transform: scale`. |
| `GROW_RATE` | 0.007 /frame | Approach speed, `0.15 → 1.0` in ~120 frames. |
| `TARGET_LIFETIME_MS` | 18000 | Unshot target lifespan before fade. |
| `REMINISCE_IDLE_MS` | 25000 | Idle time before attract mode. |
| streak window | 1600 ms | Max gap between kills to chain a streak. |

## Implementation notes

- `loop()` at `script.js:745` is the single RAF loop. It draws the starfield, draws the HUD overlay,
  moves targets, moves boss panels, and updates the readouts. There is no other timer driving
  animation.
- **Performance guards that must be preserved** (commit c076b86):
  - The flee check does a cheap axis-aligned `Math.abs` test before `Math.hypot`, so the square root
    only runs for targets plausibly near the cursor.
  - The z-index re-sort runs **every 8th frame**, not every frame — that removes ~84% of the
    per-frame style writes and is invisible at 60fps.
  - Elements never animate `left`/`top`/`width`; every per-frame write is a single `transform`
    (commit 87c758b). Reintroducing layout properties here reintroduces reflow-per-frame.
- `BASE_PX` is a fixed layout width so the browser lays each target out exactly once. Apparent size
  is `baseSize * scale`, applied as a transform scale relative to `BASE_PX`.
- Targets live in `#gameArea` while alive and are re-parented to `<body>` with `position: fixed`
  when they die, so the death animation plays in place independent of the game area.
