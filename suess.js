// ============================================================================
// THE SUESS IS LOOSE — the slash-combo assault
// Loaded as a plain <script> after stage3.js; shares their global scope
// (IS_MOBILE, muted, playWithGestureFallback, playNuttyClip, explodeStars,
// s2Banner, s2Flash, s2Tone, playExplosionSfx…). Pure DOM + CSS — no THREE.
// Entered from s2VictoryHandoff() after Ozamatron; its win hands to startStage3.
//
// Swipe to carve slash-cuts into the Suess. Combos set off insane explosions.
// The LIMIT bar drains — keep slashing or your combo BREAKS; fill it to max to
// unleash a screen-nuking LIMIT BREAK. See specs/stage-suess.md.
// ============================================================================

const SUESS_SPRITE  = 'boss/suess.png';    // 6-frame strip: idle windup rage hit rageidle death
const SUESS_THEME    = 'boss/suess-theme.mp3?v=67';   // real track; ?v bumps when replaced (cache-bust)
const SUESS_THEME_START = 12;      // start 12s in — skip the intro, reach the lyrics fast
const SUESS_THEME_VOL   = 0.55;    // target volume (faded in from 0)
const SUESS_FRAMES   = { idle: 0, windup: 1, rage: 2, hit: 3, rageIdle: 4, death: 5 };
const SUESS_FRAME_N  = 6;

const SUESS_HP_MAX      = 600;             // he's a big combo-counter; slashes chip him down
const SUESS_SLASH_DMG   = 1.4;             // base damage per slash, before the combo multiplier
const SUESS_RAGE_AT     = 0.25;            // goes Super Saiyan at 25% HP — and stays that way
const SUESS_RAGE_HEAL_FULL = true;         // transforming refills him to max — a whole second fight
const SUESS_RAGE_DR     = 0.28;            // phase-2 damage taken — even tankier now
const SUESS_SLASH_COOLDOWN = 55;           // ms between registered slashes — caps rate (perf + combo pace)
const SUESS_LIMIT_MAX   = 100;
const SUESS_LIMIT_GAIN  = 8;               // bar refill per slash
const SUESS_LIMIT_DRAIN = [13, 26];        // bar drain per second [p1, p2] — harder to hold combo in P2
const SUESS_LIMIT_BREAK_DMG = 90;          // the super slash (~15% of his health)
const SUESS_SLASH_MIN   = 18;              // px of swipe travel that registers one slash (chains)
const SUESS_EXPLODE_EVERY = 8;             // a big blast every N combo
const SUESS_MILESTONES  = { 10: 'RIPPING', 25: 'SHREDDING', 50: 'BRUTAL', 100: 'GODLIKE' };
const SUESS_WIN_HOLD_MS = 2200;

// he fights back + heals if you slow down [p1, p2]
const SUESS_REGEN_DELAY = 650;             // ms of slash-idle before he starts healing
const SUESS_REGEN_RATE  = [16, 45];        // hp/sec regained while you're slow — Saiyan heals hard
const SUESS_SWING_EVERY = [2200, 780];     // ms between his swings — nearly 2× as often when Saiyan
const SUESS_SWING_TELL  = [720, 400];      // ms wind-up telegraph before a swing lands (tighter in P2)
const SUESS_PARRY_MS    = 320;             // a slash this recent parries the swing
const SUESS_HIT_HEAL    = [48, 140];       // hp he claws back when a swing connects — brutal in P2

// He fires glowing orbs from his crotch the whole fight — rarer before Saiyan,
// a real barrage after. Each slash pops one; an orb that burns its whole fuse
// detonates (breaks your combo + heals him).
const SUESS_ORB_EVERY   = [3400, 1550];    // ms between volleys [p1, p2]
const SUESS_ORB_COUNT   = [2, 3];          // orbs per volley [p1, p2]
const SUESS_ORB_FUSE    = 1500;            // ms an orb lives before it detonates
const SUESS_ORB_SPEED   = 95;              // px/sec drift outward from the crotch
const SUESS_ORB_HEAL    = 45;              // hp he regains per orb that detonates unslashed

// the player can die: connected swings and detonating orbs cost a life
const SUESS_PLAYER_HP   = 4;               // hearts
const SUESS_IFRAME_MS   = 850;             // invuln window after a hit (an orb volley can't instakill)

// on a long combo he teleports away to escape — blinks out, slashes whiff, reappears elsewhere
const SUESS_TP_AT       = [25, 18];        // teleport every N combo [p1, p2] — Saiyan escapes more
const SUESS_TP_GONE_MS  = 480;             // how long he's gone (untargetable) per teleport

// combo → damage multiplier tiers
function suessMult(combo) {
  return combo >= 100 ? 5 : combo >= 50 ? 4 : combo >= 25 ? 3 : combo >= 10 ? 2 : 1;
}

const SUESS_BARKS = {
  entrance: ["I'VE BEEN UP FOR DAYS", 'SPEEDO LIFE', 'HEY MOTHERFUCKER'],
  idle:     ['SLAP THE BAG', 'I THINK THIS IS RINGWORM', 'SOLO LA PUNTITA'],
  break:    ['DERELICT MY BALLS', 'GET UP, LIGHTWEIGHT', 'PARTY HARD OR KILL YOURSELF'],
  limit:    ['NOT LIKE THIS', 'HEY MOTHERFUCKER', 'SOLO LA PUNTITA'],
  powerup:  'THE SUESS IS LOOSE!',
  defeat:   'Oh sweet death, sweet relief',
};

