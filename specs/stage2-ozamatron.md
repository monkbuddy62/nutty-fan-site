# Stage 2 — Deep space and Ozamatron

## What it is

Ten kills after Jake the Snake falls, the gallery ends and the game changes shape: the player is
now piloting a ship through 3D space, on rails, always moving forward. The photos stop — targets
are 3D models (placeholders for now). At the end of the run a giant robot, **OZAMATRON**, blocks
the way. He cannot be shot down; the player must **plant 4 bombs** into glowing sockets that only
open in timed windows — good timing and accuracy, or nothing. There are **four sockets and four
bombs**: winning means bombing every one of them.

This is the second boss. Destroying him no longer ends the game — after a short warp back into
deep space it hands off to **the Suess duel** ([stage-suess.md](stage-suess.md)), which in turn
leads to **stage 3, the Patticus Maximus dance-off** ([stage3-dance.md](stage3-dance.md)).

## Behavior

### Trigger and hand-off

- **Stage 2 begins the moment Jake falls.** `startBoss()` kicks off the lazy preload of
  `libs/three.min.js` (~600KB) so it downloads during the fight; `defeatBoss()` blasts the
  swallowed photos out of Jake's head and calls `enterStage2()` 1.5s later — there is no
  gallery intermission.
- `enterStage2()` (`script.js`) shows the *STAGE 2 // ENTERING DEEP SPACE* banner and calls
  `startStage2()` (`stage2.js`) ~1.1s after the preload resolves.
- If `three.min.js` fails to load, the hand-off silently aborts and the gallery continues — a
  broken CDN/cache must never brick the base game.
- The 2D warp starfield canvas is hidden for the duration; the crosshair overlay and HUD chrome
  stay — same reticle in both worlds. `loop()` in `script.js` remains the only RAF loop; while
  stage 2 is active it calls `stage2Tick()` instead of the gallery update.

### Flight phase

- The ship (placeholder: cone fuselage + box wings + engine glow) chases the pointer with lerp
  inertia and banks into the turn, flying `S2_SHIP_AIM_DROP` world-units **below** the aim point so
  it never covers what you're shooting. Aiming and steering are the same gesture — dodging pulls
  your crosshair, Star-Fox style. The world scrolls past on rails: two leapfrogging star clouds, objects
  spawned at `S2_SPAWN_Z` flying toward the camera.
- **Drones** (placeholder octahedra in neon colors) are the targets. Shooting uses the same
  screen-space assist as the 2D game: each drone is projected to screen px and the nearest within
  `HIT_RADIUS` dies. Kills score, streak, boom, and play a Nutty clip, with the 2D `explodeStars`
  burst drawn at the projected point.
- **Asteroids** (placeholder dodecahedra) are unshootable hazards spawned into the ship's flight
  column. One crossing the ship plane within collision range costs a life.
- At `S2_KILLS_TO_BOSS` drone kills, spawning stops and Ozamatron approaches.

### Ozamatron

- A **billboard sprite with animated arms**: an `OZ_SIZE` (55-unit) plane showing
  `boss/ozamatron.png` — a fruit-armored mecha with a CRT television head ("FRUIT-VISION CRT-86"),
  generated art with the background keyed out (1024² RGBA). The baked-in arms are **erased from
  the body texture** and replaced by two shoulder-pivoted arm planes (bent-arm crops from the
  parts sheet), so the arms genuinely move: gorilla idle sway, wind-up, throws, chest-beats.
  Holds at `OZ_HOLD_Z` (−70 — close and huge), bobbing heavily. Name plate reuses the `#boss-hud`
  styling with **4 bomb slots** instead of an HP bar.
- **Theme music:** `boss/ozamatron-theme.mp3` loops at volume 0.55 from the first klaxon of the
  approach until the final bomb detonates (or the player dies). Stopped in `s2Detonate()`,
  `s2GameOver()`, and `s2Teardown()`; the mute button pauses/resumes it in place via
  `s2ThemeMute()`. The flight phase has no music — the fight earns it.
