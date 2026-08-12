# Boss fight — Jake the Snake

## What it is

At 10 kills the gallery stops and a boss slides down from the top of the screen. **Jake the Snake**
spits volleys of orange panels at the player. The player shoots the panels out of the air and shoots
Jake in the mouth — his only weak point, and only while it's open. Panels that reach the bottom of
the screen cost a life. Three lives lost is game over.

This is the only fail state in the game.

## Trigger

`startBoss()` fires from `shootTarget()` when **`score === BOSS_SCORE`** exactly (`script.js:730`).
An exact equality, not `>=`.

On start: the boss and its HP bar slide in and **Jake inhales the entire gallery** — every live
photo spirals into his open mouth with accelerating pull, shrinking and spinning, each swallowed
with a dust puff (a rising suck sound plays, and a two-note gulp when the last one goes down; a
2.6s safety timer force-swallows stragglers). His mouth is open — and therefore vulnerable —
during the inhale. `spawnTarget()` becomes a no-op for the duration, and the HUD's
**WPNS / ARMED** cell is repurposed into **LIVES / ♥♥♥**. `three.min.js` starts preloading here,
because his defeat now leads directly to stage 2.

## Theme music

**`boss/jake-theme.mp3`** loops at volume 0.55 for the duration of this fight only. It starts in
`startBoss()` (which also pauses the gallery theme), stops (and rewinds) on both exits —
`defeatBoss()` and `endBoss()` — and restarts from the top on a rematch. Victory hands off to
silence, then Ozamatron's theme at the stage-2 approach; only a loss + retry brings the gallery
theme back. The mute button pauses/resumes it in place rather than restarting. See
[audio.md](audio.md) for the full music map.

## Phases

There are **two**. Phase 2 begins the moment Jake's HP drops to half or below: his eyes go red
(`boss-rage.png`) and **his HP bar refills to full** (`BOSS_HP_MAX`), so the rage phase is a whole
second bar of health. The attack timer is cancelled and restarted immediately so the faster cadence
takes effect without waiting out the current delay.

| | Phase 1 | Phase 2 (rage) |
|---|---|---|
| HP on entry | 26 | **refills to 26** |
| Panels per volley | 4 | 5 |
| Volley interval | 2200 ms | 1550 ms |
| Panel fall speed | 2.2–3.4 px/frame | **3.1–4.3** px/frame — faster out of his mouth |
| Cursor-aimed panels | — | 1 extra, aimed at the player's cursor |
| Resting sprite | `boss-idle.png` | `boss-rage.png` |

The cursor-aimed panel is what makes phase 2 dangerous: phase 1 can be dodged by standing still,
phase 2 cannot.

## Attacking

Every volley: switch to the `attack` sprite (mouth open), spawn the panels from the mouth position,
and return to the resting sprite after 1100ms.

Panels spawn at 50% width / 72% height of the boss element and fan out horizontally across a spread
of `±2.1` px/frame, falling at `2.2–3.4` px/frame in phase 1 and a faster `3.1–4.3` in the rage
phase. Each is a 50–90px orange gradient square
tumbling at up to `±4.5°` per frame.

A panel that passes 80px below the viewport bottom is removed and **costs the player a life**. A
panel that is shot is destroyed with a star burst, a boom, and an orange screen flash.

## Damaging the boss

- **The mouth is the only weak point**, and only while `mouthOpen` — that is, only during the
  `attack` state. The rest of the time Jake is untouchable.
- Hitbox: centered at 50% width / **65% height** of the boss element, radius `HIT_RADIUS * 1.5`
  (165px). Deliberately larger than the target hitbox, because the mouth is only open for 1100ms
  out of every 2200.
- Note the mouth *hitbox* sits at 65% height while panels *spawn* from 72%. They are separate
  numbers and neither is exactly the sprite's mouth; both are hand-tuned.
- Each hit deals 1 damage, flashes the `hit` sprite for 200ms, and shrinks the HP bar.
- `BOSS_HP_MAX` is 26. Phase 1 takes 13 mouth shots to reach the rage flip; the refill then makes
  phase 2 a full 26 more — about **39 successful mouth shots** across the whole fight.

**Shot priority:** panels are checked before the mouth (`fireShot()`, `script.js:534`). A panel
drifting in front of Jake's face absorbs the shot. This is intentional — you have to clear the air
before you can land damage.

## Player lives

