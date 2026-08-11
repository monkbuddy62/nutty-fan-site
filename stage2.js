// ============================================================================
// STAGE 2 — DEEP SPACE / OZAMATRON
// Loaded as a plain <script> after script.js. THREE (libs/three.min.js, r140
// UMD) is injected lazily by preloadStage2() in script.js when Jake falls, so
// nothing here may touch THREE at parse time — only inside functions that run
// after startStage2().
// Placeholder geometry throughout: every model is primitives until real
// assets exist. See specs/stage2-ozamatron.md.
// ============================================================================

const S2_LIVES           = 3;
const S2_KILLS_TO_BOSS   = 15;                    // drone kills before Ozamatron approaches
const S2_MAX_DRONES      = IS_MOBILE ? 4 : 8;
const S2_SPAWN_Z         = -420;                  // where drones/asteroids/stars are born
const S2_SHIP_Z          = -14;                   // ship plane in front of camera
const S2_STAR_COUNT      = IS_MOBILE ? 300 : 500; // per cloud, 2 clouds leapfrog
const S2_STAR_SPEED      = 2.6;                   // forward rush, units/frame
const S2_SHIP_AIM_DROP   = 3.5;                   // ship flies below the aim point, never covers it
const S2_ASTEROID_MS     = IS_MOBILE ? 2600 : 1800;
const S2_DRONE_SPAWN_FR  = 30;                    // frames between drone spawn attempts

const OZ_BOMBS_NEEDED    = 3;
const OZ_SOCKET_OPEN_MS  = IS_MOBILE ? 1900 : 1500; // vulnerability window (timing)
const OZ_SOCKET_GAP_MS   = 1100;                  // all-closed pause between windows
const OZ_SOCKET_HIT_PX   = 72;                    // tighter than HIT_RADIUS (accuracy)
const OZ_ATTACK_MS       = 3400;                  // orb volley cadence, shrinks per bomb
const OZ_ORB_SPEED       = 1.35;                  // units/frame toward the ship
const OZ_HOLD_Z          = -70;                   // where Ozamatron parks — close and huge
const OZ_APPROACH_FR     = 300;                   // frames of approach glide (~5s)
const OZ_SPRITE          = 'boss/ozamatron.png';        // keyed billboard art, arms erased
const OZ_PARTS_SPRITE    = 'boss/ozamatron-parts.png';  // keyed parts sheet (arms + debris)
const OZ_SIZE            = 55;                    // sprite plane size in world units (square)
// Socket anchor points as fractions of the sprite image (x→right, y→down)
const OZ_ANCHORS = {
  screen:    [0.495, 0.271],   // the FRUIT-VISION CRT face
  shoulderL: [0.200, 0.326],   // watermelon disc, left
  shoulderR: [0.801, 0.326],   // watermelon disc, right
};
// Overlay arms: separate planes pivoted at the shoulders so Ozamatron can
// wind up and hurl orbs like a gorilla. The baked-in arms were erased from
// the body texture; these use the bent-arm crops from the parts sheet.
const OZ_ARM = {
  // Outer straight-arm crops — clean columns on the sheet edges, no neighbors
  rectL:  [0.018, 0.344, 0.164, 0.664],
  rectR:  [0.835, 0.344, 0.981, 0.664],
  size:   [10.5, 24.5],          // world units — beefy, like the original art
  pivotL: [0.205, 0.350],        // shoulder joints on the body sprite
  pivotR: [0.795, 0.350],
  pivotIn: 0.6,                  // pivot sits this far inboard of the part center
  pivotDown: 2.5,                //  …and this far below its top edge
  fist:  [0.6, -19],             // orb release point in arm-local units (x mirrored for R)
  rest:  0.12,                   // resting outward splay, radians
  sway:  0.10,                   // idle gorilla sway amplitude
};
// Throw cycle in frames: windup raises the arm overhead (this IS the
// telegraph), a short hold, then the snap hurls the orbs from the fist.
const OZ_THROW = {
  windup: 26, hold: 8, snapLen: 6, recover: 40,
  windupAng: 2.4,                // radians past rest, overhead-outboard
  snapAng: 0.35,                 // follow-through past straight down
};
// Detonation debris cut from the parts sheet: uv rect (x→right, y→down),
// anchor = where the part sits on the standing sprite, size in world units.
const OZ_PARTS = [
  { rect: [0.376, 0.054, 0.620, 0.288], anchor: [0.495, 0.270], size: [18.1, 17.4] }, // TV head
  { rect: [0.630, 0.029, 0.771, 0.127], anchor: [0.500, 0.075], size: [6.1, 4.2] },   // antenna cap
  { rect: [0.029, 0.073, 0.200, 0.249], anchor: [0.200, 0.335], size: [10.2, 10.4] }, // disc L
  { rect: [0.791, 0.078, 0.952, 0.254], anchor: [0.800, 0.335], size: [10.2, 10.4] }, // disc R
  { rect: [0.018, 0.344, 0.164, 0.664], anchor: [0.115, 0.620], size: [10.5, 24.5] }, // arm L
  { rect: [0.835, 0.344, 0.981, 0.664], anchor: [0.885, 0.620], size: [10.5, 24.5] }, // arm R
  { rect: [0.391, 0.308, 0.615, 0.505], anchor: [0.500, 0.500], size: [11.9, 10.4] }, // torso core
  { rect: [0.278, 0.469, 0.488, 0.986], anchor: [0.400, 0.730], size: [11.6, 28.7] }, // leg L
  { rect: [0.518, 0.469, 0.737, 0.986], anchor: [0.600, 0.730], size: [11.6, 28.7] }, // leg R
];