// === STATE ===
const SUESS = {
  active: false, done: false,
  state: 'idle',            // idle | intro | fight | limitbreak | win
  phase: 1,
  hp: SUESS_HP_MAX,
  combo: 0, maxCombo: 0, mult: 1,
  limit: 0, limitReady: false,
  lastTick: 0, lastBark: 0, lastSlash: 0, _lastHit: 0, _lastHurt: 0,
  playerHp: SUESS_PLAYER_HP,
  pendingSwing: false, swingWindup: false, regening: false, promptOn: false,
  orbs: [],                 // live crotch orbs (phase 2)
  gone: false, nextTp: 0,   // teleport-escape on long combos
  drag: null,               // { x, y } while a swipe is in progress
  timers: [],
  audio: null,
  el: null, spriteEl: null, hpFill: null, sayEl: null,
  slashLayer: null, comboEl: null, limitFill: null, limitBtn: null,
};
window.SUESS = SUESS;

function sTimer(fn, ms) { const id = setTimeout(fn, ms); SUESS.timers.push(id); return id; }
function sClearTimers() { SUESS.timers.forEach(clearTimeout); SUESS.timers = []; }

// Master SFX scale for the fight — every synth tone routes through here so the
// slash ticks, booms, and LIMIT-break roar sit well under the music track.
const SUESS_SFX = 0.28;
function sTone(freq, dur, type, vol) { s2Tone(freq, dur, type, vol * SUESS_SFX); }

// === ENTRY ===
function startSuess() {
  if (SUESS.active) return;
  SUESS.active = true; SUESS.done = false;
  SUESS.state = 'intro'; SUESS.phase = 1; SUESS.hp = SUESS_HP_MAX;
  SUESS.combo = 0; SUESS.maxCombo = 0; SUESS.mult = 1;
  SUESS.limit = 0; SUESS.limitReady = false;
  SUESS.lastTick = performance.now(); SUESS.lastBark = 0; SUESS.lastSlash = performance.now(); SUESS._lastHit = 0;
  SUESS.pendingSwing = false; SUESS.swingWindup = false; SUESS.regening = false; SUESS.promptOn = false;
  SUESS.orbs = []; SUESS.drag = null; SUESS.timers = [];
  SUESS.gone = false; SUESS.nextTp = SUESS_TP_AT[0];
  SUESS.playerHp = window.EASY ? 6 : SUESS_PLAYER_HP; SUESS._lastHurt = 0;

  suessBuildDom();
  suessRepurposeLivesCell();
  document.getElementById('crosshairCanvas').style.display = 'none';   // no aiming — you slash

  if (!SUESS.audio) {
    SUESS.audio = new Audio(SUESS_THEME);
    SUESS.audio.loop = true;
    SUESS.audio.addEventListener('error', () => {});
    // The first time playback actually starts, seek to the drop and fade in.
    SUESS.audio.addEventListener('playing', () => {
      if (SUESS._themeFaded) return;
      SUESS._themeFaded = true;
      if (SUESS.audio.currentTime < SUESS_THEME_START - 1) SUESS.audio.currentTime = SUESS_THEME_START;
      suessFadeTheme(0, SUESS_THEME_VOL, 1400);
    });
  }
  SUESS.audio.currentTime = SUESS_THEME_START; SUESS.audio.volume = 0;
  SUESS.audio.playbackRate = 1; SUESS._themeFaded = false;
  if (!muted) playWithGestureFallback(SUESS.audio, () => SUESS.active);

  s2Banner('THE SUESS IS LOOSE');
  requestAnimationFrame(() => SUESS.el.classList.add('visible'));
  sTimer(() => { suessBark('entrance'); suessHint(); }, 500);
  sTimer(() => {
    SUESS.state = 'fight';
    SUESS.lastTick = SUESS.lastSlash = performance.now();
    suessScheduleSwing();
    suessScheduleOrbs();   // orbs fly from the start now (rarer until Saiyan)
  }, 1200);
}