- **The approach is a staged arrival** (~7s, `OZ_APPROACH_FR` 420 frames): red-alert edge flashes
  and a two-tone klaxon under a *⚠ WARNING ⚠* banner, the starfield decays from warp rush to a
  crawl (dropping out of warp), and he emerges from the fog with his screen broadcasting rolling
  **static**. A constant low camera rumble grows with proximity, joined by heavy thuds in the
  back half. On arrival (`s2OzArrived`): a slam (boom, 48Hz hit, shake 18, flash, *OZAMATRON HAS
  ARRIVED*), then a chest-beat taunt — and only when the taunt ends does the static resolve into
  the face. The first throw follows. **Surviving the flight refills you for the boss:** lives reset
  to `S2_LIVES` and the shield is restored, so you enter the fight fresh regardless of how battered
  the flight left you.
- **The TV screen plays a face.** A swappable overlay plane (`OZ_SCREEN_RECT`, on the CRT glass)
  shows `boss/ozamatron-face.png` — Ozan's headshot processed for the old-TV vibe (desaturated,
  green-gray phosphor tint, scanlines, vignette, rounded CRT corners). `s2SetTvImage(url)` swaps
  what's playing mid-fight; during each chest-beat the screen cuts to procedural analog static
  (a 96×72 `CanvasTexture` of noise, re-rolled every 3 frames) and restores after.
- Anchor points (sockets, debris placement) are `OZ_ANCHORS`/`OZ_PARTS` image-fraction
  coordinates. Part crop rects are **exact component bounding boxes**, auto-measured by
  flood-labeling the sheet; the sheet itself now contains only the nine used parts (all strays —
  bent arms, foot, treads, fruit icons, labels — are erased). If the art is regenerated, re-run
  that measurement rather than eyeballing rects.
- **One socket per bomb — this is an invariant.** A bombed socket is spent: it goes to `dmg` 2 and
  never becomes window-eligible again, and `s2OpenSocketWindow()` only opens windows on `dmg === 1`
  components. So if `OZ_BOMBS_NEEDED` ever exceeds `OZ_SOCKETS.length`, the fight **softlocks** —
  after the last socket is bombed no window can ever open, `s2Detonate()` never fires, and the
  player can only die and retry into the same wall. Change the two together, always.
- **Three-stage component damage** replaces the old plant-a-bomb rule. The four core components
  (the two watermelon shoulder discs, the CRT screen, and the torso core) each walk
  pristine → light → heavy, with
  matching art from two extra keyed sheets (`boss/ozamatron-parts-light.png` — scratched/dented —
  and `-heavy.png` — rusted/smashed). The sheets' layouts differ slightly from the pristine one,
  so per-sheet crop rects live in `OZ_DMG_RECTS`; limbs swap their own plane's texture+UVs in
  place, billboard components get an overlay plane of the damaged art.
  1. **Chip it open**: `OZ_CHIP_HITS` (6) shots on a pristine core component — any time, sparks
     and a tink per hit — grind it to **light damage** (crunch, dust, flash).
  2. **Only light-damaged components are window-eligible.** A window opens after each throw and
     laser burst (`OZ_SOCKET_OPEN_MS`), the component itself flashing — discs and torso with a
     pulsing additive glow, the TV face pulsing green. No markers.
  3. **The critical**: a hit within `OZ_SOCKET_HIT_PX` (66px) while flashing → **heavy damage**:
     rusted/smashed art, a HUD slot fills, chest-beat rage, attacks speed up (× 0.78) and grow
     (+1 orb). A heavily-damaged screen is a **dead TV** — the face never comes back.
  - A shot on an ineligible/dark component clanks; heavy components smolder red.
- **Everything else dents too.** Arms and legs are cosmetic damage targets
  (`OZ_COSM_LIGHT` 5 hits → light, `OZ_COSM_HEAVY` 12 → heavy) — no gameplay effect, pure
  destruction feedback, and the detonation debris uses the heavy sheet so he comes apart wrecked.
