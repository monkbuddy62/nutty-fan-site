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

On start: the boss and its HP bar slide in, existing targets are slowed to 15% speed and then
cleared after 1 second, `spawnTarget()` becomes a no-op for the duration, and the HUD's
**WPNS / ARMED** cell is repurposed into **LIVES / ♥♥♥**.

## Phases

There are **two**. Phase 2 begins the moment Jake's HP drops to half or below; the attack timer is
cancelled and restarted immediately so the faster cadence takes effect without waiting out the
current delay.

| | Phase 1 | Phase 2 (HP ≤ 10) |
|---|---|---|
| Panels per volley | 3 | 5 |
| Volley interval | 2600 ms | 1700 ms |
| Cursor-aimed panel | — | 1 extra, aimed at the player's cursor |
| Resting sprite | `boss-idle.png` | `boss-rage.png` |

The cursor-aimed panel is what makes phase 2 dangerous: phase 1 can be dodged by standing still,
phase 2 cannot.

## Attacking

Every volley: switch to the `attack` sprite (mouth open), spawn the panels from the mouth position,
and return to the resting sprite after 1100ms.

Panels spawn at 50% width / 72% height of the boss element and fan out horizontally across a spread
of `±2.1` px/frame, falling at `1.8–2.8` px/frame. Each is a 50–90px orange gradient square
tumbling at up to `±4.5°` per frame.

A panel that passes 80px below the viewport bottom is removed and **costs the player a life**. A
panel that is shot is destroyed with a star burst, a boom, and an orange screen flash.

## Damaging the boss

- **The mouth is the only weak point**, and only while `mouthOpen` — that is, only during the
  `attack` state. The rest of the time Jake is untouchable.
- Hitbox: centered at 50% width / **65% height** of the boss element, radius `HIT_RADIUS * 1.5`
  (165px). Deliberately larger than the target hitbox, because the mouth is only open for 1100ms
  out of every 2600.
- Note the mouth *hitbox* sits at 65% height while panels *spawn* from 72%. They are separate
  numbers and neither is exactly the sprite's mouth; both are hand-tuned.
- Each hit deals 1 damage, flashes the `hit` sprite for 200ms, and shrinks the HP bar.
- `BOSS_HP_MAX` is 20, so the fight is 20 successful mouth shots — roughly 10 per phase.

**Shot priority:** panels are checked before the mouth (`fireShot()`, `script.js:534`). A panel
drifting in front of Jake's face absorbs the shot. This is intentional — you have to clear the air
before you can land damage.

## Player lives

`PLAYER_HP_MAX` is 3, displayed as `♥♥♥` decaying to `♡♡♡` in the repurposed HUD cell. Each life
lost triggers a red full-screen flash. At zero: the boss is torn down and a **GAME OVER** overlay
appears 600ms later reading *"JAKE THE SNAKE WINS THIS TIME"* with a `[ RETRY ]` button.

While the game-over screen is up, shooting is disabled.

**RETRY** removes the overlay, resets the score to 0, restores the WPNS/ARMED cell, and respawns a
full field of targets staggered 250ms apart.

## Victory

At 0 HP, Jake shatters using the same 3×2 image-shatter effect as a normal target
(`explodeShatter()` reused), all remaining panels are destroyed, and the gallery resumes 1.8
seconds later with a fresh staggered field.

Defeat also sets `jakeDefeated` and starts the lazy `three.min.js` preload — 10 gallery kills
later, stage 2 begins. See [stage2-ozamatron.md](stage2-ozamatron.md).

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
| `BOSS_HP_MAX` | 20 | Mouth shots to kill. Phase 2 at 10. |
| `PLAYER_HP_MAX` | 3 | Lives. |
| `BOSS_DIR` | `boss/` | Sprite directory. |
| phase 1 / 2 interval | 2600 / 1700 ms | Volley cadence. |
| phase 1 / 2 panel count | 3 / 5 | Panels per volley. |
| mouth-open window | 1100 ms | Vulnerability window per volley. |
| weak point | 50% w, 65% h, r = `HIT_RADIUS * 1.5` | Mouth hitbox. |
| panel origin | 50% w, 72% h | Where panels spawn from. |
| panel size | 50–90 px | Panel square size. |
| panel fall speed | 1.8–2.8 px/frame | Time the player has to shoot one. |

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
