// ============================================================================
// STAGE 3 — THE DANCE-OFF / PATTICUS MAXIMUS
// Loaded as a plain <script> after script.js and stage2.js; shares their
// global scope (IS_MOBILE, muted, getCtx, playWithGestureFallback, s2Tone,
// s2Flash, s2Banner, explodeStars, spawnTarget…). Pure DOM + CSS — no THREE.
// Entered from s2VictoryHandoff() when the third bomb destroys Ozamatron.
// See specs/stage3-dance.md.
// ============================================================================

const S3_TRACK      = 'audio/pnutsuxnuts_mixdown.mp3';
const S3_SPRITE     = 'boss/patticus.png';    // 23-frame dance strip, 231×230 cells, bottom-aligned
const S3_FRAME_N    = 23;                     // strip cells, row-major from the source sheet
// Frame vocabulary measured off the sheet: which cells mean what.
const S3_FRAMES = {
  lanes: [[6, 12, 3], [13, 7, 10], [2, 5, 0], [1, 4, 14]],  // ← ↓ ↑ → move sets, alternated
  breakdance: [7, 8, 9, 16, 17, 18, 19, 20, 21],            // finale section: he goes off
  taunt: 11,    // finger wag — 3-miss mockery
  gloat: 22,    // fist pump — every miss
  defeat: 15,   // flat on his back
};
const S3_BPM        = 130.7;                  // measured off the mixdown (onset autocorrelation)
const S3_OFFSET_S   = 0.175;                  // first beat of the track, seconds
const S3_VOLUME     = 0.7;                    // louder than the boss themes — the song is the point
const S3_TRAVEL_S   = IS_MOBILE ? 2.0 : 1.8;  // arrow flight time, spawn → receptor
const S3_PERFECT_S  = 0.10;                   // |tap − beat| for PERFECT
const S3_GOOD_S     = 0.22;                   // …for GOOD; outside this is a whiff/miss
const S3_LEAD_BEATS = 16;                     // Patticus solo-grooves before the first arrow
const S3_BTN_DELAY_MS = 15000;                // victory screen holds the gallery button back this long
const S3_MEASURES   = 36;                     // chart length (4/4) — ends ~73s in, song plays on
const S3_ARROW_ROT  = [-90, 180, 0, 90];      // ▲ rotated per lane: ← ↓ ↑ →
const S3_LANE_KEYS  = { ArrowLeft: 0, KeyA: 0, ArrowDown: 1, KeyS: 1,
                        ArrowUp: 2, KeyW: 2, ArrowRight: 3, KeyD: 3 };
const S3_MISS_TAUNTS  = ['PATHETIC FOOTWORK', 'THE CROWD IS MINE', 'IS THAT DANCING?',
                         'MY GRANDMOTHER SPINS BETTER'];
const S3_COMBO_LINES  = { 15: 'IMPOSSIBLE…', 30: 'WHO TAUGHT YOU THAT?!',
                          60: 'NO… THE FUNK… IT\'S SHIFTING' };

// === STATE ===
const S3 = {
  active: false, done: false,
  phase: 'idle',            // idle | intro | dance | victory
  audio: null, notes: [], nextNote: 0, live: [], lastT: 0,
  combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, groove: 50, _missRun: 0,
  el: null, trackEl: null, pxEl: null, receptors: [], recepPx: [],
  trackH: 0, sayTimer: null, finaleT: 0, _poseIdx: 0, _bdIdx: 0,
};
window.STAGE3 = S3;