// === DOM ===
function suessBuildDom() {
  const root = document.createElement('div');
  root.id = 'suessStage';
  root.innerHTML = `
    <div id="suess-hud">
      <div class="suess-name">THE SUESS</div>
      <div class="suess-sub">DAYS-DEEP // UNHINGED</div>
      <div class="suess-hp-track"><div id="suess-hp-fill"></div></div>
    </div>
    <div id="suessGuy">
      <div class="suess-say" id="suessSay"></div>
      <div class="suess-bob"><div class="suess-sprite" id="suessSprite"></div></div>
    </div>
    <div id="suess-slashes"></div>
    <div id="suess-combo"></div>
    <div id="suess-break"></div>
    <div id="suess-judge"></div>
    <div id="suess-limit-wrap">
      <div class="suess-limit-lbl">LIMIT</div>
      <div class="suess-limit-track"><div id="suess-limit-fill"></div></div>
    </div>
    <button id="suess-limit">⚡ LIMIT<br>BREAK ⚡</button>
    <div id="suess-prompt">SWIPE TO SLASH</div>
    <div class="suess-hint" id="suessHint"></div>`;
  document.body.appendChild(root);
  SUESS.el         = root;
  SUESS.spriteEl   = root.querySelector('#suessSprite');
  SUESS.hpFill     = root.querySelector('#suess-hp-fill');
  SUESS.sayEl      = root.querySelector('#suessSay');
  SUESS.slashLayer = root.querySelector('#suess-slashes');
  SUESS.comboEl    = root.querySelector('#suess-combo');
  SUESS.limitFill  = root.querySelector('#suess-limit-fill');
  SUESS.limitBtn   = root.querySelector('#suess-limit');
  suessSetFrame(SUESS_FRAMES.idle);
  suessSetHp();

  const lfire = e => { e.preventDefault(); suessFireLimit(); };
  SUESS.limitBtn.addEventListener('touchstart', lfire, { passive: false });
  SUESS.limitBtn.addEventListener('mousedown', lfire);

  // --- swipe = slash; scribbling chains slashes without lifting ---
  const pt = e => (e.touches ? e.touches[0] : e);
  const down = e => { if (e.target.closest('button')) return; const p = pt(e); SUESS.drag = { x: p.clientX, y: p.clientY }; };
  const move = e => {
    if (!SUESS.drag) return;
    if (e.cancelable) e.preventDefault();
    const p = pt(e), dx = p.clientX - SUESS.drag.x, dy = p.clientY - SUESS.drag.y;
    if (Math.hypot(dx, dy) < SUESS_SLASH_MIN) return;
    suessSlash(Math.atan2(dy, dx) * 180 / Math.PI, p.clientX, p.clientY);
    SUESS.drag = { x: p.clientX, y: p.clientY };   // reset origin → next flick chains
  };
  const up = () => { SUESS.drag = null; };
  root.addEventListener('touchstart', down, { passive: false });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('touchend', up);
  root.addEventListener('mousedown', down);
  // The drag has to keep tracking outside the stage, so these two live on
  // window — teardown removes them (root's own listeners die with the node).
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  SUESS._winMove = move; SUESS._winUp = up;
}

function suessSetFrame(i) {
  if (SUESS.spriteEl) SUESS.spriteEl.style.backgroundPositionX = (i * 100 / (SUESS_FRAME_N - 1)).toFixed(3) + '%';
}
function suessSetHp() { if (SUESS.hpFill) SUESS.hpFill.style.transform = `scaleX(${Math.max(0, SUESS.hp) / SUESS_HP_MAX})`; }

// sprite center in screen coords (explosions/slashes land on him)
function suessGuyPoint() {
  const el = SUESS.spriteEl;
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height * 0.45 };
}

// === THE SLASH ===
function suessSlash(angle, px, py) {
  if (SUESS.state !== 'fight') return;
  const now = performance.now();
  SUESS.lastSlash = now;                   // tempo stays fresh even while he's gone (no unfair regen)
  if (SUESS.gone) { sTone(280, 0.04, 'sine', 0.03); return; }   // he teleported — this slash whiffs
  if (SUESS.swingWindup) suessParry();     // slash his incoming swing out of the air
  if (now - SUESS._lastHit < SUESS_SLASH_COOLDOWN) return;   // throttle the heavy work + cap combo pace
  SUESS._lastHit = now;

  SUESS.combo++;
  SUESS.maxCombo = Math.max(SUESS.maxCombo, SUESS.combo);
  SUESS.mult = suessMult(SUESS.combo);
  SUESS.limit = Math.min(SUESS_LIMIT_MAX, SUESS.limit + SUESS_LIMIT_GAIN);
  if (SUESS.limit >= SUESS_LIMIT_MAX && !SUESS.limitReady) suessArmLimit();

  const g = suessGuyPoint();
  suessSpawnSlash(angle, g.x, g.y);
  suessHurt(SUESS_SLASH_DMG * SUESS.mult);
  suessSetCombo();

  if (SUESS.orbs.length) suessPopOrb();         // a slash clears one incoming orb
  if (SUESS.combo & 1) explodeStars(px, py);   // sparks every other hit — halves particle churn
  sTone(520 + Math.min(SUESS.combo, 40) * 14, 0.05, 'square', 0.05);

  if (SUESS.combo % SUESS_EXPLODE_EVERY === 0) suessBigBlast();
  const ms = SUESS_MILESTONES[SUESS.combo];
  if (ms) { suessCallout(ms); s2Banner(ms + '!'); }

  if (!window.EASY && SUESS.combo >= SUESS.nextTp) {   // combo's run too long — he bails (not in easy)
    SUESS.nextTp += SUESS_TP_AT[SUESS.phase - 1];
    suessTeleport();
  }
}

