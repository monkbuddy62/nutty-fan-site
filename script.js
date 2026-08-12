const AUDIO_DIR     = 'audio/';
const MEDIA_DIR     = 'media/';
const IS_MOBILE     = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
const MAX_ON_SCREEN = IS_MOBILE ? 6 : 12;
const FLEE_RADIUS   = 150;
const FLEE_FORCE    = 0.12;  // applied to velocity, not world offset
const HIT_RADIUS    = 110;
const MAX_MOVE_SPD  = 3.2;   // px/frame cap after flee
const FIRE_RATE_MS  = 90;
const BASE_PX       = 260;
const GROW_RATE     = 0.007; // scale units per frame (0.15 → 1.0 over ~120 frames)

const audioFiles = [
  'Nuty  this girl is coming on to me.wav',
  'Nutty- And a 3 inch dick_is that on your char sheet_its going to be now.wav',
  'Nutty Molly - I start shoving bread in his bleading hole... ew.wav',
  'Nutty Jake - I shake my head at jake in dissapointment.wav',
  'Nutty - woah yoiu got that recorded right pat.wav',
  'Nutty - thats alot of hate i just wanted a blanket.wav',
  'Nutty - sneaky bite.wav',
  'nutty - ohh i hate mages.wav',
  'Nutty - man these mfrers are useless in a fight.wav',
  'Nutty - ima take that hot iron and ima throw it at the horse.wav',
  'Nutty - Im nutty im playing a paladin named jake.wav',
  'Nutty - if you want me to ill shit on this table.wav',
  'Nutty - I think your just gonna have to shove these up your ass.wav',
  'Nutty - i pee on him.wav',
  'nutty - checking my door for traps.wav',
  'Nutty - can you read dwarven uhh what .wav',
  'Nutty - can i get that 3.5 inch dick.wav',
  'Nutty - and a 3 inch dick.wav',
  'Jake Pat Nut - Nutty shitting on a plate (fulll).wav',
  'Jake Nuty - Chaos Chaos we live by chaos.wav',
];

const streakMessages = {
  3: '🔥 TRIPLE KILL',
  4: '💀 QUAD KILL',
  5: '⚡ RAMPAGE',
  6: '🌀 PNUT OBLITERATED',
  7: '☠️ UNSTOPPABLE',
};

const TARGET_LIFETIME_MS  = 18000;
const REMINISCE_IDLE_MS   = 25000;
const USE_LASER_SFX       = true;   // laser-1/laser-2 mp3s for shots; false = synth pew

// === STATE ===
let mediaFiles          = [];
let targets             = [];
let score               = 0;
let killStreak          = 0;
let lastKillTime        = 0;
let muted               = false;
let mouseX              = -9999;
let mouseY              = -9999;
let audioCtx            = null;
let currentClip         = null;
let shootFlash          = null;      // { x, y, t }
let autoFireTimer       = null;
let frameCount          = 0;
let VW                  = window.innerWidth;
let VH                  = window.innerHeight;
let lastInteractionTime = Date.now();
let reminiscing         = false;
let stage2Preload       = null;      // promise for the lazy three.min.js load

// === SHOOT HINT ===
function showShootHint() {
  const el = document.getElementById('shoot-hint');
  if (!el) return;
  el.classList.add('visible');
  const hide = () => {
    el.classList.remove('visible');
    el.classList.add('hiding');
  };
  const autoHide = setTimeout(hide, 4500);
  const onInteract = () => {
    clearTimeout(autoHide);
    hide();
    document.removeEventListener('mousedown', onInteract);
    document.removeEventListener('touchstart', onInteract);
  };
  document.addEventListener('mousedown', onInteract);
  document.addEventListener('touchstart', onInteract);
}

// === REMINISCING ===
function enterReminiscing() {
  reminiscing = true;
  const b = document.getElementById('reminiscing-banner');
  if (b) b.classList.add('visible');
}

function exitReminiscing() {
  if (!reminiscing) return;
  reminiscing = false;
  const b = document.getElementById('reminiscing-banner');
  if (b) b.classList.remove('visible');
}

function touchInteraction() {
  lastInteractionTime = Date.now();
  exitReminiscing();
}

// === DOM ===
const gameArea      = document.getElementById('gameArea');
const scoreVal      = document.getElementById('scoreVal');
const targetsValEl  = document.getElementById('targetsVal');
const speedValEl    = document.getElementById('speedVal');
const loadingScreen = document.getElementById('loadingScreen');
const loadingText   = document.getElementById('loadingText');
const streakDisp    = document.getElementById('streak-display');
const muteBtn       = document.getElementById('muteBtn');

// === CROSSHAIR CANVAS ===
const xhCanvas = document.getElementById('crosshairCanvas');
const xhCtx    = xhCanvas.getContext('2d');

function resizeXhCanvas() {
  xhCanvas.width  = window.innerWidth;
  xhCanvas.height = window.innerHeight;
}
resizeXhCanvas();

// === AUDIO ===
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// Recorded laser shots, decoded once into WebAudio buffers so the 90ms
// autofire can overlap them freely. Until they're ready (or if loading
// fails, or USE_LASER_SFX is off) the synth pew below still fires.
let laserBuffers = null;
let laserLoading = false;

function loadLaserSfx(c) {
  laserLoading = true;
  Promise.all(['laser-1.mp3', 'laser-2.mp3'].map(f =>
    fetch(AUDIO_DIR + f).then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b))
  )).then(bufs => { laserBuffers = bufs; }).catch(() => {});
}

