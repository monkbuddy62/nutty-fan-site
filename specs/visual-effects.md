# Visual effects

## What it is

Every kill picks one of three explosion styles at random, so the same photo dying twice never looks
the same. Behind everything, a warp starfield gives the impression the whole screen is flying
forward. All of it is DOM elements with CSS transitions — there is no particle engine and no
`<canvas>` for effects.

## Bullet holes — the wound state

Before any explosion: a photo wider than 180px has a **45% chance to survive its first hit** with
a hole punched clean through at the cursor point (`punchHole()`). The hole is a CSS
`mask-image: radial-gradient(...)` in element units, so it scales and rotates with the photo. The
impact also kicks the photo away from the hit point (+2.4 px/frame along the bullet line), sets
it tumbling (rotSpeed kicked, clamped ±2.5°/frame), sprays dust at the hole, and plays a low
`playThunk()`. **A wound scores nothing and doesn't advance the streak** — the follow-up shot
kills. One hole per photo (`hasHole`); suppressed during Jake's inhale so the entrance stays
clean.

## Death sequence

`triggerExplosion(target, hitX, hitY)` runs on every target kill, carrying the cursor position so
break-ups radiate from where the bullet actually landed:

1. Add a `.kill-flash` full-screen flash for 220ms.
2. Roll the style: **55% `shards`** (images only), else 25% `stars` / 20% `dust`.
3. `shards` removes the original element instantly — the shards are the photo. The other styles
   keep the old exit: snap the element out of `#gameArea` into `<body>` at fixed coordinates,
   spin to a random rotation and shrink to `scale(0.03)` while fading over 400ms.
4. Schedule a replacement spawn 200–800ms later.

The re-parenting in step 3 matters: the element is mid-transform when it dies, and without pinning
it to absolute screen coordinates first, it would jump.

## The explosion styles

### `shards` — the headliner

`explodeShards()`: the photo breaks into **9 irregular triangular shards** radiating from the
impact point. The cursor is inverse-rotated into the photo's frame (clamped 15% inside the
edges), 9 jittered spoke angles are cast to the rect border (spilling 8% past so no slivers are
left), and each consecutive spoke pair plus the impact point becomes a `clip-path: polygon(...)`
shard carrying the actual image. Shards fly along their own spoke direction (rotated into world
space) 150–430px with ±220° spin, slight fall bias and shrink, over 0.5–0.9s — plus 6 hot ember
particles off the impact point. Every break is unique, and the cracks start where you shot.

Videos can't be shard-sliced (the pieces are `background-image` divs), so they fall through to
`stars`/`dust`.

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

### `shatter` (legacy — Jake's death only)

The old 3×2 `background-position` grid slice (`explodeShatter()`). Retired from the gallery
roster in favor of `shards`, but still used verbatim for Jake's death, where the rectangular
grid reads fine on the big sprite.

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
| style roll | 55% shards / 25% stars / 20% dust (videos: 55/45 stars/dust) |
| shard count | 9 triangles per break |
| hole chance | 45%, photos wider than 180px, once per photo |
| hole size | 26–36 element units + 9 feather |
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