// === TELEPORT ESCAPE — blink out on a long combo, reappear somewhere new ===
function suessTeleport() {
  if (SUESS.gone || SUESS.state !== 'fight') return;
  SUESS.gone = true;
  const guy = document.getElementById('suessGuy');
  const p = suessGuyPoint();
  s2Flash('rgba(170,110,255,0.20)'); explodeStars(p.x, p.y);
  sTone(1300, 0.08, 'sine', 0.06); sTone(280, 0.14, 'sawtooth', 0.05);
  if (guy) guy.classList.add('suess-gone');
  suessSay('TOO SLOW', 1000);
  // reposition while invisible…
  sTimer(() => {
    if (!guy) return;
    guy.style.left = (28 + Math.random() * 44) + '%';    // 28–72% across
    guy.style.bottom = (22 + Math.random() * 26) + 'vh'; // 22–48vh up
  }, SUESS_TP_GONE_MS * 0.5);
  // …then flash back in
  sTimer(() => {
    if (guy) guy.classList.remove('suess-gone');
    SUESS.gone = false;
    const q = suessGuyPoint();
    s2Flash('rgba(170,110,255,0.18)'); explodeStars(q.x, q.y);
    sTone(950, 0.08, 'sine', 0.05);
  }, SUESS_TP_GONE_MS);
}

function suessResetPos() {
  const guy = document.getElementById('suessGuy');
  if (guy) { guy.classList.remove('suess-gone'); guy.style.left = ''; guy.style.bottom = ''; }
  SUESS.gone = false;
}

function suessSpawnSlash(angle, cx, cy) {
  const s = document.createElement('div');
  s.className = 'slash';
  const jx = (Math.random() - 0.5) * 90, jy = (Math.random() - 0.5) * 110;
  s.style.left = (cx + jx) + 'px';
  s.style.top  = (cy + jy) + 'px';
  s.style.setProperty('--r', angle.toFixed(1) + 'deg');   // keyframe reads this for rotation
  if (Math.random() < 0.5) s.classList.add('slash-alt');
  SUESS.slashLayer.appendChild(s);
  setTimeout(() => s.remove(), 300);

  // sprite flinches on the cut
  suessSetFrame(SUESS_FRAMES.hit);
  clearTimeout(SUESS._restFrame);
  SUESS._restFrame = setTimeout(
    () => suessSetFrame(SUESS.phase === 2 ? SUESS_FRAMES.rage : SUESS_FRAMES.idle), 110);
}

function suessBigBlast() {
  const g = suessGuyPoint();
  s2Flash('rgba(255,150,40,0.22)');
  SUESS.el.classList.remove('suess-shake'); void SUESS.el.offsetWidth; SUESS.el.classList.add('suess-shake');
  for (let i = 0; i < 2; i++)
    setTimeout(() => explodeStars(g.x + (Math.random() - 0.5) * 220, g.y + (Math.random() - 0.5) * 220), i * 60);
  // big-blast sound removed — visuals only (flash, shake, spark bursts)
  // sTone(120, 0.18, 'sawtooth', 0.09);
  // sTone(70, 0.24, 'square', 0.07);
  // if (window.playExplosionSfx) playExplosionSfx();
}

// === DAMAGE + PHASES ===
function suessHurt(dmg) {
  if (SUESS.phase === 2 && !window.EASY) dmg *= SUESS_RAGE_DR;   // no damage reduction in easy
  if (window.EASY) dmg *= 3;                                      // …and you hit way harder
  SUESS.hp = Math.max(0, SUESS.hp - dmg);
  suessSetHp();
  if (SUESS.hp <= 0) { suessWin(); return; }
  if (SUESS.phase === 1 && SUESS.hp <= SUESS_HP_MAX * SUESS_RAGE_AT) suessPowerup();
}

function suessPowerup() {
  SUESS.phase = 2;
  if (SUESS.audio) SUESS.audio.playbackRate = 1.12;   // music goes frantic for the Saiyan phase
  if (SUESS_RAGE_HEAL_FULL && !window.EASY) { SUESS.hp = SUESS_HP_MAX; suessSetHp(); }   // no refill in easy
  suessSetFrame(SUESS_FRAMES.rage);
  SUESS.el.classList.add('suess-raging');
  SUESS.el.classList.remove('suess-shake'); void SUESS.el.offsetWidth; SUESS.el.classList.add('suess-shake');
  s2Flash('rgba(255,80,0,0.30)');
  s2Banner(SUESS_BARKS.powerup);
  suessSay(SUESS_BARKS.powerup, 1800);
  [0, 120, 260, 420].forEach((at, i) => sTimer(() => sTone(180 + i * 120, 0.2, 'sawtooth', 0.08), at));
  sTimer(() => { if (SUESS.state === 'fight') suessSetFrame(SUESS_FRAMES.rage); }, 500);
  // orbs are already flying (started at fight begin); the phase flip just makes
  // the volleys more frequent, read live from SUESS_ORB_EVERY[phase-1]
}

// === CROTCH ORBS (phase 2) ===
function suessCrotchPoint() {
  const el = SUESS.spriteEl;
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height * 0.72 };   // lower body
}

function suessScheduleOrbs() {
  if (window.EASY || SUESS.state === 'win' || SUESS.state === 'over') return;   // no orbs in easy
  sTimer(() => {
    if (SUESS.state === 'fight') suessEmitOrbs();
    suessScheduleOrbs();
  }, SUESS_ORB_EVERY[SUESS.phase - 1] * (0.8 + Math.random() * 0.4));
}