function playPew() {
  if (muted) return;
  try {
    const c = getCtx();
    if (USE_LASER_SFX) {
      if (!laserBuffers && !laserLoading) loadLaserSfx(c);
      if (laserBuffers) {
        const src  = c.createBufferSource();
        const gain = c.createGain();
        src.buffer = laserBuffers[Math.floor(Math.random() * laserBuffers.length)];
        src.playbackRate.value = 0.94 + Math.random() * 0.12;   // rapid-fire variation
        gain.gain.value = 0.5;
        src.connect(gain); gain.connect(c.destination);
        src.start();
        return;
      }
    }
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sawtooth';
    // slight random pitch variation for the rapid-fire feel
    const baseFreq = 800 + Math.random() * 160;
    osc.frequency.setValueAtTime(baseFreq, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(130, c.currentTime + 0.12);
    gain.gain.setValueAtTime(0.14, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
    osc.start(c.currentTime); osc.stop(c.currentTime + 0.13);
  } catch(e) {}
}

function playBoom() {
  if (muted) return;
  try {
    const c   = getCtx();
    const len = Math.floor(c.sampleRate * 0.35);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src  = c.createBufferSource();
    const flt  = c.createBiquadFilter();
    const gain = c.createGain();
    flt.type = 'lowpass'; flt.frequency.value = 340;
    src.buffer = buf;
    src.connect(flt); flt.connect(gain); gain.connect(c.destination);
    gain.gain.setValueAtTime(0.5, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
    src.start(c.currentTime);
  } catch(e) {}
}

function playNuttyClip() {
  if (muted) return;
  if (currentClip) { currentClip.pause(); currentClip.currentTime = 0; }
  const a = new Audio(AUDIO_DIR + encodeURIComponent(audioFiles[Math.floor(Math.random() * audioFiles.length)]));
  a.play().catch(() => {});
  currentClip = a;
}

// === THEME PLAYBACK — shared autoplay-policy fallback ===
// play() rejects until the page has a trusted gesture (?fight= warps and the
// initial page load both hit this). On rejection, retry on the next tap —
// but only if the requesting phase still wants its music by then.
function playWithGestureFallback(audio, stillWanted) {
  audio.play().catch(() => {
    // Keep retrying on taps until one actually starts playback — a single
    // rejected retry must not consume the fallback
    const cleanup = () => {
      document.removeEventListener('mousedown', kick);
      document.removeEventListener('touchstart', kick);
    };
    const kick = () => {
      if (!stillWanted()) { cleanup(); return; }
      if (muted) return;
      audio.play().then(cleanup).catch(() => {});
    };
    document.addEventListener('mousedown', kick);
    document.addEventListener('touchstart', kick);
  });
}

// === GALLERY THEME — plays whenever the gallery itself is on screen:
// game start, the post-Jake intermission, and the post-stage-2 return.
// Pauses (keeping its place) for boss fights and stage 2.
let galleryTheme = null;

function galleryActive() {
  // Once the dance-off has been won (STAGE3.done), the mixdown owns the audio
  // for the rest of the session — the gallery theme never comes back.
  return !boss.active && !(window.STAGE2 && STAGE2.active)
      && !(window.STAGE3 && (STAGE3.active || STAGE3.done))
      && !document.getElementById('gameOverScreen');
}

function startGalleryTheme() {
  if (!galleryTheme) {
    galleryTheme = new Audio(AUDIO_DIR + 'gallery-theme.mp3');
    galleryTheme.loop = true;
    galleryTheme.volume = 0.45;
  }
  if (muted) return;
  playWithGestureFallback(galleryTheme, galleryActive);
}

function stopGalleryTheme() {
  if (galleryTheme) galleryTheme.pause();   // no rewind — it resumes where it left off
}

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', muted);
  if (muted && currentClip) { currentClip.pause(); currentClip.currentTime = 0; }
  if (muted && jakeVoice) jakeVoice.pause();
  // Boss themes pause/resume rather than restarting
  if (bossTheme) {
    if (muted) bossTheme.pause();
    else if (boss.active) bossTheme.play().catch(() => {});
  }
  if (window.s2ThemeMute) s2ThemeMute();
  if (window.s3ThemeMute) s3ThemeMute();
  if (galleryTheme) {
    if (muted) galleryTheme.pause();
    else if (galleryActive()) galleryTheme.play().catch(() => {});
  }
});

// === EXPLOSION STYLES ===

function spawnParticle(cx, cy, styles, flyX, flyY, duration, delay) {
  const p = document.createElement('div');
  Object.assign(p.style, {
    position: 'fixed',
    left: cx + 'px',
    top: cy + 'px',
    pointerEvents: 'none',
    zIndex: '200',
    transition: `transform ${duration}s ease-out ${delay}s, opacity ${duration}s ease-out ${delay}s`,
    ...styles,
  });
  document.body.appendChild(p);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    p.style.transform = `translate(${flyX}px, ${flyY}px) ${styles._endTransform || ''}`;
    p.style.opacity = '0';
  }));
  setTimeout(() => p.remove(), (duration + delay) * 1000 + 150);
  return p;
}

function explodeDust(cx, cy) {
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 60 + Math.random() * 180;
    const size  = 3 + Math.random() * 7;
    const dur   = 0.4 + Math.random() * 0.45;
    const hue   = 20 + Math.random() * 40;
    const light = 35 + Math.random() * 30;
    spawnParticle(cx, cy, {
      width: size + 'px', height: size + 'px',
      background: `hsl(${hue},15%,${light}%)`,
      borderRadius: '50%',
      transform: 'translate(-50%,-50%)',
      opacity: '1',
    }, Math.cos(angle) * dist, Math.sin(angle) * dist, dur, 0);
  }
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 30 + Math.random() * 80;
    spawnParticle(cx, cy, {
      width: '2px', height: '2px',
      background: 'rgba(200,180,140,0.8)',
      borderRadius: '50%',
      transform: 'translate(-50%,-50%)',
      opacity: '0.8',
    }, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.6 + Math.random() * 0.3, Math.random() * 0.1);
  }
}

function explodeStars(cx, cy) {
  const colors  = ['#ffcc44', '#ff006e', '#00ffcc', '#44eeff', '#ffffff', '#ffaa00'];
  const symbols = ['✦', '★', '✸', '✺', '✷', '⬟'];
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist  = 100 + Math.random() * 220;
    const size  = 10 + Math.random() * 18;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const sym   = symbols[Math.floor(Math.random() * symbols.length)];
    const dur   = 0.55 + Math.random() * 0.45;
    const rot   = (Math.random() - 0.5) * 540;
    const p = spawnParticle(cx, cy, {
      fontSize: size + 'px',
      color,
      textShadow: `0 0 8px ${color}, 0 0 20px ${color}`,
      transform: 'translate(-50%,-50%) rotate(0deg) scale(1)',
      opacity: '1',
      lineHeight: '1',
      _endTransform: `rotate(${rot}deg) scale(0)`,
    }, Math.cos(angle) * dist, Math.sin(angle) * dist, dur, 0);
    p.textContent = sym;
  }
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', left: cx + 'px', top: cy + 'px',
    width: '80px', height: '80px',
    background: 'radial-gradient(circle, rgba(0,255,200,0.85) 0%, transparent 70%)',
    borderRadius: '50%',
    transform: 'translate(-50%,-50%) scale(0)',
    pointerEvents: 'none', zIndex: '199',
    transition: 'transform 0.15s ease-out, opacity 0.3s ease-out 0.1s',
  });
  document.body.appendChild(flash);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    flash.style.transform = 'translate(-50%,-50%) scale(3)';
    flash.style.opacity = '0';
  }));
  setTimeout(() => flash.remove(), 450);
}

function explodeShatter(target) {
  const imgEl = target.el.querySelector('img');
  if (!imgEl || !imgEl.src) { explodeStars(target.screenX, target.screenY); return; }

  const cols = 3, rows = 2;
  const bw = target.w, bh = target.h;
  const pw = bw / cols, ph = bh / rows;
  const ox = target.screenX - bw / 2;   // visual top-left x
  const oy = target.screenY - bh / 2;   // visual top-left y

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = document.createElement('div');
      const px  = ox + c * pw;
      const py  = oy + r * ph;
      const flyX = (c - cols/2 + 0.5) * (120 + Math.random() * 200);
      const flyY = (r - rows/2 + 0.5) * (120 + Math.random() * 200) + 60;
      const rot  = -200 + Math.random() * 400;
      const dur  = 0.55 + Math.random() * 0.25;
      Object.assign(piece.style, {
        position: 'fixed',
        left: px + 'px', top: py + 'px',
        width: pw + 'px', height: ph + 'px',
        backgroundImage: `url(${imgEl.src})`,
        backgroundSize: `${bw}px ${bh}px`,
        backgroundPosition: `-${c * pw}px -${r * ph}px`,
        pointerEvents: 'none', zIndex: '200',
        transition: `transform ${dur}s ease-in, opacity ${dur * 0.8}s ease-in ${dur * 0.2}s`,
        transform: 'rotate(0deg)',
        opacity: '1',
      });
      document.body.appendChild(piece);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        piece.style.transform = `translate(${flyX}px, ${flyY}px) rotate(${rot}deg)`;
        piece.style.opacity = '0';
      }));
      setTimeout(() => piece.remove(), (dur + 0.2) * 1000 + 100);
    }
  }
}

