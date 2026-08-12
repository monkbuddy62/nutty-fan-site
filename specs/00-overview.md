# Overview

`nutty-fan-site` is a static site with no build step, served from GitHub Pages at
**pnutsuxnuts.com**. It hosts two unrelated deployables that share nothing but a domain.

## Site map

```
/                    the shooting gallery   index.html, script.js, style.css
/dnd-map/            the campaign map       vendored Fantasy Map Generator + rugby.map
```

| Path | What it is |
|---|---|
| `index.html` | Game shell — canvases, HUD markup, overlays. ~64 lines. |
| `script.js` | The gallery + Jake + stage-2 bridge. Vanilla ES6, no modules. |
| `stage2.js` | Stage 2: the 3D on-rails flight and Ozamatron. Same conventions. |
| `stage3.js` | Stage 3: the Patticus Maximus dance-off — the game's ending. Same conventions. |
| `libs/` | Vendored `three.min.js` (r140 UMD), lazy-loaded for stage 2 only. |
| `style.css` | All game styling, including the CRT scanline/vignette treatment. |
| `media/` | Photo and video targets, plus the committed `manifest.json` index. |
| `boss/` | Jake's four sprites + Ozamatron's billboard, parts-sheet, and TV-face textures. |
| `audio/` | Theme music (gallery theme, the stage-3 mixdown). The 20 voice clips are **not in the repo** — see `audio.md`. |
| `dnd-map/` | Vendored upstream code. Do not hand-edit; see `dnd-map.md`. |
| `build-manifest.py`, `convert-heic.sh` | The media ingestion scripts. |

## Spec index

| Spec | Governs |
|---|---|
| [shooting-gallery.md](shooting-gallery.md) | The core loop: spawning, motion, fleeing, shooting, streaks, idle mode |
| [boss-fight.md](boss-fight.md) | The Jake the Snake encounter, its two phases, player lives, game over |
| [stage2-ozamatron.md](stage2-ozamatron.md) | Stage 2: the 3D on-rails flight and the Ozamatron bomb fight |
| [stage3-dance.md](stage3-dance.md) | Stage 3: the DDR-style dance-off against Patticus Maximus |
| [hud-and-crosshair.md](hud-and-crosshair.md) | The canvas overlay, crosshair, lock-on brackets, HUD readouts |
| [visual-effects.md](visual-effects.md) | Explosion styles, warp starfield, screen flashes |
| [audio.md](audio.md) | Synthesised SFX and the Nutty voice-clip pool |
| [media-pipeline.md](media-pipeline.md) | Getting photos and videos into the game |
| [dnd-map.md](dnd-map.md) | The vendored Fantasy Map Generator and the campaign map |
| [deployment.md](deployment.md) | Pages, DNS, cache-busting, the build-number ritual |

## Difficulty

There are two difficulties, toggled by a global **`window.EASY`** flag (declared in `script.js`,
default `false`, shared across `script.js` / `stage2.js` / `suess.js`). Every **GAME OVER** screen —
Jake, Ozamatron, and the Suess — shows a pink **`[ PUSSY MODE ]`** button next to `[ RETRY ]` (only
while `EASY` is still off). Tapping it sets `window.EASY = true` and retries that fight; the flag then
**eases every fight for the rest of the run** (it's never turned back off except by a reload).

Easy mode is applied as inline `window.EASY ? … : …` gates at the relevant use-sites (not a constant
rewrite), so each spec's constants table lists the **normal** values. What easy mode changes:

- **Jake:** 6 lives (vs 3), each mouth-shot deals 3× damage, no rage refill, 2/3 panels per volley
  (vs 4/6) at half speed, no cursor-homing panels, volleys 1.8× slower.
- **Ozamatron:** 6 lives, 2 bombs to win (vs 4), socket window and attack cadence 2× longer, laser/
  orb/missile speeds ~0.6×, 2 laser bolts (vs 4), missiles turn slower, asteroids half as frequent.
- **The Suess:** 6 hearts, slashes deal 3× and ignore the rage damage-reduction, no rage full-heal,
  no self-regen, swings ~1.9× less often that heal for 0, no crotch orbs, no teleport escape.

The button markup/wiring helpers (`easyBtnHtml`, `bindEasyBtn`) and the touch-first `bindTap` live in
`script.js` and are shared by all three death screens.

## How these specs work

They are **normative**. A spec states what the system is supposed to do; the code is an attempt at
it. When they disagree, the spec wins and the code is a bug — unless you deliberately change the
spec, which you do in the same commit.

Each spec carries the actual tuning constants, because on this project the numbers *are* the design.
`FLEE_RADIUS = 150` is not an implementation detail; it is how the game feels. Changing it in
`script.js` without changing it here makes both documents useless.

### Adding a spec

New subsystem gets a new file. Keep the existing shape:

1. **What it is** — one paragraph, in terms a player would recognize.
2. **Behavior** — what happens, in order, including edge cases.
3. **Constants** — a table of every tunable, its value, and what it controls.
4. **Implementation** — where the code lives (`file:line`), and any constraint the code must respect
   (performance guards, DOM layering) that isn't obvious from reading it.
5. **Open questions** — anything undecided or known-broken, so it gets decided rather than
   rediscovered.

Then add a row to the spec index above.