function suessEmitOrbs() {
  const c = suessCrotchPoint();
  const count = SUESS_ORB_COUNT[SUESS.phase - 1];
  for (let i = 0; i < count; i++) {
    const deg = 90 + (i - (count - 1) / 2) * (110 / count) + (Math.random() - 0.5) * 22;
    const r = deg * Math.PI / 180;
    const el = document.createElement('div');
    el.className = 'suess-orb';
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
    SUESS.slashLayer.appendChild(el);
    const orb = { el, bx: c.x, by: c.y, ox: 0, oy: 0,
                  vx: Math.cos(r) * SUESS_ORB_SPEED, vy: Math.sin(r) * SUESS_ORB_SPEED, timer: 0 };
    orb.timer = sTimer(() => suessOrbDetonate(orb), SUESS_ORB_FUSE);
    SUESS.orbs.push(orb);
  }
  sTone(300, 0.12, 'sine', 0.02);   // soft low "fwip" — the orbs firing
}

function suessRemoveOrb(orb) {
  const i = SUESS.orbs.indexOf(orb);
  if (i >= 0) SUESS.orbs.splice(i, 1);
  clearTimeout(orb.timer);
  if (orb.el) orb.el.remove();
}

// a slash pops the oldest live orb — keeping tempo clears the barrage
function suessPopOrb() {
  const orb = SUESS.orbs[0];
  if (!orb) return;
  explodeStars(orb.bx + orb.ox, orb.by + orb.oy);
  sTone(560, 0.04, 'sine', 0.025);   // soft blip, not a piercing square
  suessRemoveOrb(orb);
}

function suessOrbDetonate(orb) {
  suessRemoveOrb(orb);
  if (SUESS.state !== 'fight') return;
  s2Flash('rgba(120,255,120,0.22)');
  SUESS.el.classList.remove('suess-shake'); void SUESS.el.offsetWidth; SUESS.el.classList.add('suess-shake');
  sTone(170, 0.16, 'sawtooth', 0.045);
  suessComboBreak();
  if (!window.EASY) { SUESS.hp = Math.min(SUESS_HP_MAX, SUESS.hp + SUESS_ORB_HEAL); suessSetHp(); }
  suessHurtPlayer();                        // an orb to the face costs you a life
}

function suessClearOrbs() {
  SUESS.orbs.forEach(o => { clearTimeout(o.timer); if (o.el) o.el.remove(); });
  SUESS.orbs = [];
}

// === COMBO / LIMIT UI + PRESSURE (per-frame) ===
function suessSetCombo() {
  const el = SUESS.comboEl;
  if (!el) return;
  if (SUESS.combo < 2) { el.classList.remove('visible'); return; }
  el.innerHTML = `<span class="combo-num">${SUESS.combo}</span><span class="combo-x">COMBO</span>` +
                 (SUESS.mult > 1 ? `<span class="combo-mult">×${SUESS.mult}</span>` : '');
  el.className = 'visible tier-' + SUESS.mult;
  void el.offsetWidth; el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 120);
}

function suessArmLimit() {
  SUESS.limitReady = true;
  SUESS.limitBtn.classList.add('ready');
  s2Banner('LIMIT READY');
  suessSay(SUESS_BARKS.limit[0], 1400);
}

function suessFireLimit() {
  if (!SUESS.limitReady || SUESS.state !== 'fight') return;
  SUESS.state = 'limitbreak';
  SUESS.limitReady = false;
  SUESS.limit = 0;
  SUESS.limitBtn.classList.remove('ready');
  SUESS.el.classList.add('suess-limitbreak');
  suessBark('limit');

  const g = suessGuyPoint();
  // a fan of slashes + a barrage of explosions
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      suessSpawnSlash(-90 + i * 32 + (Math.random() - 0.5) * 20, g.x, g.y);
      explodeStars(g.x + (Math.random() - 0.5) * 260, g.y + (Math.random() - 0.5) * 260);
      // LIMIT-break sound removed entirely — visuals only
    }, i * 85);
  }
  setTimeout(() => { s2Flash('rgba(255,230,120,0.42)'); }, 300);
  setTimeout(() => { s2Flash('rgba(255,120,0,0.3)'); }, 520);

  suessHurt(SUESS_LIMIT_BREAK_DMG);       // big chunk (may end the fight)
  SUESS.combo += 10; SUESS.mult = suessMult(SUESS.combo); suessSetCombo();

  sTimer(() => {
    SUESS.el.classList.remove('suess-limitbreak');
    if (SUESS.state === 'limitbreak') { SUESS.state = 'fight'; SUESS.lastTick = performance.now(); }
  }, 1100);
}

function suessComboBreak() {
  const had = SUESS.combo > 2;                 // only the theatrics if a real combo died
  SUESS.combo = 0; SUESS.mult = 1;
  SUESS.limit = 0; SUESS.limitReady = false;
  SUESS.nextTp = SUESS_TP_AT[SUESS.phase - 1];   // teleport clock restarts with the combo
  suessResetPos();                               // and he settles back to center
  if (SUESS.limitBtn) SUESS.limitBtn.classList.remove('ready');
  suessSetCombo();
  suessSetLimit();
  if (!had) return;
  const b = document.getElementById('suess-break');
  if (b) { b.textContent = 'C-C-C-COMBO BREAKER!'; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); }
  // sTone(200, 0.3, 'sawtooth', 0.04);   // combo-break sting muted for testing
  // sTone(90, 0.4, 'square', 0.03);
  if (Date.now() - SUESS.lastBark > 1500) suessBark('break');
}