// Radial glass-shatter: the photo breaks into K irregular shards that fan out
// from the exact impact point — every break is different, and the crack
// pattern radiates from where the bullet actually landed.
function explodeShards(target, hx, hy) {
  const imgEl = target.el.querySelector('img');
  const bw = target.w, bh = target.h;
  const ox = target.screenX - bw / 2, oy = target.screenY - bh / 2;
  const rotA = target.rot * Math.PI / 180;

  // Impact point in the photo's own (unrotated) frame, clamped inward
  const dx = (hx ?? target.screenX) - target.screenX;
  const dy = (hy ?? target.screenY) - target.screenY;
  const lx =  dx * Math.cos(rotA) + dy * Math.sin(rotA);
  const ly = -dx * Math.sin(rotA) + dy * Math.cos(rotA);
  const ix = Math.max(bw * 0.15, Math.min(bw * 0.85, bw / 2 + lx));
  const iy = Math.max(bh * 0.15, Math.min(bh * 0.85, bh / 2 + ly));

  const K = 9;
  const angs = [];
  for (let i = 0; i < K; i++) angs.push((i / K) * Math.PI * 2 + (Math.random() - 0.5) * 0.55);
  angs.sort((a, b) => a - b);

  // Ray from the impact point to the rect edge (spilling slightly past it)
  const edge = a => {
    const ex = Math.cos(a), ey = Math.sin(a);
    let t = Infinity;
    if (ex > 0) t = Math.min(t, (bw - ix) / ex); else if (ex < 0) t = Math.min(t, -ix / ex);
    if (ey > 0) t = Math.min(t, (bh - iy) / ey); else if (ey < 0) t = Math.min(t, -iy / ey);
    t *= 1.08;
    return [ix + ex * t, iy + ey * t];
  };

  for (let i = 0; i < K; i++) {
    const a1 = angs[i];
    const a2 = i + 1 < K ? angs[i + 1] : angs[0] + Math.PI * 2;
    const [x1, y1] = edge(a1);
    const [x2, y2] = edge(a2);
    const midA = (a1 + a2) / 2 + rotA;              // fly direction, world space
    const flyD = 150 + Math.random() * 280;
    const dur  = 0.5 + Math.random() * 0.4;
    const rot  = (Math.random() - 0.5) * 440;

    const piece = document.createElement('div');
    Object.assign(piece.style, {
      position: 'fixed', left: ox + 'px', top: oy + 'px',
      width: bw + 'px', height: bh + 'px',
      backgroundImage: `url(${imgEl.src})`,
      backgroundSize: `${bw}px ${bh}px`,
      clipPath: `polygon(${ix}px ${iy}px, ${x1}px ${y1}px, ${x2}px ${y2}px)`,
      transformOrigin: `${bw / 2}px ${bh / 2}px`,
      transform: `rotate(${target.rot}deg)`,
      pointerEvents: 'none', zIndex: '200',
      transition: `transform ${dur}s cubic-bezier(0.2, 0.6, 0.5, 1), opacity ${dur * 0.7}s ease-in ${dur * 0.3}s`,
      opacity: '1',
    });
    document.body.appendChild(piece);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      piece.style.transform =
        `translate(${Math.cos(midA) * flyD}px, ${Math.sin(midA) * flyD + 55}px) rotate(${target.rot + rot}deg) scale(0.92)`;
      piece.style.opacity = '0';
    }));
    setTimeout(() => piece.remove(), dur * 1000 + 150);
  }

  // Hot embers off the impact point
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 50 + Math.random() * 130;
    spawnParticle(hx ?? target.screenX, hy ?? target.screenY, {
      width: '3px', height: '3px',
      background: '#ffcc66', borderRadius: '50%',
      boxShadow: '0 0 8px #ffaa33',
      transform: 'translate(-50%,-50%)', opacity: '1',
    }, Math.cos(a) * d, Math.sin(a) * d, 0.45 + Math.random() * 0.3, 0);
  }
}

function triggerExplosion(target, hx, hy) {
  const el = target.el;
  const cx = target.screenX;
  const cy = target.screenY;

  const flash = document.createElement('div');
  flash.className = 'kill-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 220);

  // Shard break-up is the star of the show; dust and stars stay as variety
  const imgEl = el.querySelector('img');
  const roll = Math.random();
  if (roll < 0.55 && imgEl && imgEl.src) {
    explodeShards(target, hx, hy);
    el.remove();   // the shards ARE the photo now
    setTimeout(spawnTarget, 200 + Math.random() * 600);
    return;
  }
  if (roll < 0.8) explodeStars(cx, cy);
  else            explodeDust(cx, cy);

  // Snap to fixed position so the shrink-out happens in place
  const hw = target.w / 2, hh = target.h / 2;
  el.style.transition = 'none';
  el.style.position   = 'fixed';
  el.style.left       = (cx - hw) + 'px';
  el.style.top        = (cy - hh) + 'px';
  el.style.width      = target.w + 'px';
  el.style.height     = target.h + 'px';
  el.style.transform  = `rotate(${target.rot}deg)`;
  document.body.appendChild(el);

  const finalRot = target.rot + (-180 + Math.random() * 360);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = 'transform 0.4s ease-in, opacity 0.35s ease-in';
    el.style.transform  = `rotate(${finalRot}deg) scale(0.03)`;
    el.style.opacity    = '0';
  }));

  setTimeout(() => {
    el.remove();
    setTimeout(spawnTarget, 200 + Math.random() * 600);
  }, 450);
}

// === WARP STARFIELD ===
const canvas  = document.getElementById('stars');
const sctx    = canvas.getContext('2d');
const NUM_STARS = 320;
let stars = [];

function resetStar(s, randomZ) {
  s.x  = (Math.random() - 0.5) * 2;
  s.y  = (Math.random() - 0.5) * 2;
  s.z  = randomZ ? Math.random() : 1.0;
  s.pz = s.z;
}

function initStars() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  stars = [];
  for (let i = 0; i < NUM_STARS; i++) { const s = {}; resetStar(s, true); stars.push(s); }
}

function drawWarp() {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  sctx.fillStyle = 'rgba(0,0,0,0.18)';
  sctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    s.pz = s.z;
    s.z -= 0.008;
    if (s.z <= 0) { resetStar(s, false); continue; }
    const sx  = (s.x  / s.z)  * cx * 0.55 + cx;
    const sy  = (s.y  / s.z)  * cy * 0.55 + cy;
    const spx = (s.x  / s.pz) * cx * 0.55 + cx;
    const spy = (s.y  / s.pz) * cy * 0.55 + cy;
    if (sx < 0 || sx > W || sy < 0 || sy > H) { resetStar(s, false); continue; }
    const brightness = Math.min(1, (1 - s.z) * 1.4);
    const thickness  = Math.max(0.3, (1 - s.z) * 2.8);
    sctx.beginPath();
    sctx.moveTo(spx, spy);
    sctx.lineTo(sx, sy);
    sctx.strokeStyle = `rgba(180,240,230,${brightness})`;
    sctx.lineWidth = thickness;
    sctx.stroke();
  }
}