// === STATE ===
const S2 = {
  active: false, done: false,
  phase: 'idle',            // idle | flight | approach | boss | victory | gameover
  frame: 0, kills: 0, lives: S2_LIVES, bombs: 0,
  renderer: null, scene: null, camera: null, cvs: null,
  ship: null, halfW: 16, halfH: 9, shake: 0,
  clouds: [], drones: [], asteroids: [], orbs: [],
  oz: null, sockets: [], debris: [],
  throw: null, beatT: 0, _nextArm: 0, _arms: null,
  approachFrame: 0, lastAsteroid: 0, lastDroneFrame: 0,
  socketTimer: null, attackTimer: null,
  hudEl: null,
  _pv: null,                // scratch THREE.Vector3 for projections
};
window.STAGE2 = S2;

// === SCENE BOOT — built once, reused across retries ===
function s2InitScene() {
  const cvs = document.createElement('canvas');
  cvs.id = 'stage2Canvas';
  document.body.appendChild(cvs);
  S2.cvs = cvs;

  S2.renderer = new THREE.WebGLRenderer({
    canvas: cvs, antialias: !IS_MOBILE, alpha: false, powerPreference: 'high-performance',
  });
  S2.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1 : 1.5));
  S2.renderer.setSize(VW, VH);
  S2.renderer.setClearColor(0x000205);

  S2.scene = new THREE.Scene();
  S2.scene.fog = new THREE.FogExp2(0x000308, 0.0038);

  S2.camera = new THREE.PerspectiveCamera(70, VW / VH, 0.1, 1000);
  S2.camera.position.set(0, 0, 0);

  S2.scene.add(new THREE.HemisphereLight(0x66ffdd, 0x140022, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(6, 10, 8);
  S2.scene.add(sun);

  S2._pv = new THREE.Vector3();

  // Fetch the boss art during the flight phase, well before it's needed
  S2._ozTex      = new THREE.TextureLoader().load(OZ_SPRITE);
  S2._ozPartsTex = new THREE.TextureLoader().load(OZ_PARTS_SPRITE);

  s2BuildStars();
  s2BuildShip();
  s2ComputeExtents();

  window.addEventListener('resize', () => {
    if (!S2.renderer) return;
    S2.renderer.setSize(VW, VH);
    S2.camera.aspect = VW / VH;
    S2.camera.updateProjectionMatrix();
    s2ComputeExtents();
  });
}

// Visible half-extents of the ship's plane, so pointer maps edge-to-edge
function s2ComputeExtents() {
  S2.halfH = Math.tan((S2.camera.fov / 2) * Math.PI / 180) * Math.abs(S2_SHIP_Z);
  S2.halfW = S2.halfH * S2.camera.aspect;
}

// === STARFIELD — two point clouds leapfrogging past the camera ===
function s2BuildStars() {
  for (let c = 0; c < 2; c++) {
    const pos = new Float32Array(S2_STAR_COUNT * 3);
    for (let i = 0; i < S2_STAR_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 480;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 300;
      pos[i * 3 + 2] = -Math.random() * 600;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const cloud = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x99ffee, size: 1.7, sizeAttenuation: true, fog: false,
    }));
    cloud.position.z = -600 * c;
    S2.scene.add(cloud);
    S2.clouds.push(cloud);
  }
}

// === SHIP — placeholder: cone fuselage + box wings + engine glow ===
function s2BuildShip() {
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x8899aa, emissive: 0x0a2222 });

  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.2, 8), hullMat);
  nose.rotation.x = -Math.PI / 2;   // point down -z, into the screen
  ship.add(nose);

  const wings = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.18, 1.7), hullMat);
  wings.position.set(0, -0.2, 1.3);
  ship.add(wings);

  const glowMat = new THREE.MeshLambertMaterial({ color: 0x00ffcc, emissive: 0x00ffcc });
  for (const gx of [-0.55, 0.55]) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), glowMat);
    g.position.set(gx, -0.1, 2.15);
    ship.add(g);
  }
  const engineLight = new THREE.PointLight(0x00ffcc, 1.1, 26);
  engineLight.position.set(0, 0, 2.5);
  ship.add(engineLight);

  ship.position.set(0, -S2.halfH, S2_SHIP_Z + 8);
  S2.scene.add(ship);
  S2.ship = ship;
}

