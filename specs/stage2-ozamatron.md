# Stage 2 — Deep space and Ozamatron

## What it is

Ten kills after Jake the Snake falls, the gallery ends and the game changes shape: the player is
now piloting a ship through 3D space, on rails, always moving forward. The photos stop — targets
are 3D models (placeholders for now). At the end of the run a giant robot, **OZAMATRON**, blocks
the way. He cannot be shot down; the player must **plant 3 bombs** into glowing sockets that only
open in timed windows — good timing and accuracy, or nothing.

This is the second boss and the game's current ending.

## Behavior

### Trigger and hand-off

- Beating Jake sets `jakeDefeated` and immediately starts a **lazy preload** of
  `libs/three.min.js` (~600KB), so it downloads during the interlude kills.
- At **`score === STAGE2_SCORE` (20)** — i.e. 10 gallery kills after Jake — `enterStage2()`
  (`script.js`) winds the gallery down exactly like `startBoss()` does (slow targets to 15%, clear
  after 900ms), shows the *STAGE 2 // ENTERING DEEP SPACE* banner, and calls `startStage2()`
  (`stage2.js`) ~1.1s after the preload resolves.
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
  Glides in from the fog over ~5s, then holds at `OZ_HOLD_Z` (−70 — close and huge), bobbing
  heavily. Name plate reuses the `#boss-hud` styling with **3 bomb slots** instead of an HP bar.
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
- **Bomb sockets ×3** — the two watermelon shoulder discs and the CRT screen itself, each with a
  3D ring+core marker floating just in front of the art. One at a time opens for
  `OZ_SOCKET_OPEN_MS` (glows green, pulses), then everything closes for `OZ_SOCKET_GAP_MS` before
  a random un-bombed socket opens next.
  - **Timing:** a shot only plants while the socket is open.
  - **Accuracy:** the shot must land within `OZ_SOCKET_HIT_PX` (72px) of the socket's projected
    center — tighter than the gallery's 110px assist.
  - A shot on a **closed** socket clanks and sparks; it teaches the rule without punishing.
- A planted bomb turns the socket into a blinking red charge, fills a HUD slot, flashes green, and
  makes Ozamatron angrier: volley interval multiplies by **0.78 per bomb** and each volley gains
  an orb (1 → 2 → 3).
- **Attacks are thrown, ape-style.** The attack timer starts a throw cycle (`OZ_THROW`): the arm
  winds up overhead over 26 frames — **the wind-up is the telegraph** — quivers for 8, then snaps
  down in 6, releasing orbs **from the fist** mid-snap while the body lunges forward. Arms
  alternate. Orbs are shootable, like Jake's panels; an orb reaching the ship costs a life and
  shakes the camera. The release point (a raised fist) is far from every socket at the moment of
  release — shot priority is orbs-first, so an orb born next to a socket would shield it.
- **Chest-beat rage:** each planted bomb triggers a 40-frame alternating chest-beat with low
  thump tones and camera shake; throws pause while he rages.
- Lives: 3, shown in the same repurposed WPNS→LIVES HUD cell as the Jake fight.

### Victory

Third bomb: attacks stop, beeps accelerate for ~1.45s, then triple boom, white flash, and the
robot comes apart into its **actual body parts** — nine debris planes cut from a second texture
(`boss/ozamatron-parts.png`, a generated exploded-parts sheet keyed the same way): TV head,
antenna cap, both shoulder discs, arms, torso core, legs — each flung outward from its true
position on the body. A **victory screen** (*OZAMATRON DESTROYED / PNUT SAVES
THE GALAXY… FOR NOW*) offers `[ RETURN TO THE GALLERY ]`, which restores the WPNS cell, brings the
2D starfield back, and respawns the gallery. `STAGE2.done` prevents any retrigger; the gallery is
endless from there.

### Defeat

Zero lives: `GAME OVER — OZAMATRON PREVAILS`. `[ RETRY ]` restarts stage 2 from the flight phase
(kills/bombs/lives reset, **score keeps its value** — the run is not reset to the gallery).

## Constants

All in the config block at the top of `stage2.js`.

| Constant | Value | Controls |
|---|---|---|
| `STAGE2_SCORE` (script.js) | 20 | Total kills that trigger the hand-off (10 post-Jake). |
| `S2_LIVES` | 3 | Ship lives. |
| `S2_KILLS_TO_BOSS` | 15 | Drone kills before Ozamatron approaches. |
| `S2_MAX_DRONES` | 8 desktop / 4 mobile | Live drones — same halving discipline as `MAX_ON_SCREEN`. |
| `S2_SPAWN_Z` / `S2_SHIP_Z` | −420 / −14 | World depth of spawns and the ship plane. |
| `S2_STAR_COUNT` | 500 / 300 mobile | Points per star cloud (×2 clouds). |
| `S2_STAR_SPEED` | 2.6 u/frame | On-rails speed feel. |
| `S2_SHIP_AIM_DROP` | 3.5 u | Ship offset below the crosshair, so it can't block the shot. |
| `S2_ASTEROID_MS` | 1800 / 2600 mobile | Hazard cadence. |
| `OZ_BOMBS_NEEDED` | 3 | Bombs to win. |
| `OZ_SOCKET_OPEN_MS` | 1500 / 1900 mobile | The timing window. Mobile gets longer because fingers. |
| `OZ_SOCKET_GAP_MS` | 1100 | All-closed pause between windows. |
| `OZ_SOCKET_HIT_PX` | 72 | The accuracy requirement, in projected screen px. |
| `OZ_ATTACK_MS` | 3400 × 0.78^bombs | Volley cadence, angrier per bomb. |
| `OZ_ORB_SPEED` | 1.35 u/frame | Dodge time per orb. |
| `OZ_HOLD_Z` | −85 | Where the robot parks — fills the view without clipping. |
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
- **Jake still can't be refought on a win path**, and stage 2 ends in an endless gallery. Whether
  score 30+ should loop stages, escalate, or roll credits is undecided.
- **Stage-2 retry keeps score.** Deliberate (retrying the hard part shouldn't cost the run), but it
  means score no longer equals gallery kills once a retry has happened.
- **Orb shot gives no score**, matching Jake's panels. Revisit if scoring ever matters.
- **three.js r140** was chosen because it's the exact copy already vendored for the map's 3D globe.
  If the game ever needs a newer feature, the UMD build line ends at r147.