// === HUD OVERLAY + CROSSHAIR ===
function drawHudOverlay() {
  const W = xhCanvas.width, H = xhCanvas.height;
  xhCtx.clearRect(0, 0, W, H);

  // Corner brackets
  const bSize = 64, m = 18;
  xhCtx.save();
  xhCtx.strokeStyle = '#00ffcc';
  xhCtx.lineWidth   = 2;
  xhCtx.shadowColor = '#00ffcc';
  xhCtx.shadowBlur  = 12;
  xhCtx.lineCap     = 'square';
  xhCtx.beginPath();
  xhCtx.moveTo(m + bSize, m); xhCtx.lineTo(m,         m); xhCtx.lineTo(m,         m + bSize);
  xhCtx.moveTo(W-m-bSize, m); xhCtx.lineTo(W-m,       m); xhCtx.lineTo(W-m,       m + bSize);
  xhCtx.moveTo(m,   H-m-bSize); xhCtx.lineTo(m,   H-m); xhCtx.lineTo(m+bSize, H-m);
  xhCtx.moveTo(W-m, H-m-bSize); xhCtx.lineTo(W-m, H-m); xhCtx.lineTo(W-m-bSize, H-m);
  xhCtx.stroke();
  xhCtx.restore();

  // Lock-on brackets around the nearest hittable target — same rotated-rect
  // math as the hit test, so what locks is exactly what a shot would hit
  let locked = null, nearestD = Infinity;
  for (const t of targets) {
    if (t.dead) continue;
    const d = distToTarget(mouseX, mouseY, t);
    if (d < targetHitMargin(t) && d < nearestD) { nearestD = d; locked = t; }
  }
  if (locked && locked.w < 550) {
    const pad = 12, tl = 20;
    const hw = locked.w / 2 + pad, hh = locked.h / 2 + pad;
    xhCtx.save();
    // Rotate the whole bracket frame with the photo
    xhCtx.translate(locked.screenX, locked.screenY);
    xhCtx.rotate(locked.rot * Math.PI / 180);
    xhCtx.strokeStyle = '#ff6600';
    xhCtx.shadowColor = '#ff6600';
    xhCtx.shadowBlur  = 14;
    xhCtx.lineWidth   = 1.5;
    xhCtx.lineCap     = 'square';
    xhCtx.beginPath();
    xhCtx.moveTo(-hw+tl,-hh); xhCtx.lineTo(-hw,-hh); xhCtx.lineTo(-hw,-hh+tl);
    xhCtx.moveTo( hw-tl,-hh); xhCtx.lineTo( hw,-hh); xhCtx.lineTo( hw,-hh+tl);
    xhCtx.moveTo(-hw, hh-tl); xhCtx.lineTo(-hw, hh); xhCtx.lineTo(-hw+tl, hh);
    xhCtx.moveTo( hw, hh-tl); xhCtx.lineTo( hw, hh); xhCtx.lineTo( hw-tl, hh);
    xhCtx.stroke();
    xhCtx.restore();
  }

  // Crosshair
  if (mouseX > 0 && mouseX < W && mouseY > 0 && mouseY < H) {
    drawCrosshairAt(mouseX, mouseY);
  }

  // Shoot flash ring
  if (shootFlash) {
    const age = (Date.now() - shootFlash.t) / 200;
    if (age >= 1) {
      shootFlash = null;
    } else {
      xhCtx.save();
      xhCtx.globalAlpha = 1 - age;
      xhCtx.strokeStyle = '#ffffff';
      xhCtx.shadowColor = '#00ffcc';
      xhCtx.shadowBlur  = 18;
      xhCtx.lineWidth   = 2;
      xhCtx.beginPath();
      xhCtx.arc(shootFlash.x, shootFlash.y, age * 50, 0, Math.PI * 2);
      xhCtx.stroke();
      xhCtx.restore();
    }
  }
}

function drawCrosshairAt(x, y) {
  const color  = '#00ffcc';
  const innerR = 11;
  const gap    = 5;
  const lineLen = 22;
  const tickW  = 7;
  const outerR = 42;
  const rot    = (Date.now() / 7000) * Math.PI * 2;

  xhCtx.save();
  xhCtx.strokeStyle = color;
  xhCtx.fillStyle   = color;
  xhCtx.shadowColor = color;
  xhCtx.shadowBlur  = 10;
  xhCtx.lineCap     = 'square';

  xhCtx.lineWidth = 1.5;
  xhCtx.beginPath();
  xhCtx.arc(x, y, innerR, 0, Math.PI * 2);
  xhCtx.stroke();

  xhCtx.beginPath();
  xhCtx.arc(x, y, 1.5, 0, Math.PI * 2);
  xhCtx.fill();

  const ir = innerR + gap, or = innerR + gap + lineLen;
  xhCtx.lineWidth = 1.5;
  xhCtx.beginPath();
  xhCtx.moveTo(x,    y-ir); xhCtx.lineTo(x,    y-or);
  xhCtx.moveTo(x,    y+ir); xhCtx.lineTo(x,    y+or);
  xhCtx.moveTo(x-ir, y   ); xhCtx.lineTo(x-or, y   );
  xhCtx.moveTo(x+ir, y   ); xhCtx.lineTo(x+or, y   );
  xhCtx.stroke();

  xhCtx.lineWidth = 2;
  xhCtx.beginPath();
  xhCtx.moveTo(x-tickW/2, y-or); xhCtx.lineTo(x+tickW/2, y-or);
  xhCtx.moveTo(x-tickW/2, y+or); xhCtx.lineTo(x+tickW/2, y+or);
  xhCtx.moveTo(x-or, y-tickW/2); xhCtx.lineTo(x-or, y+tickW/2);
  xhCtx.moveTo(x+or, y-tickW/2); xhCtx.lineTo(x+or, y+tickW/2);
  xhCtx.stroke();

  xhCtx.lineWidth = 1.5;
  xhCtx.shadowBlur = 8;
  const arc = Math.PI / 5;
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * Math.PI * 2;
    xhCtx.beginPath();
    xhCtx.arc(x, y, outerR, a, a + arc);
    xhCtx.stroke();
  }
  xhCtx.restore();
}

// === TARGETING — rotated-rect hit math shared by lock-on and shots ===
// Distance from a screen point to a target's rotated rectangle (0 = inside).
// The cursor is inverse-rotated into the photo's own frame first, so corners
// of tilted photos are exactly as hittable as they look.
function distToTarget(px, py, t) {
  const a   = t.rot * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const dx  = px - t.screenX, dy = py - t.screenY;
  const lx  =  dx * cos + dy * sin;
  const ly  = -dx * sin + dy * cos;
  const qx  = Math.max(0, Math.abs(lx) - t.w / 2);
  const qy  = Math.max(0, Math.abs(ly) - t.h / 2);
  return Math.hypot(qx, qy);
}

// Grace margin outside the rect: generous for tiny far-away targets (matches
// the old 110px-from-center feel), tighter for big ones you can just hit.
function targetHitMargin(t) {
  return Math.max(40, HIT_RADIUS - Math.min(t.w, t.h) / 2);
}

// === AUTOFIRE — hold mouse to spam pew pew pew ===
function fireShot() {
  playPew();
  shootFlash = { x: mouseX, y: mouseY, t: Date.now() };

  // Stage 2 owns the whole shot (screen-space projection into the 3D scene)
  if (window.STAGE2 && STAGE2.active) { stage2Fire(); return; }

  // Boss panel hit
  for (let i = boss.panels.length - 1; i >= 0; i--) {
    const p = boss.panels[i];
    if (p.dead) continue;
    if (Math.hypot(mouseX - p.x, mouseY - p.y) < HIT_RADIUS) {
      destroyPanel(p);
      boss.panels.splice(i, 1);
      return;
    }
  }

  // Boss weak point (mouth only when open)
  if (boss.active && boss.mouthOpen && boss.el) {
    const r  = boss.el.getBoundingClientRect();
    const cx = r.left + r.width  * 0.5;
    const cy = r.top  + r.height * 0.65;
    if (Math.hypot(mouseX - cx, mouseY - cy) < HIT_RADIUS * 1.5) {
      damageBoss(1);
      return;
    }
  }

  // Normal targets — anywhere on the rotated photo (plus grace margin) hits
  let nearest = null, nearestD = Infinity;
  for (const t of targets) {
    if (t.dead) continue;
    const d = distToTarget(mouseX, mouseY, t);
    if (d < targetHitMargin(t) && d < nearestD) { nearestD = d; nearest = t; }
  }
  if (nearest) shootTarget(nearest);
}