// === CHART — a fixed routine on the measured beat grid, ramping in density:
// half notes → 3/measure → quarter notes → an eighth-note finale. Lanes come
// from a seeded LCG (deterministic run to run) and never repeat back-to-back,
// so Patticus always strikes a new pose.
function s3BuildChart() {
  const beat = 60 / S3_BPM;
  const notes = [];
  let seed = 0xC0FFEE, lane = -1;
  const rnd  = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = () => { let l; do { l = rnd() * 4 | 0; } while (l === lane); return (lane = l); };
  const push = b => notes.push({
    t: S3_OFFSET_S + (S3_LEAD_BEATS + b) * beat, lane: pick(),
    el: null, judged: false, posed: false,
  });
  for (let m = 0; m < S3_MEASURES; m++) {
    const b = m * 4;
    if (m < 8)       { push(b); push(b + 2); }
    else if (m < 22) { push(b); push(b + 1); push(b + 2); }
    else if (m < 32) { push(b); push(b + 1); push(b + 2); push(b + 3); }
    else             { push(b); push(b + 0.5); push(b + 1); push(b + 2); push(b + 2.5); push(b + 3); }
  }
  return notes;
}

// === ENTRY ===
function startStage3() {
  if (S3.active) return;
  S3.active = true;
  S3.phase  = 'intro';
  S3.notes  = s3BuildChart();
  S3.lastT  = S3.notes[S3.notes.length - 1].t;
  S3.finaleT = S3_OFFSET_S + (S3_LEAD_BEATS + 32 * 4) * (60 / S3_BPM);   // measure 32 — breakdance time
  S3.nextNote = 0; S3.live = [];
  S3.combo = 0; S3.maxCombo = 0; S3.perfect = 0; S3.good = 0; S3.miss = 0;
  S3.groove = 50; S3._missRun = 0;

  s3BuildDom();
  document.getElementById('crosshairCanvas').style.display = 'none';   // nothing to shoot

  if (!S3.audio) {
    S3.audio = new Audio(S3_TRACK);
    S3.audio.loop   = true;          // the winner's anthem never stops
    S3.audio.volume = S3_VOLUME;
    // A 404'd mixdown must not soft-lock the ending — concede the dance-off
    S3.audio.addEventListener('error', () => {
      if (S3.phase !== 'intro') return;
      s3Say('NO MUSIC?! I CANNOT LOSE TO SILENCE', 2400);
      setTimeout(s3Win, 2000);
    });
  }
  S3.audio.currentTime = 0;
  if (!muted) playWithGestureFallback(S3.audio, () => S3.active || S3.done);

  s2Banner('FINAL PHASE // DANCE-OFF');
  s3Say('YOU DARE FUNK WITH ME?', 2600);
}

// === DOM — the floor, the champion, the 4-lane track ===
function s3BuildDom() {
  const root = document.createElement('div');
  root.id = 'danceStage';
  root.style.setProperty('--beat', (60 / S3_BPM).toFixed(4) + 's');
  root.innerHTML = `
    <div class="dance-floor"></div>
    <div class="dance-wash dance-w1"></div>
    <div class="dance-wash dance-w2"></div>
    <div class="disco-ball">🪩</div>
    <div class="dance-spot"></div>
    <div id="dance-hud">
      <div class="dance-name">PATTICUS MAXIMUS</div>
      <div class="dance-sub">GALACTIC DANCE CHAMPION // UNDEFEATED</div>
      <div class="dance-meter-lbl">CROWD HYPE</div>
      <div class="dance-meter"><div id="grooveFill"></div></div>
    </div>
    <div id="patticus">
      <div class="px-say" id="pxSay"></div>
      <div class="px-bob"><div class="px-fig">
        <div class="px-sprite"></div>
      </div></div>
    </div>
    <div id="dance-combo"></div>
    <div id="dance-track">
      <div id="dance-judge"></div>
      <div class="dance-hint" id="danceHint"></div>
    </div>`;
  document.body.appendChild(root);
  S3.el      = root;
  S3.pxEl    = root.querySelector('#patticus');
  S3.trackEl = root.querySelector('#dance-track');
  S3.receptors = [];

  for (let lane = 0; lane < 4; lane++) {
    const r = document.createElement('div');
    r.className = 'd-receptor';
    r.style.left = lane * 25 + '%';
    r.innerHTML = `<span style="transform:rotate(${S3_ARROW_ROT[lane]}deg)">▲</span>`;
    S3.trackEl.appendChild(r);
    S3.receptors.push(r);

    // Real <button>s so script.js's shot handlers (closest('button')) skip them
    const b = document.createElement('button');
    b.className = 'lane-btn';
    b.style.left = lane * 25 + '%';
    const tap = e => { e.preventDefault(); s3Judge(lane); };
    b.addEventListener('touchstart', tap, { passive: false });
    b.addEventListener('mousedown', tap);
    S3.trackEl.appendChild(b);
  }
  s3Layout();
}