// === ENTRY / EXIT ===
function startStage2() {
  if (S2.active) return;
  if (!S2.renderer) s2InitScene();

  S2.active = true;
  S2.phase  = 'flight';
  S2.frame  = 0; S2.kills = 0; S2.bombs = 0; S2.lives = S2_LIVES;
  S2.lastAsteroid = 0; S2.lastDroneFrame = 0;

  // Any gallery target that slipped in while three.min.js loaded
  [...targets].forEach(t => { if (t.fadeTimer) clearTimeout(t.fadeTimer); t.dead = true; t.el.remove(); });
  targets.length = 0;

  document.getElementById('stars').style.display = 'none';
  S2.cvs.classList.add('visible');
  S2.ship.position.set(0, -S2.halfH, S2_SHIP_Z + 8);   // fly in from bottom

  S2.throw = null; S2.beatT = 0;
  s2SetLives();

  // Debug warp (?fight=ozamatron): skip the flight, go straight to the boss
  if (S2.skipToBoss) {
    S2.skipToBoss = false;
    S2._debugBoss = true;   // retries also skip the flight
    S2.kills = S2_KILLS_TO_BOSS;
    s2BeginApproach();
    return;
  }
  s2Banner('STAGE 2 // DEEP SPACE');
}

function s2ReturnToGallery() {
  const v = document.getElementById('victoryScreen');
  if (v) v.remove();
  s2Teardown();
  S2.done  = true;
  S2.phase = 'idle';

  // Restore the LIVES cell to WPNS / ARMED, same as restartGame()
  const livesVal = document.getElementById('lives-val');
  if (livesVal) {
    livesVal.textContent = 'ARMED';
    livesVal.classList.add('hud-armed');
    livesVal.removeAttribute('id');
    const lbl = livesVal.previousElementSibling;
    if (lbl) lbl.textContent = 'WPNS';
  }

  for (let i = 0; i < MAX_ON_SCREEN; i++) setTimeout(spawnTarget, i * 250);
}

// Clears entities + timers + hides the 3D layer. Scene/renderer survive for retries.
function s2Teardown() {
  S2.active = false;
  clearTimeout(S2.socketTimer); S2.socketTimer = null;
  clearTimeout(S2.attackTimer); S2.attackTimer = null;
  [...S2.drones, ...S2.asteroids, ...S2.orbs, ...S2.debris].forEach(o => S2.scene.remove(o.mesh || o));
  S2.drones = []; S2.asteroids = []; S2.orbs = []; S2.debris = [];
  s2RemoveOz();
  if (S2.hudEl) { S2.hudEl.remove(); S2.hudEl = null; }
  if (S2.cvs) S2.cvs.classList.remove('visible');
  document.getElementById('stars').style.display = '';
}

function s2RemoveOz() {
  if (S2.oz) S2.scene.remove(S2.oz);
  S2.oz = null; S2.sockets = [];
  S2._arms = null; S2.throw = null; S2.beatT = 0;
}

// === FLIGHT PHASE — drones to shoot, asteroids to dodge ===
const S2_DRONE_COLORS = [0xff2299, 0x22ffcc, 0xffaa22, 0x8844ff, 0x44aaff];

function s2SpawnDrone() {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.5, 0),
    new THREE.MeshLambertMaterial({
      color: S2_DRONE_COLORS[Math.floor(Math.random() * S2_DRONE_COLORS.length)],
      emissive: 0x220818,
    })
  );
  mesh.position.set(
    (Math.random() - 0.5) * S2.halfW * 3.2,
    (Math.random() - 0.5) * S2.halfH * 2.8,
    S2_SPAWN_Z
  );
  S2.scene.add(mesh);
  S2.drones.push({
    mesh,
    vz: 1.5 + Math.random() * 1.0,
    vx: (Math.random() - 0.5) * 0.06,
    vy: (Math.random() - 0.5) * 0.05,
    spin: 0.02 + Math.random() * 0.05,
  });
}

function s2SpawnAsteroid() {
  const r = 1.4 + Math.random() * 1.8;
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(r, 0),
    new THREE.MeshLambertMaterial({ color: 0x777788, emissive: 0x0a0a10 })
  );
  // Born in the ship's flight column so dodging is mandatory
  mesh.position.set(
    S2.ship.position.x + (Math.random() - 0.5) * 12,
    S2.ship.position.y + (Math.random() - 0.5) * 9,
    S2_SPAWN_Z
  );
  S2.scene.add(mesh);
  S2.asteroids.push({
    mesh, r,
    vz: 1.9 + Math.random() * 0.8,
    rx: (Math.random() - 0.5) * 0.06,
    ry: (Math.random() - 0.5) * 0.06,
  });
}

function s2KillDrone(i, sx, sy) {
  const d = S2.drones[i];
  S2.drones.splice(i, 1);
  S2.scene.remove(d.mesh);

  explodeStars(sx, sy);
  playBoom();
  playNuttyClip();

  score++;
  scoreVal.textContent = String(score).padStart(3, '0');
  const now = Date.now();
  killStreak   = (now - lastKillTime < 1600) ? killStreak + 1 : 1;
  lastKillTime = now;
  if (killStreak >= 3) showStreakPopup(killStreak);

  S2.kills++;
  if (S2.phase === 'flight' && S2.kills >= S2_KILLS_TO_BOSS) s2BeginApproach();
}

