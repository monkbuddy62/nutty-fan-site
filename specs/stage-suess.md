# The Suess is Loose — the slash-combo assault

## What it is

The final combat gate before the dance-off. After Ozamatron detonates, the flight clears and a
scrawny, sandal-wearing degenerate twitches his way to center screen: **THE SUESS** — a party animal
days into a bender. You **swipe to carve slash-cuts into him**. Every slash chains a combo; combos
set off escalating explosions. A **LIMIT bar drains** the whole time — keep slashing or your combo
**BREAKS** (classic C-C-C-COMBO BREAKER) — and filling it to the top arms a **LIMIT BREAK**, a
screen-nuking super slash.

One rule governs everything: **keep the tempo up.** He fights back with telegraphed swings — a live
slash parries them, but the moment you slow down his swing connects (shattering your combo and
healing him) *and* his HP starts regenerating on its own. So idling is punished three ways at once:
combo break, a landed hit, and regen — and on a long combo he **teleports away** to shake you off.
At 25% HP he chugs, lights a smoke, and goes full Super Saiyan — **"THE SUESS IS LOOSE!"** — refills
his health, and gets harder across the board; he's genuinely mean. Killing him hands directly to the Patticus dance-off, still the game's trophy
ending. It's the only stage read on *aggression and rhythm* rather than aim.

## Trigger and hand-off