`PLAYER_HP_MAX` is 3, displayed as `♥♥♥` decaying to `♡♡♡` in the repurposed HUD cell. Each life
lost triggers a red full-screen flash. At zero: the boss is torn down and a **GAME OVER** overlay
appears 600ms later reading *"JAKE THE SNAKE WINS THIS TIME"* with a `[ RETRY ]` button and — unless
already active — a `[ PUSSY MODE ]` button (the shared difficulty selector; see
[00-overview.md](00-overview.md#difficulty)).

While the game-over screen is up, shooting is disabled.

**Implementation guard (load-bearing):** the killing hit comes from `hitPlayer()` called *inside*
`loop()`'s panel iteration; that cascade runs `endBoss()`, which reassigns `boss.panels = []`
mid-loop. The panel loop must therefore skip empty slots (`if (!p) continue;`) and `break` once
`boss.active` goes false — otherwise it dereferences `undefined`, throws, and the `requestAnimationFrame`
never fires, freezing the whole screen. (This surfaced once Jake got harder and panel deaths got
common.)

**RETRY** removes the overlay, resets the score to 0, restores the WPNS/ARMED cell, and respawns a
full field of targets staggered 250ms apart.

## Victory

At 0 HP, Jake shatters using the same 3×2 image-shatter effect as a normal target
(`explodeShatter()` reused), all remaining panels are destroyed, and **the photos he swallowed
erupt out of his head** — up to 14 random gallery images blast up-and-outward from the head
position with spin and fade (`burstPhotosFromBoss()`).

There is **no intermission**: 1.5s after the burst, `enterStage2()` fires and the game goes
straight into deep space. See [stage2-ozamatron.md](stage2-ozamatron.md).

## Voice lines

Five MP3s in `boss/`, played through `playJakeVoice()` — one line at a time through a **single
reused `Audio` element** (its `src` is swapped per line). This matters: creating a `new Audio()` per
line leaks elements, and iOS silently stops playing new ones after ~a couple dozen, which made Jake
go mute partway through a long fight. Story beats **preempt** whatever is playing; hit grunts never
interrupt anything (so autofire doesn't stutter them — a new grunt only starts once the previous line
has finished, detected via `!paused && !ended && currentTime > 0`).

| File | When | Preempts? |
|---|---|---|
| `jake-eat-you-up.mp3` | Entrance, as the inhale starts | yes |
| `jake-ow.mp3` / `jake-stop-that.mp3` | Each mouth hit, 50/50 pick | no |
| `jake-shits-painful.mp3` | The phase-2 flip at half HP | yes |
| `jake-defeat.mp3` | Death, over the shatter and photo burst | yes |

Mute pauses the current line; lines are momentary so they don't resume on unmute.

## Sprites

Four PNGs in `boss/`, swapped by setting `img.src`. Rendered at 320px wide with
`image-rendering: pixelated` and an orange drop-shadow.

| State | File | When |
|---|---|---|
| `idle` | `boss-idle.png` | Phase 1 resting. Mouth closed — invulnerable. |
| `attack` | `boss-attack.png` | Firing a volley. **Mouth open — vulnerable.** |
| `hit` | `boss-hit.png` | 200ms after taking damage. |
| `rage` | `boss-rage.png` | Phase 2 resting. Mouth closed — invulnerable. |

## Constants

| Constant | Value | Controls |
|---|---|---|
| `BOSS_SCORE` | 10 | Kill count that triggers the encounter. |
| `BOSS_HP_MAX` | 26 | Mouth shots to kill. Phase 2 at 13. |
| `PLAYER_HP_MAX` | 3 | Lives. |
| `BOSS_DIR` | `boss/` | Sprite directory. |
| phase 1 / 2 interval | 2200 / 1550 ms | Volley cadence. |
| phase 1 / 2 panel count | 4 / 5 | Panels per volley. |
| mouth-open window | 1100 ms | Vulnerability window per volley. |
| weak point | 50% w, 65% h, r = `HIT_RADIUS * 1.5` | Mouth hitbox. |
| panel origin | 50% w, 72% h | Where panels spawn from. |
| panel size | 50–90 px | Panel square size. |
| panel fall speed | 2.2–3.4 (p1) / 3.1–4.3 (p2) px/frame | Time the player has to shoot one. |

## Layering

Boss `z-index: 260`, panels `265`, boss HUD `270`. Panels must render **above** the boss graphic or
they appear to emerge from behind his head (fixed in commit 0566ed9).

## Open questions

- **The boss can only be fought once per run.** The trigger is `score === 10` exactly, and after
  `defeatBoss()` the score keeps climbing past 10, so a winning player never sees Jake again. Losing
  and retrying resets the score to 0, so the boss *does* recur on a loss. Undecided whether the
  win path should also loop — a `score % 10 === 0` trigger or a rematch at a higher threshold would
  do it.
- **`restartGame()` does not reset `killStreak` or `lastKillTime`**, so a streak can technically
  carry across a game over. Harmless today; worth deciding if scoring ever matters.
- **The `boss` object is Jake-only, not a roster.** The second boss (Ozamatron,
  [stage2-ozamatron.md](stage2-ozamatron.md)) was built as its own subsystem in `stage2.js` rather
  than generalizing this one — reasonable while bosses are this different, but a third boss should
  force the roster question.