// === SHOOTING — screen-space assist, same feel as the 2D game ===
// Projects each candidate to screen px and picks the nearest within radius.
function s2Project(worldPos) {
  const v = S2._pv.copy(worldPos).project(S2.camera);
  if (v.z > 1) return null;   // behind the camera
  return { x: (v.x * 0.5 + 0.5) * VW, y: (-v.y * 0.5 + 0.5) * VH };
}

function stage2Fire() {
  if (S2.phase === 'victory' || S2.phase === 'gameover') return;

  // 1. Incoming orbs — shootable, like Jake's panels
  let best = -1, bestD = HIT_RADIUS, bestP = null;
  for (let i = 0; i < S2.orbs.length; i++) {
    const p = s2Project(S2.orbs[i].mesh.position);
    if (!p) continue;
    const d = Math.hypot(mouseX - p.x, mouseY - p.y);
    if (d < bestD) { bestD = d; best = i; bestP = p; }
  }
  if (best >= 0) {
    const o = S2.orbs[best];
    S2.orbs.splice(best, 1);
    S2.scene.remove(o.mesh);
    explodeStars(bestP.x, bestP.y);
    playBoom();
    return;
  }

  // 2. Bomb sockets — open = plant, closed = clank (accuracy + timing).
  // Open sockets are checked first so a neighboring closed/bombed socket
  // (they sit ~60px apart on screen) can never absorb a well-aimed plant.
  if (S2.phase === 'boss' && S2.oz) {
    let sBest = null, sBestD = OZ_SOCKET_HIT_PX, sBestP = null;
    for (const pass of [s => s.open && !s.bombed, s => !(s.open && !s.bombed)]) {
      for (const s of S2.sockets) {
        if (!pass(s)) continue;
        const p = s2Project(s.group.getWorldPosition(S2._pv));
        if (!p) continue;
        const dd = Math.hypot(mouseX - p.x, mouseY - p.y);
        if (dd < sBestD) { sBestD = dd; sBest = s; sBestP = p; }
      }
      if (sBest) break;
    }
    if (sBest) {
      if (sBest.open && !sBest.bombed) s2PlantBomb(sBest, sBestP);
      else { s2Clank(); explodeDust(sBestP.x, sBestP.y); }
      return;
    }
  }

  // 3. Drones
  best = -1; bestD = HIT_RADIUS; bestP = null;
  for (let i = 0; i < S2.drones.length; i++) {
    const p = s2Project(S2.drones[i].mesh.position);
    if (!p) continue;
    const d = Math.hypot(mouseX - p.x, mouseY - p.y);
    if (d < bestD) { bestD = d; best = i; bestP = p; }
  }
  if (best >= 0) s2KillDrone(best, bestP.x, bestP.y);
}

// === OZAMATRON — billboard sprite boss (art: boss/ozamatron.png) ===
// Image fraction → local plane coords (plane is OZ_SIZE² centered on origin)
function s2SpriteLocal(f) {
  return [(f[0] - 0.5) * OZ_SIZE, (0.5 - f[1]) * OZ_SIZE];
}

// A plane showing one rect of the parts sheet, for detonation debris
function s2PartMesh(part, mat) {
  const geo = new THREE.PlaneGeometry(part.size[0], part.size[1]);
  const uv = geo.attributes.uv;
  const [u0, v0, u1, v1] = part.rect;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), (1 - v1) + uv.getY(i) * (v1 - v0));
  }
  return new THREE.Mesh(geo, mat);
}

function s2BuildOz() {
  const oz = new THREE.Group();
  if (!S2._ozTex)      S2._ozTex      = new THREE.TextureLoader().load(OZ_SPRITE);
  if (!S2._ozPartsTex) S2._ozPartsTex = new THREE.TextureLoader().load(OZ_PARTS_SPRITE);

  S2._ozMat = new THREE.MeshBasicMaterial({ map: S2._ozTex, transparent: true, alphaTest: 0.02 });
  oz.add(new THREE.Mesh(new THREE.PlaneGeometry(OZ_SIZE, OZ_SIZE), S2._ozMat));

  // Gorilla arms: shoulder-pivoted planes, animated in s2UpdateOz
  const armMat = new THREE.MeshBasicMaterial({ map: S2._ozPartsTex, transparent: true, alphaTest: 0.02 });
  S2._arms = [-1, 1].map(side => {
    const mesh = s2PartMesh({ rect: side < 0 ? OZ_ARM.rectL : OZ_ARM.rectR, size: OZ_ARM.size }, armMat);
    // Move the geometry so the shoulder pad sits at the origin — rotation.z
    // then swings the whole arm around the shoulder joint
    mesh.geometry.translate(side * OZ_ARM.pivotIn, -(OZ_ARM.size[1] / 2 - OZ_ARM.pivotDown), 0);
    const [px, py] = s2SpriteLocal(side < 0 ? OZ_ARM.pivotL : OZ_ARM.pivotR);
    mesh.position.set(px, py, 0.3);   // in front of the body, behind the sockets
    mesh.rotation.z = side * OZ_ARM.rest;
    oz.add(mesh);
    return { mesh, side };
  });

  // Bomb sockets ride just in front of the art's own circles:
  // both watermelon shoulder discs + the CRT screen itself
  const mk = f => { const [x, y] = s2SpriteLocal(f); return s2BuildSocket(oz, x, y, 0.6); };
  S2.sockets = [mk(OZ_ANCHORS.screen), mk(OZ_ANCHORS.shoulderL), mk(OZ_ANCHORS.shoulderR)];

  oz.position.set(0, 2, S2_SPAWN_Z);
  S2.scene.add(oz);
  S2.oz = oz;
}