// Mouse
document.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  if (document.getElementById('gameOverScreen')) return;
  if (window.STAGE3 && STAGE3.active) return;   // dance-off: lane buttons only, no shooting
  touchInteraction();
  fireShot();
  autoFireTimer = setInterval(fireShot, FIRE_RATE_MS);
});
document.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  clearInterval(autoFireTimer); autoFireTimer = null;
});
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

// Touch — explicit handling so each tap fires at the right position
document.addEventListener('touchstart', e => {
  if (e.target.closest('button')) return;
  if (document.getElementById('gameOverScreen')) return;
  if (window.STAGE3 && STAGE3.active) return;   // dance-off: lane buttons only, no shooting
  e.preventDefault();
  touchInteraction();
  const t = e.touches[0];
  mouseX = t.clientX; mouseY = t.clientY;
  fireShot();
  clearInterval(autoFireTimer);
  autoFireTimer = setInterval(fireShot, FIRE_RATE_MS);
}, { passive: false });

document.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  mouseX = t.clientX; mouseY = t.clientY;
}, { passive: false });

document.addEventListener('touchend', e => {
  e.preventDefault();
  clearInterval(autoFireTimer); autoFireTimer = null;
}, { passive: false });

window.addEventListener('resize', () => {
  VW = window.innerWidth;
  VH = window.innerHeight;
  initStars();
  resizeXhCanvas();
});

// === LOAD & START ===
fetch('media/manifest.json')
  .then(r => { if (!r.ok) throw new Error(); return r.json(); })
  .then(files => {
    mediaFiles = files;
    loadingScreen.classList.add('gone');
    initStars();
    requestAnimationFrame(loop);

    // Debug warp: ?fight=stage2 jumps to the flight, ?fight=ozamatron to the
    // boss, ?fight=dance straight to the Patticus Maximus dance-off
    const fight = new URLSearchParams(location.search).get('fight');
    if (fight === 'dance' && window.startStage3) {
      startStage3();
      return;
    }
    if ((fight === 'stage2' || fight === 'ozamatron') && window.STAGE2) {
      STAGE2.skipToBoss = fight === 'ozamatron';
      enterStage2();
      return;
    }

    for (let i = 0; i < MAX_ON_SCREEN; i++) spawnTarget();
    setTimeout(showShootHint, 1200);
    startGalleryTheme();
  })
  .catch(() => {
    loadingText.textContent = 'Add files to media/ and run build-manifest.py';
    loadingText.style.animationName = 'none';
    loadingText.style.opacity = '1';
    loadingText.style.color = '#00ffcc';
    initStars();
    requestAnimationFrame(loop);
  });

// === SPAWN — targets enter from all four screen edges and grow as they close in ===
function spawnTarget() {
  if (boss.active || (window.STAGE2 && STAGE2.active) || (window.STAGE3 && STAGE3.active)) return;
  if (!mediaFiles.length || targets.length >= MAX_ON_SCREEN) return;

  const active = new Set(targets.map(t => t.file));
  const pool   = mediaFiles.filter(f => !active.has(f));
  const src    = pool.length ? pool : mediaFiles;
  const file   = src[Math.floor(Math.random() * src.length)];
  const ext    = file.split('.').pop().toLowerCase();
  const isVideo = ext === 'mp4' || ext === 'webm' || ext === 'mov';

  const W = VW, H = VH;

  // Spawn at a random screen edge
  let sx, sy;
  switch (Math.floor(Math.random() * 4)) {
    case 0: sx = Math.random() * W;    sy = -100;    break; // top
    case 1: sx = W + 100;              sy = Math.random() * H; break; // right
    case 2: sx = Math.random() * W;    sy = H + 100; break; // bottom
    case 3: sx = -100;                 sy = Math.random() * H; break; // left
  }

  // Aim toward a random point in the middle 50% of the screen
  const tx  = W * 0.25 + Math.random() * W * 0.5;
  const ty  = H * 0.25 + Math.random() * H * 0.5;
  const d   = Math.hypot(tx - sx, ty - sy);
  const spd = 1.0 + Math.random() * 1.4;

  const baseSize = 200 + Math.random() * 120;
  const scale0   = 0.15;
  const rot      = (Math.random() - 0.5) * 30;
  const rotSpeed = (Math.random() - 0.5) * 0.15;

  const el = document.createElement('div');
  el.className = 'target';
  el.style.cssText = `width:${BASE_PX}px;left:0;top:0;transform:translate(${sx - BASE_PX/2}px,${sy - BASE_PX/2}px) scale(${scale0}) rotate(${rot}deg)`;

  const target = {
    el, file, isVideo,
    sx, sy,
    vx: (tx - sx) / d * spd,
    vy: (ty - sy) / d * spd,
    baseSize, scale: scale0,
    hRatio: 1,
    rot, rotSpeed,
    dead: false,
    screenX: sx, screenY: sy,
    w: baseSize * scale0, h: baseSize * scale0,
    fadeTimer: null,
  };

  target.fadeTimer = setTimeout(() => fadeTarget(target), TARGET_LIFETIME_MS);

  if (isVideo) {
    const vid = document.createElement('video');
    vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
    vid.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
    vid.src = MEDIA_DIR + encodeURIComponent(file);
    vid.addEventListener('loadedmetadata', () => {
      if (vid.videoWidth > 0) target.hRatio = vid.videoHeight / vid.videoWidth;
    }, { once: true });
    el.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.alt = ''; img.loading = 'lazy';
    img.onload = () => { if (img.naturalWidth > 0) target.hRatio = img.naturalHeight / img.naturalWidth; };
    img.src = MEDIA_DIR + encodeURIComponent(file);
    el.appendChild(img);
  }

  targets.push(target);
  gameArea.appendChild(el);
}

// === FADE — lifetime expiry ===
function fadeTarget(t) {
  if (t.dead) return;
  t.el.style.transition = 'opacity 2.5s ease';
  t.el.style.opacity = '0';
  setTimeout(() => {
    if (t.dead) return;
    t.dead = true;
    t.el.remove();
    const idx = targets.indexOf(t);
    if (idx !== -1) targets.splice(idx, 1);
    setTimeout(spawnTarget, 100 + Math.random() * 400);
  }, 2600);
}

// Meaty through-and-through impact
// The big one — reserved for boss deaths (Jake's shatter, Ozamatron's blast)
let explosionSfx = null;

function playExplosionSfx() {
  if (muted) return;
  if (!explosionSfx) {
    explosionSfx = new Audio(AUDIO_DIR + 'explosion.mp3');
    explosionSfx.volume = 0.8;
  }
  explosionSfx.currentTime = 0;
  explosionSfx.play().catch(() => {});
}