function s3Layout() {
  if (!S3.trackEl) return;
  S3.trackH = S3.trackEl.clientHeight - 14;   // spawn just below the bottom edge
  requestAnimationFrame(() => {
    S3.recepPx = S3.receptors.map(r => {
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
  });
}
window.addEventListener('resize', () => { if (S3.el) s3Layout(); });

// === GAME LOOP HOOK — called from loop() in script.js while S3.active ===
function stage3Tick() {
  const a = S3.audio;
  if (S3.phase === 'intro') {
    // The chart is anchored to audio.currentTime, so nothing moves until the
    // track genuinely starts (autoplay fallback / mute can delay it).
    if (muted && frameCount % 240 === 0) s3Say('🔇 UNMUTE — YOU CANNOT FIGHT THE FUNK IN SILENCE', 2200);
    if (a && a.currentTime > 0.02) { S3.phase = 'dance'; s3Hint(); }
    return;
  }
  if (S3.phase !== 'dance') return;
  const t = a.currentTime;

  // Patticus solo-grooves through the lead-in
  if (t < S3.notes[0].t - 0.1) {
    const beatIdx = Math.floor((t - S3_OFFSET_S) / (60 / S3_BPM));
    if (beatIdx !== S3._introBeat) { S3._introBeat = beatIdx; s3Pose([0, 2, 3, 1][((beatIdx % 4) + 4) % 4]); }
  }

  // Spawn arrows that reach the receptor in S3_TRAVEL_S
  while (S3.nextNote < S3.notes.length && S3.notes[S3.nextNote].t - t <= S3_TRAVEL_S) {
    s3SpawnArrow(S3.notes[S3.nextNote++]);
  }

  // Move + resolve live arrows (transform-only, ≤ ~12 elements)
  for (let i = S3.live.length - 1; i >= 0; i--) {
    const n = S3.live[i];
    if (n.judged) { S3.live.splice(i, 1); continue; }   // hit — frozen mid-fade
    const dt = n.t - t;
    if (dt <= 0 && !n.posed) { n.posed = true; s3Pose(n.lane); }   // he dances the note on time
    if (dt < -S3_GOOD_S) { s3MissNote(n); S3.live.splice(i, 1); continue; }
    n.el.style.transform = `translateY(${(dt / S3_TRAVEL_S * S3.trackH).toFixed(1)}px)`;
  }

  // Routine over → Pnut wins
  if (S3.nextNote >= S3.notes.length && S3.live.length === 0 && t > S3.lastT + 1.4) s3Win();
}

function s3SpawnArrow(n) {
  const el = document.createElement('div');
  el.className = 'd-arrow d-lane-' + n.lane;
  el.style.left = n.lane * 25 + '%';
  el.innerHTML = `<span style="transform:rotate(${S3_ARROW_ROT[n.lane]}deg)">▲</span>`;
  el.style.transform = `translateY(${S3.trackH}px)`;
  S3.trackEl.appendChild(el);
  n.el = el;
  S3.live.push(n);
}

// === INPUT — lane taps and arrow keys judged against the beat grid ===
function s3Judge(lane) {
  if (S3.phase !== 'dance') return;
  const t = S3.audio.currentTime;
  const r = S3.receptors[lane];
  r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash');

  let best = null, bestD = S3_GOOD_S;
  for (const n of S3.live) {
    if (n.lane !== lane || n.judged) continue;
    const d = Math.abs(n.t - t);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best) return;   // whiff — no arrow in the window, no penalty

  best.judged = true;
  best.el.classList.add('hit');
  const el = best.el;
  setTimeout(() => el.remove(), 260);
  if (!best.posed) { best.posed = true; s3Pose(lane); }

  const perfect = bestD <= S3_PERFECT_S;
  S3._missRun = 0;
  S3.combo++;
  S3.maxCombo = Math.max(S3.maxCombo, S3.combo);
  if (perfect) {
    S3.perfect++;
    s3Groove(2);
    s3JudgePop('PERFECT', 'j-perfect');
    s2Tone(1400, 0.05, 'sine', 0.07);
    const p = S3.recepPx[lane];
    if (p) explodeStars(p.x, p.y);
  } else {
    S3.good++;
    s3Groove(1);
    s3JudgePop('GOOD', 'j-good');
    s2Tone(900, 0.05, 'sine', 0.06);
  }
  s3SetCombo();
  const line = S3_COMBO_LINES[S3.combo];
  if (line) s3Say(line, 2200);
}

document.addEventListener('keydown', e => {
  if (!S3.active || S3.phase !== 'dance' || e.repeat) return;
  const lane = S3_LANE_KEYS[e.code];
  if (lane === undefined) return;
  e.preventDefault();
  s3Judge(lane);
});

function s3MissNote(n) {
  n.judged = true;
  n.el.classList.add('missed');
  const el = n.el;
  setTimeout(() => el.remove(), 400);
  S3.miss++;
  S3._missRun++;
  S3.combo = 0;
  s3SetCombo();
  s3Groove(-4);
  s3JudgePop('MISS', 'j-miss');
  s2Tone(150, 0.15, 'sawtooth', 0.06);
  s3SetFrame(S3_FRAMES.gloat);   // he loves your failure (next pose overwrites it)
  if (S3._missRun === 3) {
    s3Say(S3_MISS_TAUNTS[Math.floor(Math.random() * S3_MISS_TAUNTS.length)], 2000);
    s3SetFrame(S3_FRAMES.taunt);
    S3._missRun = 0;
  }
}

// === FEEDBACK ===
function s3Groove(d) {
  S3.groove = Math.max(0, Math.min(100, S3.groove + d));
  const f = document.getElementById('grooveFill');
  if (f) f.style.transform = `scaleX(${S3.groove / 100})`;
}

function s3SetCombo() {
  const el = document.getElementById('dance-combo');
  if (!el) return;
  el.textContent = S3.combo + ' COMBO';
  el.classList.toggle('visible', S3.combo >= 4);
}

function s3JudgePop(txt, cls) {
  const el = document.getElementById('dance-judge');
  if (!el) return;
  el.textContent = txt;
  el.className = cls;
  void el.offsetWidth;
  el.classList.add('pop');
}

function s3SetFrame(i) {
  const el = S3.el && S3.el.querySelector('.px-sprite');
  if (el) el.style.backgroundPositionX = (i * 100 / (S3_FRAME_N - 1)).toFixed(4) + '%';
}

function s3Pose(lane) {
  const px = S3.pxEl;
  if (!px || px.classList.contains('defeated')) return;
  px.classList.remove('pose-l', 'pose-d', 'pose-u', 'pose-r');
  void px.offsetWidth;
  px.classList.add(['pose-l', 'pose-d', 'pose-u', 'pose-r'][lane]);
  // Finale section: breakdance sequence; otherwise alternate the lane's move set
  const t = S3.audio ? S3.audio.currentTime : 0;
  if (S3.finaleT && t >= S3.finaleT) {
    s3SetFrame(S3_FRAMES.breakdance[S3._bdIdx++ % S3_FRAMES.breakdance.length]);
  } else {
    const set = S3_FRAMES.lanes[lane];
    s3SetFrame(set[S3._poseIdx++ % set.length]);
  }
}

function s3Say(txt, ms = 1800) {
  const el = document.getElementById('pxSay');
  if (!el) return;
  el.textContent = txt;
  el.classList.add('visible');
  clearTimeout(S3.sayTimer);
  S3.sayTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

function s3Hint() {
  const h = document.getElementById('danceHint');
  if (!h) return;
  h.textContent = IS_MOBILE
    ? 'MATCH HIS MOVES — TAP THE ARROWS ON THE BEAT'
    : 'MATCH HIS MOVES — ARROW KEYS / WASD ON THE BEAT';
  h.classList.add('visible');
  setTimeout(() => h.classList.remove('visible'), 7000);
}

// === VICTORY — the routine ends, the champion falls, the song plays on ===
function s3Win() {
  if (S3.phase === 'victory' || !S3.active) return;
  S3.phase = 'victory';
  if (S3.pxEl) S3.pxEl.classList.add('defeated');
  s3SetFrame(S3_FRAMES.defeat);
  s3Say('OUT-DANCED?! IMPOSSIBLE…', 2600);
  s2Flash('rgba(255,220,80,0.28)');
  [[523, 0], [659, 130], [784, 260], [1047, 400]].forEach(([f, at]) =>
    setTimeout(() => s2Tone(f, 0.18, 'square', 0.1), at));
  playNuttyClip();
  setTimeout(s3ShowVictory, 2000);
}

function s3ShowVictory() {
  const total = S3.notes.length;
  const acc = total ? (S3.perfect + S3.good * 0.5) / total : 0;
  const rating =
    S3.miss === 0 && S3.good === 0 ? 'FLAWLESS FUNK' :
    acc >= 0.9  ? 'CERTIFIED GROOVE MACHINE' :
    acc >= 0.65 ? 'FUNKY ENOUGH' :
                  'SLOPPY, BUT THE GALAXY IS SAVED';
  const overlay = document.createElement('div');
  overlay.id = 'victoryScreen';
  overlay.innerHTML = `
    <div class="gameover-inner">
      <div class="gameover-title victory-title">PATTICUS MAXIMUS OUT-DANCED</div>
      <div class="gameover-sub victory-sub">${rating}</div>
      <div class="dance-stats">PERFECT ${S3.perfect} · GOOD ${S3.good} · MISS ${S3.miss} · MAX COMBO ${S3.maxCombo}</div>
      <div class="dance-stats dance-outro">PNUT SAVES THE GALAXY — AND THE BEAT PLAYS ON</div>
      <button class="gameover-btn dance-return btn-delayed" id="dance-galleryBtn">[ RETURN TO THE GALLERY ]</button>
    </div>`;
  document.body.appendChild(overlay);
  const btn = document.getElementById('dance-galleryBtn');
  btn.addEventListener('click', s3ReturnToGallery);
  // Let the win — and the song — have their moment before offering the exit
  setTimeout(() => btn.classList.remove('btn-delayed'), S3_BTN_DELAY_MS);
}

// The mixdown keeps playing from here — it owns the audio for the rest of the
// session; the gallery theme never comes back (galleryActive() checks S3.done).
function s3ReturnToGallery() {
  const v = document.getElementById('victoryScreen');
  if (v) v.remove();
  if (S3.el) { S3.el.remove(); S3.el = null; S3.trackEl = null; S3.pxEl = null; }
  S3.receptors = []; S3.live = [];
  S3.active = false;
  S3.done   = true;
  S3.phase  = 'idle';
  document.getElementById('crosshairCanvas').style.display = '';
  for (let i = 0; i < MAX_ON_SCREEN; i++) setTimeout(spawnTarget, i * 250);
}

// Mute button hook (called from script.js) — pausing the track pauses the
// dance itself, since all chart timing hangs off audio.currentTime.
function s3ThemeMute() {
  if (!S3.audio) return;
  if (muted) S3.audio.pause();
  else if (S3.active || S3.done) S3.audio.play().catch(() => {});
}