function s2BuildSocket(parent, x, y, z) {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshLambertMaterial({ color: 0x445566, emissive: 0x111111 });
  const coreMat = new THREE.MeshLambertMaterial({ color: 0x222a33, emissive: 0x050808 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.42, 8, 24), ringMat);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 10), coreMat);
  group.add(ring); group.add(core);
  group.position.set(x, y, z);
  parent.add(group);
  return { group, ring, core, ringMat, coreMat, open: false, bombed: false };
}

function s2BeginApproach() {
  S2.phase = 'approach';
  S2.approachFrame = S2.frame;
  s2BuildOz();
  s2Banner('⚠ OZAMATRON APPROACHES ⚠');
}

function s2OzArrived() {
  S2.phase = 'boss';

  const hud = document.createElement('div');
  hud.id = 'boss-hud';
  hud.innerHTML = `<div id="boss-hud-name">OZAMATRON</div>
    <div id="oz-bombs">${'<span class="oz-slot"></span>'.repeat(OZ_BOMBS_NEEDED)}</div>`;
  document.body.appendChild(hud);
  requestAnimationFrame(() => hud.classList.add('visible'));
  S2.hudEl = hud;

  s2SocketCycle();
  s2AttackLoop();
}

// === SOCKET CYCLE — the timing half of the bomb mechanic ===
function s2SocketCycle() {
  if (S2.phase !== 'boss') return;
  const closed = S2.sockets.filter(s => !s.bombed);
  if (!closed.length) return;
  const s = closed[Math.floor(Math.random() * closed.length)];
  s2SetSocketOpen(s, true);
  S2.socketTimer = setTimeout(() => {
    s2SetSocketOpen(s, false);
    S2.socketTimer = setTimeout(s2SocketCycle, OZ_SOCKET_GAP_MS);
  }, OZ_SOCKET_OPEN_MS);
}

function s2SetSocketOpen(s, open) {
  s.open = open;
  if (open) {
    s.ringMat.color.setHex(0x00ff88); s.ringMat.emissive.setHex(0x00cc66);
    s.coreMat.color.setHex(0x00ff88); s.coreMat.emissive.setHex(0x00ff66);
    s2Tone(660, 0.09, 'sine', 0.1);
  } else if (!s.bombed) {
    s.ringMat.color.setHex(0x445566); s.ringMat.emissive.setHex(0x111111);
    s.coreMat.color.setHex(0x222a33); s.coreMat.emissive.setHex(0x050808);
    s.group.scale.setScalar(1);
  }
}

// === BOMBS ===
function s2PlantBomb(s, p) {
  s.bombed = true;
  s.open   = false;
  clearTimeout(S2.socketTimer);

  // Socket becomes an armed bomb: black core, blinking red (blink in s2UpdateOz)
  s.ringMat.color.setHex(0xff3300); s.ringMat.emissive.setHex(0x881100);
  s.coreMat.color.setHex(0x111111); s.coreMat.emissive.setHex(0xff2200);
  s.group.scale.setScalar(1.15);

  S2.bombs++;
  explodeStars(p.x, p.y);
  s2PlantJingle();
  s2Flash('rgba(0,255,130,0.18)');
  S2.beatT = 40;   // furious chest-beat — throws pause while he rages
  const slots = document.querySelectorAll('.oz-slot');
  for (let i = 0; i < S2.bombs && i < slots.length; i++) slots[i].classList.add('planted');

  if (S2.bombs >= OZ_BOMBS_NEEDED) { s2Detonate(); return; }

  // Angrier per bomb: faster volleys, resume the cycle after a breather
  clearTimeout(S2.attackTimer);
  s2AttackLoop();
  S2.socketTimer = setTimeout(s2SocketCycle, 900);
}

function s2Detonate() {
  S2.phase = 'victory';
  clearTimeout(S2.socketTimer);
  clearTimeout(S2.attackTimer);
  S2.orbs.forEach(o => S2.scene.remove(o.mesh));
  S2.orbs = [];

  // Accelerating beeps, then the robot comes apart
  const gaps = [0, 320, 590, 810, 980, 1110, 1200];
  gaps.forEach(g => setTimeout(() => s2Tone(980, 0.06, 'sine', 0.14), g));

  setTimeout(() => {
    for (const s of S2.sockets) {
      const p = s2Project(s.group.getWorldPosition(S2._pv));
      if (p) explodeStars(p.x, p.y);
    }
    [0, 220, 440].forEach(g => setTimeout(playBoom, g));
    playNuttyClip();
    s2Flash('rgba(255,255,255,0.75)');

    // The robot comes apart into its actual body parts (the parts sheet):
    // TV head one way, watermelon discs another, legs straight down and out.
    const partsMat = new THREE.MeshBasicMaterial({ map: S2._ozPartsTex, transparent: true, alphaTest: 0.02 });
    for (const part of OZ_PARTS) {
      const m = s2PartMesh(part, partsMat);
      const [lx, ly] = s2SpriteLocal(part.anchor);
      m.position.set(lx, ly, 0.4).applyMatrix4(S2.oz.matrixWorld);
      S2.scene.add(m);
      S2.debris.push({
        mesh: m,
        vel: new THREE.Vector3(lx * 0.055 + (Math.random() - 0.5) * 0.5,
                               ly * 0.055 + (Math.random() - 0.5) * 0.5,
                               0.6 + Math.random() * 1.1),
        rot: new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.3),
        life: 130,
      });
    }
    S2.scene.remove(S2.oz);
    S2.oz = null; S2.sockets = [];
    if (S2.hudEl) { S2.hudEl.remove(); S2.hudEl = null; }

    setTimeout(s2ShowVictory, 2200);
  }, 1450);
}