function suessSetLimit() { if (SUESS.limitFill) SUESS.limitFill.style.transform = `scaleX(${SUESS.limit / SUESS_LIMIT_MAX})`; }

// === HE FIGHTS BACK — telegraphed swings you parry by staying on tempo ===
function suessScheduleSwing() {
  if (SUESS.state !== 'fight' && SUESS.state !== 'limitbreak') return;
  const ez = window.EASY ? 1.9 : 1;   // he swings far less often in easy mode
  sTimer(suessBeginSwing, SUESS_SWING_EVERY[SUESS.phase - 1] * ez * (0.7 + Math.random() * 0.6));
}
function suessBeginSwing() {
  if (SUESS.state !== 'fight') { suessScheduleSwing(); return; }   // wait out a LIMIT BREAK etc.
  SUESS.pendingSwing = true; SUESS.swingWindup = true;
  suessSetFrame(SUESS.phase === 2 ? SUESS_FRAMES.rage : SUESS_FRAMES.windup);   // stay Saiyan in P2
  sTone(300, 0.14, 'sawtooth', 0.05);
  sTimer(suessStrike, SUESS_SWING_TELL[SUESS.phase - 1]);
}
function suessStrike() {
  if (!SUESS.pendingSwing) return;                 // parried already
  SUESS.pendingSwing = false; SUESS.swingWindup = false;
  if (SUESS.gone) { suessScheduleSwing(); return; }   // he teleported mid-swing — it fizzles, no hit
  if (performance.now() - SUESS.lastSlash <= SUESS_PARRY_MS) suessParry();
  else suessSwingHits();
  suessScheduleSwing();
}
function suessParry() {
  if (!SUESS.pendingSwing && !SUESS.swingWindup) return;
  SUESS.pendingSwing = false; SUESS.swingWindup = false;
  suessJudge('PARRY!', 'j-parry');
  sTone(1600, 0.05, 'square', 0.06); sTone(2200, 0.04, 'square', 0.04);
  const g = suessGuyPoint(); explodeStars(g.x, g.y - 20);
}
function suessSwingHits() {
  suessComboBreak();                               // his hit shatters your combo…
  const heal = window.EASY ? 0 : SUESS_HIT_HEAL[SUESS.phase - 1];
  SUESS.hp = Math.min(SUESS_HP_MAX, SUESS.hp + heal);   // …and he claws back life (not in easy)
  suessSetHp();
  suessSetFrame(SUESS.phase === 2 ? SUESS_FRAMES.rage : SUESS_FRAMES.windup);
  clearTimeout(SUESS._restFrame);
  SUESS._restFrame = setTimeout(() => suessSetFrame(SUESS.phase === 2 ? SUESS_FRAMES.rage : SUESS_FRAMES.idle), 300);
  s2Flash('rgba(200,0,0,0.34)');
  SUESS.el.classList.remove('suess-shake'); void SUESS.el.offsetWidth; SUESS.el.classList.add('suess-shake');
  sTone(110, 0.22, 'sawtooth', 0.09);
  suessJudge('HIT!', 'j-hit');
  suessHurtPlayer();                        // his fist costs you a life
}

// === PLAYER LIVES / DEATH ===
function suessLivesStr() {
  return '♥'.repeat(Math.max(0, SUESS.playerHp)) + '♡'.repeat(Math.max(0, SUESS_PLAYER_HP - SUESS.playerHp));
}
function suessHurtPlayer() {
  if (SUESS.state !== 'fight') return;
  const now = performance.now();
  if (now - SUESS._lastHurt < SUESS_IFRAME_MS) return;   // i-frames — a volley can't wipe you at once
  SUESS._lastHurt = now;
  SUESS.playerHp = Math.max(0, SUESS.playerHp - 1);
  suessSetLives();
  s2Flash('rgba(230,0,0,0.5)');
  if (SUESS.playerHp <= 0) sTimer(suessGameOver, 350);
}
// repurpose the WPNS / ARMED HUD cell → lives (mirrors the Jake fight)
function suessRepurposeLivesCell() {
  const a = document.querySelector('.hud-armed');
  if (!a) return;
  a.textContent = suessLivesStr(); a.classList.remove('hud-armed'); a.id = 'lives-val';
  const l = a.previousElementSibling; if (l) l.textContent = 'LIVES';
}
function suessSetLives() { const el = document.getElementById('lives-val'); if (el) el.textContent = suessLivesStr(); }
function suessRestoreWpnsCell() {
  const v = document.getElementById('lives-val');
  if (!v) return;
  v.textContent = 'ARMED'; v.classList.add('hud-armed'); v.removeAttribute('id');
  const l = v.previousElementSibling; if (l) l.textContent = 'WPNS';
}