function playThunk() {
  if (muted) return;
  try {
    const c    = getCtx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(240, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, c.currentTime + 0.1);
    gain.gain.setValueAtTime(0.16, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
    osc.start(c.currentTime); osc.stop(c.currentTime + 0.13);
  } catch (e) {}
}

// A bullet punches clean through: a hole appears at the hit point, the photo
// takes an impact kick and keeps flying — wounded. The next hit kills.
function punchHole(t, hx, hy) {
  t.hasHole = true;

  // Hit point in element units (the el is BASE_PX wide pre-transform)
  const a = t.rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const dx = hx - t.screenX, dy = hy - t.screenY;
  const lx =  dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const s  = (t.w / BASE_PX) || 1;
  const ex = BASE_PX / 2 + lx / s;
  const ey = (BASE_PX * (t.hRatio || 1)) / 2 + ly / s;
  const r  = 26 + Math.random() * 10;   // element units — hole scales with the photo
  const m  = `radial-gradient(circle at ${ex}px ${ey}px, transparent ${r}px, black ${r + 9}px)`;
  t.el.style.webkitMaskImage = m;
  t.el.style.maskImage = m;

  // Impact physics: kicked away from the hit point, set tumbling
  const d = Math.hypot(dx, dy) || 1;
  t.vx += (-dx / d) * 2.4;
  t.vy += (-dy / d) * 2.4;
  t.rotSpeed = Math.max(-2.5, Math.min(2.5, t.rotSpeed + (Math.random() - 0.5) * 3));

  explodeDust(hx, hy);
  playThunk();
}

// === SHOOT — explode immediately in place ===
function shootTarget(target) {
  if (target.dead) return;

  // Big photos sometimes take a through-and-through first — hole, jolt,
  // still flying. No score for a wound; the follow-up shot kills.
  if (!target.hasHole && target.w > 180 && !boss.sucking && Math.random() < 0.45) {
    punchHole(target, mouseX, mouseY);
    return;
  }

  target.dead = true;
  if (target.fadeTimer) { clearTimeout(target.fadeTimer); target.fadeTimer = null; }
  targets.splice(targets.indexOf(target), 1);

  score++;
  scoreVal.textContent = String(score).padStart(3, '0');
  if (score === BOSS_SCORE && !boss.active) startBoss();

  const now = Date.now();
  killStreak   = (now - lastKillTime < 1600) ? killStreak + 1 : 1;
  lastKillTime = now;
  if (killStreak >= 3) showStreakPopup(killStreak);

  playBoom();
  playNuttyClip();
  target._dx = 0;
  target._dy = 0;
  triggerExplosion(target, mouseX, mouseY);
}

// === GAME LOOP ===
function loop() {
  frameCount++;

  // Stage 3 (the dance-off) is pure DOM — the warp starfield keeps running
  // behind the dance floor, but shooting and the crosshair are done.
  if (window.STAGE3 && STAGE3.active) {
    drawWarp();
    stage3Tick();
    requestAnimationFrame(loop);
    return;
  }

  // Stage 2 owns the frame: the 3D scene renders instead of warp + targets.
  // The crosshair overlay stays — same reticle in both worlds.
  if (window.STAGE2 && STAGE2.active) {
    stage2Tick();
    drawHudOverlay();
    requestAnimationFrame(loop);
    return;
  }

  drawWarp();
  drawHudOverlay();

  let totalSpeed = 0, activeCount = 0;

  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (t.dead) continue;

    // Jake's entrance: photos spiral into his mouth, shrinking as they go
    if (boss.sucking) {
      const m  = bossMouthPoint();
      const dx = m.x - t.sx, dy = m.y - t.sy;
      const d  = Math.hypot(dx, dy) || 1;
      t.suckV  = (t.suckV || 3) * 1.045;              // accelerating pull, ~1.2s total
      t.sx    += dx / d * Math.min(t.suckV, d);
      t.sy    += dy / d * Math.min(t.suckV, d);
      t.rot   += 9;
      t.scale  = Math.max(0.04, t.scale * 0.955);
      const shr = t.hRatio || 1;
      const sdw = t.baseSize * t.scale;
      t.screenX = t.sx; t.screenY = t.sy;
      t.w = sdw; t.h = sdw * shr;
      t.el.style.transform = `translate(${t.sx - BASE_PX / 2}px,${t.sy - BASE_PX * shr / 2}px) scale(${sdw / BASE_PX}) rotate(${t.rot}deg)`;
      if (d < 45) {                                    // ...gulp
        t.dead = true;
        t.el.remove();
        targets.splice(i, 1);
        explodeDust(m.x, m.y);
      }
      continue;
    }

    // Flee: only compute hypot when cursor is plausibly close (cheap AABB pre-check)
    const fx = mouseX - t.sx;
    const fy = mouseY - t.sy;
    if (Math.abs(fx) < FLEE_RADIUS && Math.abs(fy) < FLEE_RADIUS) {
      const dist = Math.hypot(fx, fy);
      if (dist < FLEE_RADIUS && dist > 0) {
        const force = ((FLEE_RADIUS - dist) / FLEE_RADIUS) * FLEE_FORCE;
        t.vx -= (fx / dist) * force;
        t.vy -= (fy / dist) * force;
        // cap only when flee just modified velocity
        const spd2 = t.vx * t.vx + t.vy * t.vy;
        if (spd2 > MAX_MOVE_SPD * MAX_MOVE_SPD) {
          const s2 = Math.sqrt(spd2);
          t.vx = t.vx / s2 * MAX_MOVE_SPD;
          t.vy = t.vy / s2 * MAX_MOVE_SPD;
        }
      }
    }

    t.sx += t.vx;
    t.sy += t.vy;
    t.rot += t.rotSpeed;
    t.scale = Math.min(1.0, t.scale + GROW_RATE);

    const hr = t.hRatio || 1;
    const dw = t.baseSize * t.scale;
    const dh = dw * hr;
    const s  = dw / BASE_PX;
    const tx = t.sx - BASE_PX / 2;
    const ty = t.sy - BASE_PX * hr / 2;

    t.screenX = t.sx;
    t.screenY = t.sy;
    t.w = dw;
    t.h = dh;

    if (t.sx < -450 || t.sx > VW + 450 || t.sy < -450 || t.sy > VH + 450) {
      t.dead = true;
      if (t.fadeTimer) { clearTimeout(t.fadeTimer); t.fadeTimer = null; }
      t.el.remove();
      targets.splice(i, 1);
      setTimeout(spawnTarget, 100 + Math.random() * 300);
      continue;
    }

    totalSpeed += Math.hypot(t.vx, t.vy) * 40;
    activeCount++;

    t.el.style.transform = `translate(${tx}px,${ty}px) scale(${s}) rotate(${t.rot}deg)`;
  }

  // zIndex: only re-sort every 8 frames — saves ~84% of the per-frame style writes
  if (frameCount % 8 === 0) {
    const alive = targets.filter(t => !t.dead);
    alive.sort((a, b) => a.scale - b.scale);
    alive.forEach((t, i) => { t.el.style.zIndex = i + 1; });
  }

  // Last photo swallowed → gulp, mouth closes
  if (boss.sucking && targets.length === 0) {
    boss.sucking = false;
    playGulp();
    if (boss.active && boss.state === 'attack') setBossState('idle');
  }

  targetsValEl.textContent = String(activeCount).padStart(2, '0');
  speedValEl.textContent   = activeCount > 0 ? (totalSpeed / activeCount).toFixed(1) : '0.0';

  // Reminiscing mode check (~every 3s)
  if (frameCount % 180 === 0 && !boss.active && !reminiscing) {
    if (Date.now() - lastInteractionTime > REMINISCE_IDLE_MS) enterReminiscing();
  }

  // Boss panels
  for (let i = boss.panels.length - 1; i >= 0; i--) {
    const p = boss.panels[i];
    if (p.dead) { boss.panels.splice(i, 1); continue; }
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.rotSpeed;
    p.el.style.transform = `translate(${p.x - p.size/2}px,${p.y - p.size/2}px) rotate(${p.rot}deg)`;
    if (p.y > VH + 80) {
      p.el.remove();
      boss.panels.splice(i, 1);
      hitPlayer();
    }
  }

  requestAnimationFrame(loop);
}