- After Ozamatron dies, `s2WarpOut()` plays a ~3.6s **deep-space warp beat**, then
  `s2VictoryHandoff()` (`stage2.js`) calls **`startSuess()`** (falling back to `startStage3` then the
  old victory screen if a later stage isn't loaded). The Suess win path calls `startStage3()`. The 2D
  starfield keeps drawing behind the duel.
- Debug warp: **`?fight=suess`** jumps straight in.
- Pure DOM + CSS — no THREE. `loop()` gains a `SUESS.active` branch that calls `suessTick()` (+
  `drawWarp()`). The crosshair is hidden and the shot handlers early-return while `SUESS.active`.

## The slash (`suessSlash`)

A swipe past `SUESS_SLASH_MIN` px registers one slash; **scribbling chains slashes without lifting**
(the origin resets to the current point after each), so fast flicks rack the combo. Each slash:

- Registered at most once per `SUESS_SLASH_COOLDOWN` (scribbling faster than that is free tempo but
  no extra hits) — this caps combo pace and, critically, the DOM/particle churn that caused frame
  drops.
- **Deals `SUESS_SLASH_DMG × multiplier`** damage (halved in phase 2, see below).
- **+1 combo**, updates the multiplier, **+`SUESS_LIMIT_GAIN`** to the bar.
- Spawns a **slash-cut** across his sprite (rotated to the swipe angle), a spark burst at the touch
  point (`explodeStars`), and a rising slash tone; he flinches to the `hit` frame for ~110ms.
- Every `SUESS_EXPLODE_EVERY` combo → a **big blast**: screen flash + shake + a 4-burst explosion
  barrage + boom (`playExplosionSfx`).
- Combo milestones fire a call-out + banner: **RIPPING (10) / SHREDDING (25) / BRUTAL (50) /
  GODLIKE (100)**.

### Damage multiplier

Rewards keeping the combo alive:

| Combo | ≥10 | ≥25 | ≥50 | ≥100 |
|---|---|---|---|---|
| Multiplier | ×2 | ×3 | ×4 | ×5 |

## The LIMIT bar — pressure and payoff

One bar does both jobs:

- **Drains** at `SUESS_LIMIT_DRAIN` per second (phase-scaled) whenever `combo > 0`, ticked in
  `suessTick()` off a `performance.now()` delta (framerate-independent). Each slash refills it.
- **Hits zero with a live combo → `suessComboBreak()`:** combo and multiplier reset to 0/×1, the bar
  empties, and a **"C-C-C-COMBO BREAKER!"** banner slams in with a down-pitched sting and a mocking
  bark. (At `combo === 0` the bar doesn't drain — no death spiral from a standing start.)
- **Fills to `SUESS_LIMIT_MAX` → `suessArmLimit()`:** the gauge and the LIMIT button flash; the bar
  can be banked at max (it stops rising) but still drains, so you either keep hitting or spend it.
- **`suessFireLimit()`** (LIMIT button, or Space) unleashes the **LIMIT BREAK**: a fan of nine slashes
  with an explosion barrage, a double screen-flash, `SUESS_LIMIT_BREAK_DMG` damage, and **+10 combo**.
  It empties the bar (no break — this is the reward) and locks input to the `limitbreak` state for
  ~1.1s before returning to the fight.

## He fights back — swings, parries, and regen

- **Swings (`suessBeginSwing`/`suessStrike`):** every `SUESS_SWING_EVERY` ms (± jitter) he winds up
  (the `windup` frame + a red **SLASH!** prompt) for `SUESS_SWING_TELL` ms, then strikes. At the
  strike, a slash within the last `SUESS_PARRY_MS` ms **parries** it (a "PARRY!" flash + clang, no
  effect); slashing *during* the wind-up cancels it outright. Otherwise the swing **connects**:
  `suessComboBreak()` fires and he heals `SUESS_HIT_HEAL`, with a red flash and shake.
- **Regen (`suessTick`):** whenever you've been slash-idle longer than `SUESS_REGEN_DELAY` ms and
  he's below max, his HP climbs at `SUESS_REGEN_RATE`/s and the HP bar glows green. Resume slashing
  and it stops. This makes the fight a DPS race: sustained slashing out-damages the regen; flailing
  never finishes him.

### Teleport escape (long combos)

He won't stand there forever. Every `SUESS_TP_AT` combo (the interval steps up each time, so only a
*sustained* combo keeps triggering it — and phase 2 escapes more often) he **teleports**
(`suessTeleport`): a purple flash, he blinks out, and for `SUESS_TP_GONE_MS` he's **gone and
untargetable** — slashes whiff (they still count as tempo so regen/parry don't punish you, but they
land no damage and grant no LIMIT), so the bar keeps draining. Then he flashes back in at a **random
new spot** on screen (28–72% across, 22–48vh up); the sprite, its slash-cuts, and the orb origin all
follow. A swing that would resolve while he's gone simply fizzles. A combo break resets both the
teleport clock and his position to center.

The point: a long combo periodically forces a ~half-second where you can't score, so the LIMIT bar
dips and you have to survive the gap — his way of shaking off a beating.

### Player lives and death

You can die. There are `SUESS_PLAYER_HP` hearts in the repurposed WPNS/ARMED HUD cell (same as the
Jake fight). A **connected swing** and a **detonating orb** each cost one heart via `suessHurtPlayer`,
which grants `SUESS_IFRAME_MS` of invulnerability afterward so a 3-orb volley can't wipe you in a
single frame. At zero hearts a **GAME OVER** overlay reads *"THE SUESS GOT YOU"* with `[ RETRY ]`;
retry restarts the duel only (boss HP, your hearts, phase, and combo all reset), not the whole run.
A `[ PUSSY MODE ]` button sits alongside `[ RETRY ]` — the shared difficulty selector
([00-overview.md](00-overview.md#difficulty)); in easy mode you get 6 hearts, deal 3× damage, and
he stops healing, teleporting, and firing orbs.

So idling now punishes you four ways at once — combo break, a landed hit, his regen, and a lost
heart — and enough sloppiness actually ends the run.

## Phases

**Two.** Phase 2 begins the instant HP drops to **`SUESS_HP_MAX × SUESS_RAGE_AT` (25%, = 150)** or
below — a set piece: he chugs the can and lights the smoke (`rage` sprite, frame 2 — gold hair, red
aura), the screen shakes and flashes, an aura sting plays under a screamed **"THE SUESS IS LOOSE!"**,
and — crucially — **his HP refills to full** (`SUESS_RAGE_HEAL_FULL`). So the transformation isn't a
last-stand; it kicks off a whole second, harder fight. From here he **stays Super Saiyan**: the
`rage` frame (2) is his resting *and* wind-up pose and the aura glow persists, so he never drops the
look — only the brief hit-flinch (frame 3) interrupts it. He's harder across the board:

| | Phase 1 | Phase 2 (Saiyan) |
|---|---|---|
| HP on entry | 600 | **refills to 600** |
| Damage taken | full | ×`SUESS_RAGE_DR` (0.28) — even tankier |
| LIMIT drain | 13 / s | 26 / s — combo far harder to hold |
| Swing cadence | 2200 ms | 780 ms — nearly 2× as often |
| Hit heal | 48 | 140 — a landed swing is devastating |
| Regen rate | 16 / s | 45 / s |
| Crotch orbs | 2 orbs / ~3.4s | **3 orbs / ~1.55s** (see below) |
| Resting / wind-up sprite | `idle` (0) / `windup` (1) | `rage` (2) — stays Saiyan |

### Crotch orbs (whole fight, phase-scaled)

He fires glowing green energy orbs from his crotch (`suessEmitOrbs`) **the whole fight** — a volley of
`SUESS_ORB_COUNT[phase-1]` orbs every `SUESS_ORB_EVERY[phase-1]` ms, so **2 orbs every ~3.4s before
Saiyan** and a real barrage of **3 every ~1.55s after**. The scheduler (`suessScheduleOrbs`) starts
when the fight begins and self-reschedules, reading the phase-indexed interval live. Orbs drift
outward at `SUESS_ORB_SPEED` px/s and obey the same tempo rule as everything else: **each slash pops
the oldest live orb** (`suessPopOrb`), so keeping your rhythm clears them for free. An orb that burns
its full `SUESS_ORB_FUSE` unslashed **detonates** — a green flash, `suessComboBreak()`, he heals
`SUESS_ORB_HEAL`, and it costs you a heart. Orbs move transform-only in `suessTick` (a handful at
once) and clear on win/teardown. (Easy mode suppresses them entirely.)

## Barks

Flavor, fired on events; **"THE SUESS IS LOOSE!"** is quarantined to the power-up. All lines are
player-supplied and shown as speech bubbles (recorded VO is a stretch goal).

| Slot | Lines |
|---|---|
| Entrance | I'VE BEEN UP FOR DAYS · SPEEDO LIFE · HEY MOTHERFUCKER |
| Idle (untouched) | SLAP THE BAG · I THINK THIS IS RINGWORM · SOLO LA PUNTITA |
| On your combo break | DERELICT MY BALLS · GET UP, LIGHTWEIGHT · PARTY HARD OR KILL YOURSELF |
| On your LIMIT BREAK | NOT LIKE THIS · HEY MOTHERFUCKER · SOLO LA PUNTITA |
| Power-up (quarantined) | **THE SUESS IS LOOSE!** |
| Defeat (muttered soft) | Oh sweet death, sweet relief |

## Victory

At 0 HP he drops to the `death` frame (5) — X-eyes, blood pool — under a 6-burst explosion barrage,
a golden flash, `explosion.mp3`, and a Nutty clip. He mutters his one quiet line —
*"Oh sweet death, sweet relief"* — and a banner shows **THE SUESS IS LOOSE NO MORE · MAX COMBO N**.
`SUESS_WIN_HOLD_MS` later, `startStage3()` fires. No victory screen of its own — the reward is the
next stage.

## Input (mobile-first)

- **Swipe / drag** anywhere on the stage to slash; scribble to chain. Touch and mouse both chain via
  a shared move handler; the origin resets each registered slash.
- **Keyboard (desktop):** arrows / WASD each slash in that direction; **Space** = LIMIT BREAK.
- The **LIMIT** button (bottom-right) is the only always-live tap target; the mute button stays
  reachable (HUD is z-index 100, above the stage's 90).

## Sprites

`boss/suess.png` — the friend's 3×2 sheet repackaged into a 6-frame horizontal strip (built by
`scratchpad/make_suess.py`: border-flood white-key, drop specks and top-half floaters, trim, bottom-
align on a uniform cell). Driven by `background-position-x` against `background-size: 600% 100%`,
`image-rendering: pixelated`.

| # | Frame | Used for |
|---|---|---|
| 0 | Idle, arms out | Phase-1 resting |
| 1 | Arm extended (wind-up) | His swing telegraph, and a brief hit-landed pose |
| 2 | Super-Saiyan, beer + smoke | The phase-2 power-up |
| 3 | Gut-punch recoil | Flinch on every slash (~110ms) |
| 4 | Bloodied, fists up | Phase-2 resting |
| 5 | X-eyes sprawl | Defeat |

## Audio

`boss/suess-theme.mp3` — the real **"The Soos Is Loose"** track (user-supplied, ~2:26, 192 kbps).
Loaded via `SUESS_THEME` (carries a `?v=` cache-buster, bumped whenever the file is replaced). It
replaced an earlier synth chiptune loop (still reproducible via `scratchpad/make_theme.py`). It
**starts `SUESS_THEME_START` (12s) in** — skipping the intro to reach the lyrics fast — and **fades
up from 0 to `SUESS_THEME_VOL` (0.55) over ~1.4s** the first time playback begins (a one-shot
`playing` listener seeks + fades, so it still works if the fight starts muted and is unmuted later).
Loops for the duel only, started via `playWithGestureFallback` (first slash is the gesture); retry
re-seeks to 12s at full volume. **All synth SFX in the fight route through `sTone()`**, a wrapper that
scales every tone by `SUESS_SFX` (0.28) so the per-slash ticks, booms, and the LIMIT-break roar sit
well under the track; and `s2Tone` itself ramps its gain up over ~6ms (instead of jumping to full) to
kill the onset **click/pop**. Explosion SFX (`playExplosionSfx`) drop to **0.06** while `SUESS.active`
(they fire often here, over the music) vs 0.5 elsewhere.
**When he goes Saiyan the track's
`playbackRate` jumps to 1.12** — faster and higher-pitched — so the music itself goes frantic for
phase 2 (reset to 1 on retry). Slots into the theme map: gallery / jake / ozamatron / **suess** /
mixdown, each owned by its phase. The synth SFX (slash tones, booms, `explosion.mp3`) layer on top.
Recorded bark VO is still a stretch goal.

## Constants (top of `suess.js`)

| Constant | Value | Controls |
|---|---|---|
| `SUESS_HP_MAX` | 600 | Total HP to shred. |
| `SUESS_RAGE_AT` | 0.25 | Fraction of HP at which he goes Saiyan (150). |
| `SUESS_RAGE_HEAL_FULL` | true | Transforming refills him to max HP. |
| `SUESS_SLASH_DMG` | 1.4 | Base damage per slash, before the multiplier. |
| `SUESS_SLASH_COOLDOWN` | 55 ms | Min time between registered slashes — caps rate (perf + combo pace). |
| `SUESS_RAGE_DR` | 0.28 | Phase-2 damage taken — even tankier. |
| `SUESS_LIMIT_MAX` | 100 | Bar capacity. |
| `SUESS_LIMIT_GAIN` | 8 | Bar refill per slash. |
| `SUESS_LIMIT_DRAIN` | 13 / 26 per s | Combo pressure (P1 / P2). |
| `SUESS_LIMIT_BREAK_DMG` | 90 | The super slash's damage (~15% of pool). |
| `SUESS_SLASH_MIN` | 18 px | Swipe travel that registers one slash. |
| `SUESS_EXPLODE_EVERY` | 8 | Big blast every N combo. |
| multiplier tiers | ×2/×3/×4/×5 | At combo 10 / 25 / 50 / 100. |
| `SUESS_REGEN_DELAY` | 650 ms | Slash-idle before he starts healing. |
| `SUESS_REGEN_RATE` | 16 / 45 per s | Self-heal while you're slow (P1 / P2). |
| `SUESS_SWING_EVERY` | 2200 / 780 ms | Time between his swings (P1 / P2). |
| `SUESS_SWING_TELL` | 720 / 400 ms | Wind-up telegraph before a swing lands. |
| `SUESS_PARRY_MS` | 320 ms | A slash this recent parries the swing. |
| `SUESS_HIT_HEAL` | 48 / 140 | HP he claws back on a connected swing. |
| `SUESS_ORB_EVERY` | 3400 / 1550 ms | Time between crotch-orb volleys (P1 / P2). |
| `SUESS_ORB_COUNT` | 2 / 3 | Orbs per volley (P1 / P2). |
| `SUESS_ORB_FUSE` | 1500 ms | Orb lifetime before it detonates. |
| `SUESS_ORB_SPEED` | 95 px/s | Orb outward drift. |
| `SUESS_ORB_HEAL` | 45 | HP he regains per orb that detonates unslashed. |
| `SUESS_PLAYER_HP` | 4 | Player hearts. |
| `SUESS_IFRAME_MS` | 850 ms | Invuln window after taking a hit. |
| `SUESS_TP_AT` | 25 / 18 combo | Teleport-escape interval, stepping up each time (P1 / P2). |
| `SUESS_TP_GONE_MS` | 480 ms | How long he's gone/untargetable per teleport. |
| `SUESS_WIN_HOLD_MS` | 2200 | Death banner hold before the dance-off. |

## Implementation notes

- `suess.js` — plain `<script>` after `stage3.js`. Borrows `IS_MOBILE`, `muted`, `MAX_ON_SCREEN`,
  `playWithGestureFallback`, `playNuttyClip`, `explodeStars`, `playExplosionSfx`, `spawnTarget`,
  `startStage3` from `script.js`, and `s2Banner`/`s2Flash`/`s2Tone` from `stage2.js`.
- `script.js` bridges: the `SUESS.active` branch in `loop()`, early-returns in the shot handlers and
  `spawnTarget()`, the `galleryActive()` guard, the `suessThemeMute()` mute hook, and the
  `?fight=suess` warp. `stage2.js` routes `s2VictoryHandoff()` through `startSuess`.
- `suessTick()` does the only per-frame work — a clamped `performance.now()` delta drains the bar and
  writes the gauge's `scaleX`; everything else (slashes, combos, explosions, breaks) is event-driven.
  Slash DOM elements are removed after their 300ms animation (≤ a handful live at once).
- Styling in the `STAGE — THE SUESS` section of `style.css`; stage z-index 90 (below the HUD).

## Build status (build 65)

Playable end-to-end via `?fight=suess` and in the main flow (Ozamatron → Suess → dance-off): swipe-
chained slashing, the multiplier, combo-milestone call-outs, big-blast + LIMIT-BREAK explosions, the
draining LIMIT bar with combo break and the LIMIT super, his telegraphed **swings + parry**, the
**idle regen**, the blinking **SWIPE/SLASH** prompt, the phase-2 rage set piece (harder across the
board), barks, and the win handoff. Verified headlessly — slash-combo path 14/14 (combo build,
break-on-drain, LIMIT arm/fire, rage, win→handoff) and fight-back 11/11 (regen, parry-by-timing,
parry-by-slashing, hit→heal→break), player-death path 10/10 (i-frames, game over, retry). The
battle theme is in (`boss/suess-theme.mp3`, synth chiptune, intensifies in phase 2). **Not yet:**
recorded bark VO.

## Open questions

- **Balance is first-pass.** HP, drain rates, and multiplier tiers were set by feel and a headless
  run, not real play. Expect to tune `SUESS_LIMIT_DRAIN` (combo difficulty) and `SUESS_HP_MAX`
  (fight length) once it's felt on a phone.
- **Death balance is untuned.** Lives were added late; whether 4 hearts + 850ms i-frames is fair
  against phase-2's fast swings *and* orb volleys needs real play. Levers: `SUESS_PLAYER_HP`,
  `SUESS_IFRAME_MS`, `SUESS_ORB_COUNT`. Losing sends you back to the duel start, which — given how
  long phase 2 runs — may be too punishing; a phase-checkpoint retry is worth considering.
- **Slash-cut fidelity.** Cuts render as an angled streak over his sprite, not a true traced path.
  Good enough and cheap; a path-traced cut would look better if anyone wants it.
- **Bark VO.** Text-only MVP; his voice is half the joke, so recorded lines are worth it eventually.