function s2ShowVictory() {
  const overlay = document.createElement('div');
  overlay.id = 'victoryScreen';
  overlay.innerHTML = `
    <div class="gameover-inner">
      <div class="gameover-title victory-title">OZAMATRON DESTROYED</div>
      <div class="gameover-sub victory-sub">PNUT SAVES THE GALAXY… FOR NOW</div>
      <button class="gameover-btn" id="galleryBtn">[ RETURN TO THE GALLERY ]</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('galleryBtn').addEventListener('click', s2ReturnToGallery);
}

// === ATTACKS — gorilla throws: windup overhead, snap, orbs from the fist ===
function s2AttackLoop() {
  if (S2.phase !== 'boss') return;
  const interval = OZ_ATTACK_MS * Math.pow(0.78, S2.bombs);
  S2.attackTimer = setTimeout(() => {
    if (S2.phase !== 'boss') return;
    if (!S2.throw && S2.beatT <= 0) {
      S2.throw = { arm: S2._arms[S2._nextArm], t: 0, released: false };
      S2._nextArm = 1 - S2._nextArm;
      s2Tone(140, 0.3, 'sawtooth', 0.1);   // windup growl
    }
    s2AttackLoop();
  }, interval);
}

// Animated every frame from s2UpdateOz while a throw is live
function s2UpdateThrow() {
  const th = S2.throw;
  const { windup, hold, snapLen, recover, windupAng, snapAng } = OZ_THROW;
  const { mesh, side } = th.arm;
  const rest = side * OZ_ARM.rest;
  const up   = side * (OZ_ARM.rest + windupAng);
  const down = -side * snapAng;
  th.t++;

  if (th.t <= windup) {                        // raise overhead (the telegraph)
    const k = th.t / windup;
    mesh.rotation.z = rest + (up - rest) * (1 - Math.pow(1 - k, 2));
  } else if (th.t <= windup + hold) {          // quiver at the top
    mesh.rotation.z = up + Math.sin(th.t * 1.4) * 0.05;
  } else if (th.t <= windup + hold + snapLen) { // the hurl
    const k = (th.t - windup - hold) / snapLen;
    mesh.rotation.z = up + (down - up) * k * k;
    if (!th.released && k >= 0.6) {
      th.released = true;
      s2ReleaseOrbs(th.arm);
      S2.oz.position.z += 2.2;                 // body lunges with the throw
    }
  } else if (th.t <= windup + hold + snapLen + recover) {
    const k = (th.t - windup - hold - snapLen) / recover;
    mesh.rotation.z = down + (rest - down) * k * (2 - k);
  } else {
    mesh.rotation.z = rest;
    S2.throw = null;
  }
}

function s2ReleaseOrbs(arm) {
  if (!S2.oz) return;
  const fist = new THREE.Vector3(-arm.side * OZ_ARM.fist[0], OZ_ARM.fist[1], 0.5);
  arm.mesh.localToWorld(fist);
  const n = 1 + S2.bombs;   // 1 → 3 orbs per throw as bombs land
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xff6600, emissive: 0xff4400 })
    );
    mesh.position.copy(fist);
    const vel = S2.ship.position.clone().sub(fist).normalize().multiplyScalar(OZ_ORB_SPEED);
    vel.x += (Math.random() - 0.5) * 0.3;
    vel.y += (Math.random() - 0.5) * 0.3;
    S2.scene.add(mesh);
    S2.orbs.push({ mesh, vel });
  }
  s2Tone(180, 0.18, 'sawtooth', 0.12);
  S2.shake = Math.max(S2.shake, 5);
}

// === DAMAGE / GAME OVER ===
function s2ShipHit() {
  S2.lives--;
  s2SetLives();
  s2Flash('rgba(255,0,0,0.22)');
  playBoom();
  S2.shake = 14;
  if (S2.lives <= 0) s2GameOver();
}

function s2GameOver() {
  S2.phase = 'gameover';
  clearTimeout(S2.socketTimer);
  clearTimeout(S2.attackTimer);
  const overlay = document.createElement('div');
  overlay.id = 'gameOverScreen';   // this id also blocks fireShot input
  overlay.innerHTML = `
    <div class="gameover-inner">
      <div class="gameover-title">GAME OVER</div>
      <div class="gameover-sub">OZAMATRON PREVAILS — THE GALAXY IS LOST</div>
      <button class="gameover-btn" id="s2RetryBtn">[ RETRY ]</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('s2RetryBtn').addEventListener('click', s2Retry);
}