// === BOSS FIGHT ===

const BOSS_DIR      = 'boss/';
const BOSS_SCORE    = 10;
const BOSS_HP_MAX   = 20;
const PLAYER_HP_MAX = 3;

const boss = {
  active: false, hp: BOSS_HP_MAX, phase: 1,
  state: 'idle',   // idle | attack | hit | rage
  sucking: false,  // entrance: inhaling the gallery
  mouthOpen: false,
  el: null, imgEl: null, hudEl: null,
  attackLoop: null,
  panels: [],
};

let playerHp = PLAYER_HP_MAX;

// === BOSS THEME — Jake's fight music, this fight only ===
let bossTheme = null;

function startBossTheme() {
  if (!bossTheme) {
    bossTheme = new Audio(BOSS_DIR + 'jake-theme.mp3');
    bossTheme.loop = true;
    bossTheme.volume = 0.55;
  }
  bossTheme.currentTime = 0;
  if (!muted) playWithGestureFallback(bossTheme, () => boss.active);
}

function stopBossTheme() {
  if (bossTheme) { bossTheme.pause(); bossTheme.currentTime = 0; }
}

const BOSS_IMGS = { idle: 'boss-idle.png', attack: 'boss-attack.png', hit: 'boss-hit.png', rage: 'boss-rage.png' };

function setBossState(s) {
  boss.state     = s;
  boss.mouthOpen = s === 'attack';
  if (boss.imgEl) boss.imgEl.src = BOSS_DIR + (BOSS_IMGS[s] || 'boss-idle.png');
}

// === JAKE VOICE LINES — one at a time; story beats preempt hit grunts ===
let jakeVoice = null;

function playJakeVoice(name, preempt = true) {
  if (muted) return;
  if (jakeVoice && !jakeVoice.paused && !jakeVoice.ended) {
    if (!preempt) return;   // grunts never interrupt a line already playing
    jakeVoice.pause();
  }
  jakeVoice = new Audio(BOSS_DIR + name + '.mp3');
  jakeVoice.volume = 0.9;
  jakeVoice.play().catch(() => {});
}

// Current mouth position in screen px — tracked live while Jake slides in
function bossMouthPoint() {
  if (boss.el) {
    const r = boss.el.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.65 };
  }
  return { x: VW / 2, y: 150 };
}

// Rising inhale for the entrance suck
function playSuck() {
  if (muted) return;
  try {
    const c    = getCtx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, c.currentTime + 1.4);
    gain.gain.setValueAtTime(0.09, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.5);
    osc.start(c.currentTime); osc.stop(c.currentTime + 1.55);
  } catch (e) {}
}

function playGulp() {
  if (muted) return;
  try {
    const c = getCtx();
    for (const [freq, at] of [[300, 0], [180, 0.12]]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain); gain.connect(c.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, c.currentTime + at);
      gain.gain.setValueAtTime(0.16, c.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + 0.15);
      osc.start(c.currentTime + at); osc.stop(c.currentTime + at + 0.17);
    }
  } catch (e) {}
}

function livesStr() {
  return '♥'.repeat(playerHp) + '♡'.repeat(Math.max(0, PLAYER_HP_MAX - playerHp));
}

function buildBossDOM() {
  const wrap = document.createElement('div');
  wrap.id = 'boss-wrap';
  const img = document.createElement('img');
  img.id = 'boss-img'; img.alt = 'BOSS';
  img.src = BOSS_DIR + 'boss-idle.png';
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  boss.el = wrap; boss.imgEl = img;

  const hud = document.createElement('div');
  hud.id = 'boss-hud';
  hud.innerHTML = `<div id="boss-hud-name">JAKE THE SNAKE</div><div id="boss-hp-track"><div id="boss-hp-fill"></div></div>`;
  document.body.appendChild(hud);
  boss.hudEl = hud;

  // Repurpose WPNS / ARMED cell → player lives
  const armedVal = document.querySelector('.hud-armed');
  if (armedVal) {
    armedVal.textContent = livesStr();
    armedVal.classList.remove('hud-armed');
    armedVal.id = 'lives-val';
    const lbl = armedVal.previousElementSibling;
    if (lbl) lbl.textContent = 'LIVES';
  }
}

function startBoss() {
  if (boss.active) return;
  boss.active = true;
  boss.hp     = BOSS_HP_MAX;
  boss.phase  = 1;
  playerHp    = PLAYER_HP_MAX;

  buildBossDOM();
  setBossState('idle');
  stopGalleryTheme();
  startBossTheme();

  // Slide in from top
  requestAnimationFrame(() => {
    boss.el.classList.add('visible');
    boss.hudEl.classList.add('visible');
  });

  // Entrance: Jake inhales the whole gallery — targets spiral into his mouth
  // (per-frame motion in loop()). Mouth open to eat; state resets on gulp.
  boss.sucking = true;
  setBossState('attack');
  targets.forEach(t => { if (t.fadeTimer) { clearTimeout(t.fadeTimer); t.fadeTimer = null; } });
  playJakeVoice('jake-eat-you-up');
  playSuck();
  setTimeout(() => {   // safety: force-swallow any stragglers
    if (!boss.sucking) return;
    [...targets].forEach(t => { t.dead = true; t.el.remove(); });
    targets.length = 0;
  }, 2600);

  // three.min.js loads during the fight — his defeat leads straight to stage 2
  preloadStage2();

  bossLoop();
}

function bossLoop() {
  const delay = boss.phase === 1 ? 2600 : 1700;
  boss.attackLoop = setTimeout(() => {
    if (!boss.active) return;
    setBossState('attack');
    firePanels();
    setTimeout(() => {
      if (boss.active) setBossState(boss.phase === 2 ? 'rage' : 'idle');
    }, 1100);
    bossLoop();
  }, delay);
}

function firePanels() {
  if (!boss.el) return;
  const r  = boss.el.getBoundingClientRect();
  const ox = r.left + r.width * 0.5;
  const oy = r.top  + r.height * 0.72;   // approximate mouth position
  const n  = boss.phase === 1 ? 3 : 5;

  for (let i = 0; i < n; i++) {
    const spread = n > 1 ? (i / (n - 1) - 0.5) * 4.2 : 0;
    spawnPanel(ox, oy, spread, 1.8 + Math.random() * 1.0);
  }
  // Phase 2 bonus: one panel aimed at cursor
  if (boss.phase === 2 && mouseX > 0) {
    const dx = mouseX - ox, dy = mouseY - oy;
    const d  = Math.hypot(dx, dy) || 1;
    spawnPanel(ox, oy, dx / d * 3.5, Math.max(1.5, dy / d * 3.5));
  }
}

function spawnPanel(ox, oy, vx, vy) {
  const size = 50 + Math.random() * 40;
  const el   = document.createElement('div');
  el.className = 'boss-panel';
  el.style.width  = size + 'px';
  el.style.height = size + 'px';
  el.style.left   = '0';
  el.style.top    = '0';
  document.body.appendChild(el);
  boss.panels.push({
    el, size, x: ox, y: oy, vx, vy,
    rot: Math.random() * 360,
    rotSpeed: (Math.random() - 0.5) * 9,
    dead: false,
  });
}

function destroyPanel(p) {
  if (p.dead) return;
  p.dead = true;
  p.el.remove();
  explodeStars(p.x, p.y);
  playBoom();
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', inset: '0', background: 'rgba(255,100,0,0.15)',
    pointerEvents: 'none', zIndex: '9998', transition: 'opacity 0.3s',
  });
  document.body.appendChild(flash);
  requestAnimationFrame(() => requestAnimationFrame(() => { flash.style.opacity = '0'; }));
  setTimeout(() => flash.remove(), 350);
}