- **He marches.** The baked legs are erased from the body texture (pelvis armor stays) and
  replaced with hip-pivoted planes (`OZ_LEG`, z −0.2 behind the body so the torso overlaps their
  tops) at a proper wide stance (pivots 0.383/0.617). Steps are pow-sharpened lifts — the lifted
  leg tucks slightly inward, the hips sway onto the planted side, footfalls thud the camera when
  the groove is up, and step height scales with the bass.
- Ozamatron's name plate + slots use `#boss-hud.oz` at `top: 84px` — above his face (Jake keeps
  the original 218px).
- **Attacks rotate: throw → laser → throw → missiles.** The attack timer walks that cycle at
  `OZ_ATTACK_MS` (× 0.78 per bomb):
  - **Throws, ape-style** (`OZ_THROW`): the arm winds up overhead over 26 frames — **the wind-up
    is the telegraph** — quivers for 8, then snaps down in 6, releasing **spinning fruit**
    (pineapple/strawberry billboards from the sheet's accessory art, `OZ_FRUIT_SPRITES`) from the
    fist mid-snap while the body lunges. Arms alternate. Fruit is shootable; the raised-fist
    release point is far from every socket (shot priority is projectiles-first).
  - **Laser bursts**: the sprite flashes warm, then `OZ_LASER_BOLTS` fast bolts fire from the
    screen at `OZ_LASER_SPEED`, one every 6 frames, with muzzle-flash and trail particles. Too
    fast to shoot — dodge only.
  - **Missiles**: two from the shoulders, kicked outward then homing at `OZ_MISSILE_SPEED` with
    `OZ_MISSILE_TURN` steering, exhaust-trail particles behind. Shootable, like orbs.
  - A vulnerability window opens after each **throw** and after each **laser burst** (not after
    missiles — they linger).
- **The ship has a shield**: a soft additive bubble that tanks exactly one hit from anything
  (orb, laser, missile, asteroid), then shatters in a particle burst and recharges over
  `S2_SHIELD_FR` (~6s) with a two-note chime on restore. HUD shows `⛨` when up, `◌` while
  recharging, before the hearts.
- **Particles**: a pooled system (`S2_PARTICLES` additive glow sprites, 130 desktop / 70 mobile)
  drives missile exhaust, laser trails, muzzle flashes, impact sparks, and the shield break —
  velocity + drag + fade + grow, zero allocations at runtime.
- **He dances to his own theme.** The theme routes through a WebAudio analyser (wired lazily once
  the shared AudioContext is running); low-bin bass energy drives his bounce, energy spikes count
  as beats and trigger alternating side-rocks, a small scale pop, and arm pumps. With no analyser
  (muted, or before the first tap) he falls back to the sine idle.
- **Chest-beat rage:** each planted bomb triggers a 40-frame alternating chest-beat with low
  thump tones and camera shake; throws pause while he rages.
- Lives: 3, shown in the same repurposed WPNS→LIVES HUD cell as the Jake fight. They **refill to
  full when Ozamatron arrives** (the flight and the boss fight each get a clean bar of lives).

### Victory

Fourth bomb: attacks stop, beeps accelerate for ~1.45s, then triple boom, white flash, and the
robot comes apart into its **actual body parts** — nine debris planes cut from a second texture
(`boss/ozamatron-parts.png`, a generated exploded-parts sheet keyed the same way): TV head,
antenna cap, both shoulder discs, arms, torso core, legs — each flung outward from its true
position on the body. About 1.4s after the debris flies, **`s2WarpOut()`** runs a short
**deep-space beat** (`S2.phase = 'warpout'`): with the wreckage behind you the ship punches the
star rush back up to warp (`S2.starSpeed` ramps toward `S2_STAR_SPEED × 2.6` in `stage2Tick`),
a *RETURNING TO DEEP SPACE* → *SENSORS // ONE LIFEFORM INBOUND* banner pair plays over a rising
warp sting, and ~3.6s later `s2VictoryHandoff()` tears stage 2 down (starfield back, WPNS cell
restored, `STAGE2.done` set) and hands to **the Suess duel** ([stage-suess.md](stage-suess.md)),
whose win in turn leads to **stage 3, the dance-off** ([stage3-dance.md](stage3-dance.md)). The
old *OZAMATRON DESTROYED* victory screen (`s2ShowVictory`) survives only as a fallback if no later
stage is loaded; `STAGE2.done` prevents any stage-2 retrigger either way.

### Defeat

Zero lives: `GAME OVER — OZAMATRON PREVAILS`. `[ RETRY ]` restarts stage 2 from the flight phase
(kills/bombs/lives reset, **score keeps its value** — the run is not reset to the gallery). A
`[ PUSSY MODE ]` button sits alongside it — the shared difficulty selector
([00-overview.md](00-overview.md#difficulty)); in easy mode Ozamatron needs only 2 bombs, fires
slower/fewer, and you get 6 lives.

## Constants

All in the config block at the top of `stage2.js`.

| Constant | Value | Controls |
|---|---|---|
| `S2_LIVES` | 3 | Ship lives. |
| `S2_KILLS_TO_BOSS` | 15 | Drone kills before Ozamatron approaches. |
| `S2_MAX_DRONES` | 8 desktop / 4 mobile | Live drones — same halving discipline as `MAX_ON_SCREEN`. |
| `S2_SPAWN_Z` / `S2_SHIP_Z` | −420 / −14 | World depth of spawns and the ship plane. |
| `S2_STAR_COUNT` | 500 / 300 mobile | Points per star cloud (×2 clouds). |
| `S2_STAR_SPEED` | 2.6 u/frame | On-rails speed feel. |
| `S2_SHIP_AIM_DROP` | 3.5 u | Ship offset below the crosshair, so it can't block the shot. |
| `S2_ASTEROID_MS` | 1500 / 2200 mobile | Hazard cadence. |
| `OZ_BOMBS_NEEDED` | 4 | Bombs to win. **Must equal `OZ_SOCKETS.length`** — see the invariant above. |
| `OZ_SOCKETS` | 4 entries | The bombable components: CRT screen, both discs, torso core. Each carries `part` (keys `OZ_DMG_RECTS`/`OZ_PARTS`), `anchor`, `size`, `z`. |
| `OZ_SOCKET_OPEN_MS` | 1250 / 1600 mobile | The timing window, opened by each throw. Mobile gets longer because fingers. |
| `OZ_CHIP_HITS` | 6 | Shots to grind a core component to light damage. |
| `OZ_COSM_LIGHT` / `OZ_COSM_HEAVY` | 5 / 12 | Cosmetic part damage thresholds (visual only). |
| `OZ_DMG_RECTS` | per-sheet rects | Damage-sheet crops (auto-measured; layouts differ). |
| `OZ_LEG` | rects + hip pivots | The marching leg planes. |
| `OZ_FLASH_SIZE` | 11 u | Glow plane size for the non-screen sockets (discs, torso). |
| `OZ_SOCKET_HIT_PX` | 66 | The accuracy requirement, in projected screen px. |
| `OZ_ATTACK_MS` | 2500 × 0.78^bombs | Attack cadence, angrier per bomb. |
| `OZ_ORB_SPEED` | 1.6 u/frame | Dodge time per orb. |
| `S2_SHIELD_FR` | 360 frames (~6s) | Shield recharge after a tanked hit. |
| `OZ_LASER_SPEED` / `OZ_LASER_BOLTS` | 5.3 u/f, 4 | Laser burst — dodge-only pressure. |
| `OZ_MISSILE_SPEED` / `OZ_MISSILE_TURN` | 1.15 u/f, 0.065 | Homing missiles — slow but persistent. |
| `S2_PARTICLES` | 130 / 70 mobile | Particle pool size. |
| `OZ_HOLD_Z` | −70 | Where the robot parks — fills the view without clipping. |
| `OZ_APPROACH_FR` | 420 frames | Length of the staged arrival (~7s). |
| `OZ_SIZE` | 55 u | Billboard plane size (square, matches the square art). |
| `OZ_ANCHORS` | image fractions | Socket positions measured off the art. |
| `OZ_ARM` | rects + pivots | Arm crops, shoulder pivots, fist release point, sway tuning. |
| `OZ_THROW` | 26/8/6/40 frames | Windup / hold / snap / recover; windup 2.4 rad overhead. |
| `OZ_PARTS` | 9 uv rects | Parts-sheet crops + body anchors for the detonation debris. |
| `OZ_SCREEN_RECT` | [0.359, 0.156, 0.645, 0.371] | The CRT glass on the body sprite — face overlay plane. |
| `OZ_FACE_SPRITE` | `boss/ozamatron-face.png` | Default screen content (512×384, CRT-processed headshot). |

### Debug warp

`?fight=stage2` skips the gallery and Jake entirely and enters the flight phase on load;
`?fight=ozamatron` goes straight to the boss approach (and its retries also skip the flight).
Handled in `script.js`'s manifest `.then()` + `startStage2()`. Testing-only — no UI exposes it.

## Implementation

- `stage2.js` — the whole subsystem, loaded as a plain script tag (build-number `?v=` applies).
  `script.js` bridges in via `preloadStage2()` / `enterStage2()` (STAGE 2 HANDOFF section) and the
  stage-2 branches in `loop()`, `fireShot()`, `shootTarget()`, `spawnTarget()`.
- `libs/three.min.js` — vendored three.js **r140 UMD** (copied from `dnd-map/libs/`, kept separate
  so re-vendoring the map can't break the game). Injected at Jake's defeat, never at page load —
  the gallery must not pay 600KB for a stage most sessions won't reach.
- **Nothing in `stage2.js` may touch `THREE` at parse time** — the file is parsed long before the
  library exists. THREE usage only inside functions called from `startStage2()` onward.
- Rendering: one `WebGLRenderer` on `#stage2Canvas` (z-index 2, same layer as `#gameArea`),
  Lambert materials only, no shadows, pixel ratio capped at 1.5 (1.0 mobile), antialias off on
  mobile. Scene and renderer are built once and reused across retries.
- Hit-testing is **screen-space projection**, not raycasting — project candidates, nearest within
  radius. Same code shape and feel as the 2D `fireShot()`, and cheaper than a Raycaster.
- Shot priority mirrors the Jake fight: **orbs → sockets → drones**.
- 2D DOM effects (`explodeStars`, `explodeDust`, screen flashes, streak popups) are reused at
  projected screen positions rather than reimplemented in 3D.
- `frameCount % 15` throttle on HUD readout writes, matching the gallery's every-8-frames z-sort
  discipline.

## Open questions

- **Ship, drones, and asteroids are still placeholder primitives.** Ozamatron is now real art
  (billboard sprite), but the rest awaits either more sprite art or a model-loader decision —
  r140 UMD has no bundled GLTFLoader; vendoring the matching example loader is the likely path.
- **The boss art source files** are Gemini-generated (`robot.png` full body, `robot_sprite.png`
  parts sheet, in the user's Downloads). The repo carries only the keyed 1024² PNGs; the keying
  scripts were flood-fill from image borders so interior blacks/grays survived.
- **Jake still can't be refought on a win path.** The run now ends through stage 3's dance-off
  rather than an endless-gallery victory screen; whether the post-dance gallery should loop
  stages or escalate is still undecided.
- **Stage-2 retry keeps score.** Deliberate (retrying the hard part shouldn't cost the run), but it
  means score no longer equals gallery kills once a retry has happened.
- **Orb shot gives no score**, matching Jake's panels. Revisit if scoring ever matters.
- **three.js r140** was chosen because it's the exact copy already vendored for the map's 3D globe.
  If the game ever needs a newer feature, the UMD build line ends at r147.