// Retry restarts stage 2 from the flight phase; the score carries over.
function s2Retry() {
  const overlay = document.getElementById('gameOverScreen');
  if (overlay) overlay.remove();
  [...S2.drones, ...S2.asteroids, ...S2.orbs].forEach(o => S2.scene.remove(o.mesh));
  S2.drones = []; S2.asteroids = []; S2.orbs = [];
  s2RemoveOz();
  if (S2.hudEl) { S2.hudEl.remove(); S2.hudEl = null; }
  S2.phase = 'flight';
  S2.kills = 0; S2.bombs = 0; S2.lives = S2_LIVES;
  S2.ship.position.set(0, -S2.halfH, S2_SHIP_Z + 8);
  s2SetLives();
  if (S2._debugBoss) {   // ?fight=ozamatron session — retry straight into the boss
    S2.kills = S2_KILLS_TO_BOSS;
    s2BeginApproach();
    return;
  }
  s2Banner('STAGE 2 // DEEP SPACE');
}

// === PER-FRAME TICK — called from loop() in script.js while S2.active ===
function stage2Tick() {
  S2.frame++;

  // Ship chases the pointer with inertia; banking follows the error
  const ship = S2.ship;
  let tx = 0, ty = 0;
  if (mouseX > -1000) {
    tx = (Math.min(1, Math.max(0, mouseX / VW)) - 0.5) * 2 * (S2.halfW - 2.2);
    ty = -(Math.min(1, Math.max(0, mouseY / VH)) - 0.5) * 2 * (S2.halfH - 1.8);
    ty = Math.max(-S2.halfH + 1.2, ty - S2_SHIP_AIM_DROP);
  }
  ship.position.x += (tx - ship.position.x) * 0.1;
  ship.position.y += (ty - ship.position.y) * 0.1;
  ship.position.z += (S2_SHIP_Z - ship.position.z) * 0.05;
  ship.rotation.z = (tx - ship.position.x) * -0.1;
  ship.rotation.x = (ty - ship.position.y) * 0.05;

  // Starfield rush
  for (const cloud of S2.clouds) {
    cloud.position.z += S2_STAR_SPEED;
    if (cloud.position.z >= 600) cloud.position.z -= 1200;
  }

  // Flight-phase spawns
  if (S2.phase === 'flight') {
    if (S2.drones.length < S2_MAX_DRONES && S2.frame - S2.lastDroneFrame >= S2_DRONE_SPAWN_FR) {
      S2.lastDroneFrame = S2.frame;
      s2SpawnDrone();
    }
    const now = Date.now();
    if (now - S2.lastAsteroid > S2_ASTEROID_MS) {
      S2.lastAsteroid = now;
      s2SpawnAsteroid();
    }
  }

  // Drones drift toward the camera and are culled behind it
  for (let i = S2.drones.length - 1; i >= 0; i--) {
    const d = S2.drones[i];
    d.mesh.position.z += d.vz;
    d.mesh.position.x += d.vx;
    d.mesh.position.y += d.vy;
    d.mesh.rotation.x += d.spin;
    d.mesh.rotation.y += d.spin * 0.7;
    if (d.mesh.position.z > 0) {
      S2.scene.remove(d.mesh);
      S2.drones.splice(i, 1);
    }
  }

  // Asteroids: dodge or take a hit at the ship plane
  for (let i = S2.asteroids.length - 1; i >= 0; i--) {
    const a = S2.asteroids[i];
    a.mesh.position.z += a.vz;
    a.mesh.rotation.x += a.rx;
    a.mesh.rotation.y += a.ry;
    if (Math.abs(a.mesh.position.z - S2_SHIP_Z) < 2.4 &&
        Math.hypot(a.mesh.position.x - ship.position.x, a.mesh.position.y - ship.position.y) < a.r + 1.5) {
      S2.scene.remove(a.mesh);
      S2.asteroids.splice(i, 1);
      s2ShipHit();
      continue;
    }
    if (a.mesh.position.z > 4) {
      S2.scene.remove(a.mesh);
      S2.asteroids.splice(i, 1);
    }
  }

  // Orbs home on their launch vector; hit the ship or get culled
  for (let i = S2.orbs.length - 1; i >= 0; i--) {
    const o = S2.orbs[i];
    o.mesh.position.add(o.vel);
    if (o.mesh.position.distanceTo(ship.position) < 2.4) {
      S2.scene.remove(o.mesh);
      S2.orbs.splice(i, 1);
      s2ShipHit();
      continue;
    }
    if (o.mesh.position.z > 4) {
      S2.scene.remove(o.mesh);
      S2.orbs.splice(i, 1);
    }
  }

  if (S2.oz) s2UpdateOz();

  // Victory debris flies apart then vanishes
  for (let i = S2.debris.length - 1; i >= 0; i--) {
    const d = S2.debris[i];
    d.mesh.position.add(d.vel);
    d.mesh.rotation.x += d.rot.x;
    d.mesh.rotation.y += d.rot.y;
    d.mesh.rotation.z += d.rot.z;
    if (--d.life <= 0) {
      S2.scene.remove(d.mesh);
      S2.debris.splice(i, 1);
    }
  }

  // Impact shake decays over ~14 frames
  if (S2.shake > 0) {
    S2.shake--;
    const k = S2.shake * 0.028;
    S2.camera.position.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0);
  } else if (S2.camera.position.x !== 0) {
    S2.camera.position.set(0, 0, 0);
  }

  S2.renderer.render(S2.scene, S2.camera);

  // HUD readouts, throttled like the 2D game throttles its z-sort
  if (S2.frame % 15 === 0) {
    targetsValEl.textContent = String(S2.phase === 'boss' ? S2.orbs.length : S2.drones.length).padStart(2, '0');
    speedValEl.textContent = (S2_STAR_SPEED * 3.8).toFixed(1);
  }
}