function hitPlayer() {
  playerHp = Math.max(0, playerHp - 1);
  const lv = document.getElementById('lives-val');
  if (lv) lv.textContent = livesStr();

  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', inset: '0', background: 'rgba(255,0,0,0.22)',
    pointerEvents: 'none', zIndex: '9998', transition: 'opacity 0.5s',
  });
  document.body.appendChild(flash);
  requestAnimationFrame(() => requestAnimationFrame(() => { flash.style.opacity = '0'; }));
  setTimeout(() => flash.remove(), 600);

  if (playerHp <= 0) playerDefeated();
}

function playerDefeated() {
  endBoss();
  setTimeout(showGameOver, 600);
}

function showGameOver() {
  const overlay = document.createElement('div');
  overlay.id = 'gameOverScreen';
  overlay.innerHTML = `
    <div class="gameover-inner">
      <div class="gameover-title">GAME OVER</div>
      <div class="gameover-sub">JAKE THE SNAKE WINS THIS TIME</div>
      <button class="gameover-btn" id="restartBtn">[ RETRY ]</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('restartBtn').addEventListener('click', restartGame);
}

function restartGame() {
  const overlay = document.getElementById('gameOverScreen');
  if (overlay) overlay.remove();

  score = 0;
  scoreVal.textContent = '000';

  const livesVal = document.getElementById('lives-val');
  if (livesVal) {
    livesVal.textContent = 'ARMED';
    livesVal.classList.add('hud-armed');
    livesVal.removeAttribute('id');
    const lbl = livesVal.previousElementSibling;
    if (lbl) lbl.textContent = 'WPNS';
  }

  for (let i = 0; i < MAX_ON_SCREEN; i++) setTimeout(spawnTarget, i * 250);
  startGalleryTheme();
}

function damageBoss(amount = 1) {
  if (!boss.active) return;
  boss.hp = Math.max(0, boss.hp - amount);
  playJakeVoice(Math.random() < 0.5 ? 'jake-ow' : 'jake-stop-that', false);

  const fill = document.getElementById('boss-hp-fill');
  if (fill) fill.style.width = (boss.hp / BOSS_HP_MAX * 100) + '%';

  const prev = boss.state;
  setBossState('hit');
  setTimeout(() => {
    if (boss.active) setBossState(boss.phase === 2 ? 'rage' : prev === 'attack' ? 'attack' : 'idle');
  }, 200);

  // Phase 2 at half HP
  if (boss.phase === 1 && boss.hp <= BOSS_HP_MAX / 2) {
    boss.phase = 2;
    playJakeVoice('jake-shits-painful');
    clearTimeout(boss.attackLoop);
    setBossState('rage');
    bossLoop();
  }

  if (boss.hp <= 0) defeatBoss();
}

function defeatBoss() {
  boss.active = false;
  boss.sucking = false;
  stopBossTheme();
  playJakeVoice('jake-defeat');
  clearTimeout(boss.attackLoop);
  [...boss.panels].forEach(destroyPanel);
  boss.panels = [];

  if (boss.el) {
    const r = boss.el.getBoundingClientRect();
    playExplosionSfx();
    explodeShatter({ el: boss.imgEl, screenX: r.left + r.width/2, screenY: r.top + r.height/2, w: r.width, h: r.height, rot: 0 });
    // The photos he swallowed blast back out of his head...
    burstPhotosFromBoss(r.left + r.width / 2, r.top + r.height * 0.4);
    boss.el.remove();
  }
  boss.hudEl?.remove();
  boss.el = boss.imgEl = boss.hudEl = null;

  // ...and the game follows them straight into deep space. No intermission —
  // three.min.js has been loading since the fight began.
  setTimeout(enterStage2, 1500);
}

// Defeat spectacle: swallowed photos erupt from Jake's head and scatter
function burstPhotosFromBoss(cx, cy) {
  const pics = mediaFiles.filter(f => !/\.(mp4|webm|mov)$/i.test(f));
  if (!pics.length) return;
  const n = Math.min(14, pics.length);
  for (let i = 0; i < n; i++) {
    const file = pics[Math.floor(Math.random() * pics.length)];
    const el = document.createElement('div');
    el.className = 'target';
    el.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:130px;` +
      `transform:translate(-50%,-50%) scale(0.08) rotate(0deg);opacity:1;pointer-events:none;z-index:210;` +
      `transition:transform ${1.1 + Math.random() * 0.5}s cubic-bezier(0.16, 0.8, 0.4, 1), opacity 0.45s ease-in ${0.9 + Math.random() * 0.4}s;`;
    const img = document.createElement('img');
    img.alt = ''; img.src = MEDIA_DIR + encodeURIComponent(file);
    el.appendChild(img);
    document.body.appendChild(el);

    // Up-and-outward hemisphere, like the head popped its cork
    const ang  = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const dist = 420 + Math.random() * 520;
    const rot  = (Math.random() - 0.5) * 720;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transform = `translate(${Math.cos(ang) * dist - 65}px, ${Math.sin(ang) * dist - 65}px) scale(${0.8 + Math.random() * 0.5}) rotate(${rot}deg)`;
      el.style.opacity = '0';
    }));
    setTimeout(() => el.remove(), 2100);
  }
  playBoom();
}

function endBoss() {
  boss.active = false;
  stopBossTheme();
  clearTimeout(boss.attackLoop);
  [...boss.panels].forEach(p => { p.dead = true; p.el.remove(); });
  boss.panels = [];
  boss.el?.remove(); boss.hudEl?.remove();
  boss.el = boss.imgEl = boss.hudEl = null;
}

// === STAGE 2 HANDOFF — deep space begins 10 kills after Jake falls ===
// The 3D stage itself lives in stage2.js; this is only the bridge out of the
// gallery. three.min.js is injected lazily so the gallery never pays for it.

function preloadStage2() {
  if (!stage2Preload) {
    stage2Preload = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'libs/three.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return stage2Preload;
}

function enterStage2() {
  stopGalleryTheme();
  // Wind the gallery down the same way startBoss does
  targets.forEach(t => { t.vx *= 0.15; t.vy *= 0.15; });
  setTimeout(() => {
    [...targets].forEach(t => { if (t.fadeTimer) clearTimeout(t.fadeTimer); t.dead = true; t.el.remove(); });
    targets.length = 0;
  }, 900);
  if (window.s2Banner) s2Banner('STAGE 2 // ENTERING DEEP SPACE');
  preloadStage2()
    .then(() => setTimeout(startStage2, 1100))   // let the wind-down play out
    .catch(() => { /* three.min.js failed to load — stay in the gallery */ });
}

// === STREAK ===
function showStreakPopup(count) {
  const msg = streakMessages[Math.min(count, 7)] || `🌀 ${count}x CHAOS`;
  streakDisp.textContent = msg;
  streakDisp.classList.add('visible');
  clearTimeout(streakDisp._timer);
  streakDisp._timer = setTimeout(() => streakDisp.classList.remove('visible'), 2200);
  const el = document.createElement('div');
  el.className = 'streak-popup';
  el.textContent = msg;
  // Pop from where the shot landed (just above the crosshair), not mid-screen
  const px = Math.max(150, Math.min(VW - 150, mouseX > -1000 ? mouseX : VW / 2));
  const py = Math.max(90,  Math.min(VH - 90, (mouseY > -1000 ? mouseY : VH * 0.45) - 60));
  el.style.left = px + 'px';
  el.style.top  = py + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
