# Visual effects

## What it is

Every kill picks one of three explosion styles at random, so the same photo dying twice never looks
the same. Behind everything, a warp starfield gives the impression the whole screen is flying
forward. All of it is DOM elements with CSS transitions — there is no particle engine and no
`<canvas>` for effects.

## Death sequence

`triggerExplosion()` (`script.js:318`) runs on every target kill:

1. Pick one of `['dust', 'stars', 'shatter']` uniformly at random and run it.
2. Add a `.kill-flash` full-screen flash for 220ms.
3. Freeze the target: snap it out of `#gameArea` into `<body>` at fixed coordinates matching where
   it visually was, so the death animation plays in place and is unaffected by the game loop.
4. Spin it to a random new rotation and shrink to `scale(0.03)` while fading, over 400ms.
5. Remove it after 450ms, then schedule a replacement spawn 200–800ms later.

The re-parenting in step 3 matters: the element is mid-transform when it dies, and without pinning
it to absolute screen coordinates first, it would jump.

## The three explosion styles

### `dust`

Understated. 16 muted brown-grey circles (3–10px, `hsl(20–60, 15%, 35–65%)`) thrown 60–240px in
random directions over 0.4–0.85s, plus 10 tiny pale 2px specks thrown 30–110px. Reads as a physical
object breaking apart.

### `stars`

Loud. 18 glowing symbols from `✦ ★ ✸ ✺ ✷ ⬟` in `#ffcc44 #ff006e #00ffcc #44eeff #ffffff #ffaa00`,
sized 10–28px, thrown 100–320px on an **even angular distribution** (jittered ±0.2rad) so the burst
is radially symmetric rather than clumped. Each spins up to ±270° while scaling to zero. A cyan
radial flash scales from 0 to 3× at the center.

This is also the effect used when a boss panel is shot, and the fallback if `shatter` can't find an
image to slice.

### `shatter`

The most physical of the three. Slices the target's own image into a **3×2 grid** of six tiles using
`background-position` offsets against the full-size image, then throws each tile outward from its
grid position — outer tiles fly further, all tiles get a downward bias so the debris falls — with
±200° of spin, over 0.55–0.8s.

Because the pieces carry the actual photo, this is the only style where you can still read what you
just shot as it comes apart. It is reused verbatim for the boss death (`script.js:1074`).

## Shared particle helper

`spawnParticle(cx, cy, styles, flyX, flyY, duration, delay)` (`script.js:186`) creates a fixed,
pointer-events-none div at a point, applies arbitrary inline styles, and on the next frame
transitions it to an offset position at zero opacity, cleaning up on completion. `styles._endTransform`
appends rotation/scale to the end state.

New effects should go through it rather than hand-rolling element creation.

The double `requestAnimationFrame` before setting the end state is **required**, not superstition:
the browser must commit the initial style before the transition target is set, or there is nothing
to transition from and the particle teleports.

## Warp starfield

`#stars`, a full-viewport canvas at `z-index: 0`, 320 stars in normalized 3D space.

Each frame: fill the canvas with `rgba(0,0,0,0.18)` — a partial wipe, so previous frames leave
fading trails — then for each star advance `z` by `-0.008` and draw a line from its previous
projected position to its current one. Stars are projected as `(x/z) * halfDim * 0.55 + center`.
Brightness and line thickness both scale with `1 - z`, so stars streak brighter and fatter as they
rush past. Any star that hits `z <= 0` or leaves the viewport respawns at `z = 1.0`.

The trails come free from the partial wipe rather than from per-star history.

## Screen flashes

| Flash | Color | Duration | Trigger |
|---|---|---|---|
| `.kill-flash` | white, CSS-animated | 220 ms | Any target kill |
| panel destroyed | `rgba(255,100,0,0.15)` | 350 ms | Boss panel shot |
| player hit | `rgba(255,0,0,0.22)` | 600 ms | Life lost |

All are full-screen `inset: 0` divs at `z-index: 9998`, faded out and removed.

## Constants

| Constant | Value |
|---|---|
| `EXPLOSION_STYLES` | `['dust', 'stars', 'shatter']`, uniform random |
| `NUM_STARS` | 320 |
| star speed | 0.008 z/frame |
| star trail wipe | `rgba(0,0,0,0.18)` |
| shatter grid | 3 cols × 2 rows |
| dust particles | 16 + 10 |
| star-burst particles | 18 |

## Implementation notes

- Particle counts were cut once already for mobile framerate (commit c076b86). They are a budget,
  not a preference — raising them costs frames on phones.
- Every particle removes itself on a `setTimeout` matched to its transition; nothing is pooled and
  nothing persists. Effects are fire-and-forget and hold no references into game state.
- Effect elements sit at `z-index: 199–200`: above targets, below the boss and the HUD.