function s2UpdateOz() {
  const oz = S2.oz;

  // Approach glide, eased
  if (S2.phase === 'approach') {
    const t = Math.min(1, (S2.frame - S2.approachFrame) / OZ_APPROACH_FR);
    const e = 1 - Math.pow(1 - t, 3);
    oz.position.z = S2_SPAWN_Z + (OZ_HOLD_Z - S2_SPAWN_Z) * e;
    if (t >= 1) s2OzArrived();
  }

  // Idle menace: heavy bob, slight sway and roll (small angles — flat sprite)
  const f = S2.frame;
  oz.position.y = 2 + Math.sin(f * 0.017) * 2.2;
  oz.rotation.y = Math.sin(f * 0.008) * 0.07;
  oz.rotation.z = Math.sin(f * 0.011) * 0.03;

  // Throw lunge recovery — ease back to the hold line
  if (S2.phase === 'boss') {
    oz.position.z += (OZ_HOLD_Z - oz.position.z) * 0.06;
  }

  // Arms: throw > chest-beat > gorilla idle sway
  if (S2.throw) s2UpdateThrow();
  if (S2.beatT > 0) {
    // Chest-beat rage after each planted bomb: alternating inboard pumps
    S2.beatT--;
    const bt = 40 - S2.beatT;
    for (const a of S2._arms) {
      const ph = a.side < 0 ? 0 : Math.PI;
      a.mesh.rotation.z = -a.side * (0.95 + Math.sin(bt * 0.7 + ph) * 0.35);
    }
    if (bt % 9 === 0) { s2Tone(70, 0.12, 'square', 0.16); S2.shake = Math.max(S2.shake, 4); }
  } else if (S2._arms) {
    for (const a of S2._arms) {
      if (S2.throw && S2.throw.arm === a) continue;
      const ph = a.side < 0 ? 0 : Math.PI * 0.7;
      const target = a.side * (OZ_ARM.rest + Math.sin(f * 0.03 + ph) * OZ_ARM.sway);
      a.mesh.rotation.z += (target - a.mesh.rotation.z) * 0.08;
    }
  }

  // Open sockets pulse (the "shoot me now" tell); planted bombs blink red
  for (const s of S2.sockets) {
    if (s.open) {
      s.group.scale.setScalar(1 + 0.16 * Math.sin(f * 0.3));
    } else if (s.bombed) {
      s.coreMat.emissive.setHex(f % 30 < 15 ? 0xff2200 : 0x330500);
    }
  }
}

// === HUD / FEEDBACK HELPERS ===
function s2SetLives() {
  let lv = document.getElementById('lives-val');
  if (!lv) {
    const armed = document.querySelector('.hud-armed');
    if (armed) {
      armed.classList.remove('hud-armed');
      armed.id = 'lives-val';
      const lbl = armed.previousElementSibling;
      if (lbl) lbl.textContent = 'LIVES';
      lv = armed;
    }
  }
  if (lv) lv.textContent = '♥'.repeat(Math.max(0, S2.lives)) + '♡'.repeat(Math.max(0, S2_LIVES - S2.lives));
}

function s2Banner(text) {
  let el = document.getElementById('stage2-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stage2-banner';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('visible');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 2800);
}

function s2Flash(color) {
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', inset: '0', background: color,
    pointerEvents: 'none', zIndex: '9998', transition: 'opacity 0.5s',
  });
  document.body.appendChild(flash);
  requestAnimationFrame(() => requestAnimationFrame(() => { flash.style.opacity = '0'; }));
  setTimeout(() => flash.remove(), 600);
}

// === SFX — same WebAudio synth approach as script.js ===
function s2Tone(freq, dur, type, vol) {
  if (muted) return;
  try {
    const c    = getCtx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.start(c.currentTime); osc.stop(c.currentTime + dur + 0.02);
  } catch (e) {}
}

function s2Clank() {
  s2Tone(220, 0.05, 'square', 0.12);
  setTimeout(() => s2Tone(95, 0.09, 'square', 0.1), 30);
}

function s2PlantJingle() {
  [523, 659, 784].forEach((f, i) => setTimeout(() => s2Tone(f, 0.1, 'sine', 0.14), i * 90));
}
