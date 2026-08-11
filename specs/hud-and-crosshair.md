# HUD and crosshair

## What it is

A tactical-scope overlay: cyan corner brackets framing the viewport, a custom animated crosshair
that replaces the mouse pointer, orange lock-on brackets that snap to whatever target you could
currently hit, and four stat readouts. Everything is monospace, cyan `#00ffcc`, and glowing.

The look is deliberately gun-camera / arcade-scope. Two layers produce it:

- **`#crosshairCanvas`** — a full-viewport `<canvas>` at `z-index: 500`, the topmost element,
  redrawn from scratch every frame. All vector chrome lives here.
- **`#hud`** — static DOM at `z-index: 100` for the text readouts.

Both are `pointer-events: none`. `body { cursor: none }` — the drawn crosshair **is** the cursor,
so it must never fall out of sync with the real pointer position.

## Canvas layer, drawn every frame

Drawn in order by `drawHudOverlay()` (`script.js:403`):

1. **Corner brackets** — 64px L-shapes inset 18px from each corner, cyan with a 12px glow. Purely
   decorative framing.
2. **Lock-on brackets** — orange `#ff6600` corner ticks around the nearest hittable target: the
   target the next shot will kill. The brackets **rotate with the photo** (canvas
   translate+rotate) so they hug the tilted rectangle exactly, and target selection uses the same
   rotated-rect distance test as `fireShot()` (`distToTarget` / `targetHitMargin`) — same math,
   same nearest-wins rule. **Suppressed for targets wider than 550px**, since brackets around a
   target that nearly fills the screen read as noise rather than a lock.
3. **The crosshair**, at the cursor, if the cursor is on screen.
4. **Shoot flash** — a white ring expanding to 50px radius and fading over 200ms from the point of
   the last shot. Fires on every shot including misses, so the gun always feels like it went off.

### Crosshair anatomy

Concentric, all cyan with shadow-blur glow:

| Part | Geometry |
|---|---|
| Center dot | r = 1.5 |
| Inner ring | r = 11 |
| Four spokes | from r = 16 out to r = 38 (`innerR + gap`, `+ lineLen`) |
| End caps | 7px perpendicular ticks at the spoke tips |
| Outer arcs | 4 arcs of 36° at r = 42, **rotating once every 7 seconds** |

The rotating outer arcs are the only always-moving element; they're what keeps the reticle from
looking like a static PNG. Derived from `Date.now()`, so they keep turning even while the game is
otherwise idle.

## DOM readouts

Top bar:

- **`◈ PNUT SUX NUTS ◈`** — title, left.
- **Streak display** — right; shows the current streak message for 2.2s (see
  [shooting-gallery.md](shooting-gallery.md)).
- **Mute button** — right; the one interactive element on the page. `🔊` / `🔇`, dims when muted.
  Clicks on it are excluded from firing.

Bottom bar, four cells separated by dividers:

| Cell | Value |
|---|---|
| **KILLS** | Score, zero-padded to 3 digits. |
| **TARGETS** | Live target count, zero-padded to 2. |
| **SPEED** | Mean target speed × 40, one decimal. Cosmetic telemetry — it exists to make the HUD feel instrumented, and reads `0.0` when nothing is on screen. |
| **WPNS** | `ARMED`, in pulsing green. **Repurposed into `LIVES` / `♥♥♥` during the boss fight** — see [boss-fight.md](boss-fight.md). |

## Other overlay elements

| Element | Role |
|---|---|
| `#buildId` | Build number, bottom-right, dim cyan. How you tell which build a phone is running — see the build-number ritual in `CLAUDE.md`. |
| `#loadingScreen` | Full-screen title card until the media manifest resolves. Fades out via `.gone`. |
| `#shoot-hint` | The tap-to-shoot prompt. |
| `#reminiscing-banner` | Idle-mode banner. |
| `#gameOverScreen` | Boss defeat overlay with the RETRY button. |

## Screen treatment

Two `body` pseudo-elements, both `pointer-events: none`:

- **`::before`** — 2px repeating horizontal scanlines at 7% black, `z-index: 300`. Above the game,
  below the crosshair canvas.
- **`::after`** — radial vignette darkening past 35% from center, `z-index: 1`. Below the game.

## Layering

The full stack, since it's easy to break:

| z | Layer |
|---|---|
| 0 | `#stars` starfield |
| 1 | vignette (`body::after`) |
| 2 | `#gameArea` — live targets |
| 100 | `#hud` text |
| 150 | `#buildId`, reminiscing banner |
| 160 | shoot hint |
| 199–200 | explosion particles and debris |
| 260 / 265 / 270 | boss / panels / boss HUD |
| 300 | scanlines (`body::before`) |
| 500 | `#crosshairCanvas` — always on top |
| 9998–9999 | full-screen damage and kill flashes, loading and game-over screens |

## Implementation notes

- Both canvases are resized on `window.resize`; the starfield is re-initialised at the same time.
- The lock-on search reuses `distToTarget()`/`targetHitMargin()` — the exact functions
  `fireShot()` uses. If the hit test changes, both change together — a lock-on that disagrees
  with the hit test is worse than no lock-on.
- The whole canvas is `clearRect`'d and redrawn per frame. At this element count that's cheaper than
  tracking dirty regions, and it keeps the draw code linear.