function suessGameOver() {
  if (SUESS.state === 'over' || SUESS.state === 'win') return;
  sClearTimers(); suessClearOrbs(); suessResetPos();
  SUESS.state = 'over';
  SUESS.pendingSwing = false; SUESS.swingWindup = false;
  suessPrompt(false, false);
  if (SUESS.limitBtn) SUESS.limitBtn.classList.remove('ready');
  suessSetFrame(SUESS.phase === 2 ? SUESS_FRAMES.rage : SUESS_FRAMES.idle);
  if (SUESS.audio) SUESS.audio.pause();
  suessSay(SUESS.phase === 2 ? 'STILL LOOSE, BABY' : 'GET UP, LIGHTWEIGHT', 2600);
  const o = document.createElement('div');
  o.id = 'suessGameOver';
  o.innerHTML = `
    <div class="gameover-inner">
      <div class="gameover-title">THE SUESS GOT YOU</div>
      <div class="gameover-sub">SHOULDA KEPT SLASHING</div>
      <button class="gameover-btn" id="suess-retry">[ RETRY ]</button>
      ${window.easyBtnHtml ? easyBtnHtml() : ''}
    </div>`;
  document.body.appendChild(o);
  // Touch-first like the rest of this stage (bindTap shared from script.js).
  bindTap(document.getElementById('suess-retry'), suessRetry);
  if (window.bindEasyBtn) bindEasyBtn(o, suessRetry);
}

function suessRetry() {
  if (SUESS.state !== 'over') return;   // guard: touchstart + synthesized click can both fire
  const o = document.getElementById('suessGameOver'); if (o) o.remove();
  SUESS.phase = 1; SUESS.hp = SUESS_HP_MAX; SUESS.playerHp = SUESS_PLAYER_HP;
  SUESS.combo = 0; SUESS.mult = 1; SUESS.limit = 0; SUESS.limitReady = false;
  SUESS.pendingSwing = false; SUESS.swingWindup = false; SUESS._lastHurt = 0;
  SUESS.playerHp = window.EASY ? 6 : SUESS_PLAYER_HP;
  SUESS.nextTp = SUESS_TP_AT[0]; suessResetPos();
  SUESS.lastSlash = SUESS.lastTick = performance.now();
  suessClearOrbs();
  SUESS.el.classList.remove('suess-raging', 'suess-defeated', 'suess-limitbreak');
  if (SUESS.hpFill) SUESS.hpFill.parentElement.classList.remove('regen');
  suessSetHp(); suessSetLives(); suessSetCombo(); suessSetLimit();
  suessSetFrame(SUESS_FRAMES.idle);
  if (SUESS.audio) {
    SUESS.audio.playbackRate = 1; SUESS._themeFaded = true; SUESS.audio.volume = SUESS_THEME_VOL;
    if (!muted) { SUESS.audio.currentTime = SUESS_THEME_START; SUESS.audio.play().catch(() => {}); }
  }
  SUESS.state = 'fight';
  suessScheduleSwing();
  suessScheduleOrbs();
}

// called every frame from loop() while SUESS.active
function suessTick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - SUESS.lastTick) / 1000);
  SUESS.lastTick = now;
  if (SUESS.state !== 'fight') return;

  // combo pressure — the LIMIT bar bleeds while a combo is live
  if (SUESS.combo > 0) {
    SUESS.limit -= SUESS_LIMIT_DRAIN[SUESS.phase - 1] * dt;
    if (SUESS.limit <= 0) { SUESS.limit = 0; suessComboBreak(); }
  }
  suessSetLimit();
  if (SUESS.limitFill) SUESS.limitFill.parentElement.classList.toggle('full', SUESS.limitReady);

  // slow down and he heals — the moment you stop, his HP climbs back
  const idle = now - SUESS.lastSlash;
  const regening = !window.EASY && idle > SUESS_REGEN_DELAY && SUESS.hp < SUESS_HP_MAX;
  if (regening) {
    SUESS.hp = Math.min(SUESS_HP_MAX, SUESS.hp + SUESS_REGEN_RATE[SUESS.phase - 1] * dt);
    suessSetHp();
  }
  if (regening !== SUESS.regening) {
    SUESS.regening = regening;
    if (SUESS.hpFill) SUESS.hpFill.parentElement.classList.toggle('regen', regening);
    if (regening && Math.random() < 0.5 && Date.now() - SUESS.lastBark > 3000) suessBark('idle');
  }

  // drift the crotch orbs (transform-only; a handful at most)
  for (const orb of SUESS.orbs) {
    orb.ox += orb.vx * dt; orb.oy += orb.vy * dt;
    orb.el.style.transform = `translate(-50%,-50%) translate(${orb.ox.toFixed(1)}px, ${orb.oy.toFixed(1)}px)`;
  }

  // blinking prompt: nag when idle, scream during his wind-up
  const wantPrompt = SUESS.swingWindup || idle > 450;
  suessPrompt(wantPrompt, SUESS.swingWindup);
}

function suessPrompt(on, urgent) {
  const el = document.getElementById('suess-prompt');
  if (!el) return;
  el.classList.toggle('show', on);
  el.classList.toggle('urgent', on && urgent);
  el.textContent = urgent ? 'SLASH!' : 'SWIPE TO SLASH';
}

// === VICTORY ===
function suessWin() {
  if (SUESS.state === 'win') return;
  sClearTimers();
  SUESS.state = 'win';
  SUESS.pendingSwing = false; SUESS.swingWindup = false;
  suessClearOrbs(); suessResetPos();
  suessPrompt(false, false);
  SUESS.el.classList.add('suess-defeated');
  SUESS.el.classList.remove('suess-limitbreak');
  if (SUESS.limitBtn) SUESS.limitBtn.classList.remove('ready');
  // The winning slash just scheduled a flinch-reset ~110ms out; without this it
  // fires on top of the death pose and he stands back up for the victory hold.
  clearTimeout(SUESS._restFrame);
  suessSetFrame(SUESS_FRAMES.death);
  const g = suessGuyPoint();
  s2Flash('rgba(255,220,80,0.32)');
  for (let i = 0; i < 6; i++) setTimeout(() => explodeStars(g.x + (Math.random() - 0.5) * 260, g.y + (Math.random() - 0.5) * 200), i * 80);
  [180, 120, 90, 60].forEach((f, i) => setTimeout(() => sTone(f, 0.22, 'square', 0.1), i * 110));
  if (window.playExplosionSfx) playExplosionSfx();
  playNuttyClip();
  suessSay(SUESS_BARKS.defeat, 2600);
  s2Banner(`THE SUESS IS LOOSE NO MORE  ·  MAX COMBO ${SUESS.maxCombo}`);
  setTimeout(suessHandoff, SUESS_WIN_HOLD_MS);
}

function suessHandoff() {
  suessTeardown();
  SUESS.active = false; SUESS.done = true; SUESS.state = 'idle';
  if (window.startStage3) startStage3();
  else { document.getElementById('crosshairCanvas').style.display = ''; for (let i = 0; i < MAX_ON_SCREEN; i++) setTimeout(spawnTarget, i * 250); }
}

function suessTeardown() {
  sClearTimers();
  suessClearOrbs();
  suessRestoreWpnsCell();
  clearTimeout(SUESS._restFrame);
  if (SUESS.audio) SUESS.audio.pause();
  if (SUESS._winMove) window.removeEventListener('mousemove', SUESS._winMove);
  if (SUESS._winUp)   window.removeEventListener('mouseup', SUESS._winUp);
  SUESS._winMove = SUESS._winUp = null;
  if (SUESS.el) { SUESS.el.remove(); SUESS.el = null; }
  SUESS.spriteEl = SUESS.hpFill = SUESS.sayEl = SUESS.slashLayer = SUESS.comboEl = SUESS.limitFill = SUESS.limitBtn = null;
  SUESS.drag = null;
}

// === FEEDBACK ===
function suessCallout(txt) {
  const el = SUESS.comboEl;
  if (!el) return;
  const c = document.createElement('div');
  c.className = 'combo-callout'; c.textContent = txt;
  el.appendChild(c);
  setTimeout(() => c.remove(), 900);
}

function suessJudge(txt, cls) {
  const el = document.getElementById('suess-judge');
  if (!el) return;
  el.textContent = txt; el.className = cls;
  void el.offsetWidth; el.classList.add('pop');
}

function suessSay(txt, ms = 1800) {
  const el = SUESS.sayEl;
  if (!el) return;
  el.textContent = txt; el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), ms);
}
function suessBark(slot) {
  const pool = SUESS_BARKS[slot];
  if (!pool || !pool.length) return;
  SUESS.lastBark = Date.now();
  suessSay(pool[Math.random() * pool.length | 0], 1700);
}
function suessHint() {
  const h = document.getElementById('suessHint');
  if (!h) return;
  h.textContent = IS_MOBILE
    ? 'SLASH NONSTOP — SLOW DOWN AND HE HEALS + HITS YOU. FILL LIMIT, UNLEASH IT'
    : 'SLASH NONSTOP (DRAG / ARROWS-WASD) — SLOW = HE HEALS + HITS. SPACE = LIMIT BREAK';
  h.classList.add('visible');
  setTimeout(() => h.classList.remove('visible'), 6000);
}

// === LOOP HOOK is suessTick() above. Keyboard for desktop. ===
const SUESS_KEY_ANGLE = { ArrowUp: -90, KeyW: -90, ArrowDown: 90, KeyS: 90,
                          ArrowLeft: 180, KeyA: 180, ArrowRight: 0, KeyD: 0 };
document.addEventListener('keydown', e => {
  if (!SUESS.active) return;
  if (e.code === 'Space') { e.preventDefault(); suessFireLimit(); return; }
  const a = SUESS_KEY_ANGLE[e.code];
  if (a === undefined) return;
  e.preventDefault();
  const g = SUESS.spriteEl ? suessGuyPoint() : { x: innerWidth / 2, y: innerHeight / 2 };
  suessSlash(a + (Math.random() - 0.5) * 30, g.x + (Math.random() - 0.5) * 120, g.y + (Math.random() - 0.5) * 120);
});

function suessFadeTheme(from, to, ms) {
  const a = SUESS.audio;
  if (!a) return;
  clearInterval(a._fadeTimer);
  const steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  a.volume = Math.max(0, Math.min(1, from));
  a._fadeTimer = setInterval(() => {
    i++;
    a.volume = muted ? 0 : Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
    if (i >= steps) clearInterval(a._fadeTimer);
  }, 50);
}

function suessThemeMute() {
  if (!SUESS.audio) return;
  if (muted) SUESS.audio.pause();
  else if (SUESS.active) SUESS.audio.play().catch(() => {});
}
