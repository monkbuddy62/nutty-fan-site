const AUDIO_DIR     = 'audio/';
const MEDIA_DIR     = 'media/';
const IS_MOBILE     = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
const MAX_ON_SCREEN = IS_MOBILE ? 6 : 12;
const MAX_SPEED     = 10;
const FLEE_RADIUS   = 140;
const FLEE_FORCE    = 2.6;
const HIT_RADIUS    = 120;   // px from cursor center to count as a hit
const FIRE_RATE_MS  = 90;    // autofire interval when holding mouse down
const BASE_PX       = 260;   // element base width — never changes after spawn; perspective handled via CSS scale

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

// === STATE ===
let mediaFiles     = [];
let targets        = [];
let score          = 0;
let killStreak     = 0;
let lastKillTime   = 0;
let muted          = false;
let mouseX         = -9999;
let mouseY         = -9999;
let audioCtx       = null;
let currentClip    = null;
let shootFlash     = null;      // { x, y, t }
let autoFireTimer  = null;
let VW             = window.innerWidth;
let VH             = window.innerHeight;

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

function playPew() {
  if (muted) return;
  try {
    const c    = getCtx();
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

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', muted);
  if (muted && currentClip) { currentClip.pause(); currentClip.currentTime = 0; }
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
  for (let i = 0; i < 30; i++) {
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
  for (let i = 0; i < 20; i++) {
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

const EXPLOSION_STYLES = ['dust', 'stars', 'shatter'];

function triggerExplosion(target) {
  const el = target.el;
  const cx = target.screenX;
  const cy = target.screenY;

  const style = EXPLOSION_STYLES[Math.floor(Math.random() * EXPLOSION_STYLES.length)];
  if (style === 'dust')         explodeDust(cx, cy);
  else if (style === 'stars')   explodeStars(cx, cy);
  else if (style === 'shatter') explodeShatter(target);

  const flash = document.createElement('div');
  flash.className = 'kill-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 220);

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

  // Lock-on brackets around nearest target in range
  let locked = null, nearestD = HIT_RADIUS;
  for (const t of targets) {
    if (t.dead) continue;
    const d = Math.hypot(mouseX - t.screenX, mouseY - t.screenY);
    if (d < nearestD) { nearestD = d; locked = t; }
  }
  if (locked && locked.w < 550) {
    const pad = 12, tl = 20;
    const lx = locked.screenX - locked.w/2 - pad, ly = locked.screenY - locked.h/2 - pad;
    const rx = locked.screenX + locked.w/2 + pad, ry = locked.screenY + locked.h/2 + pad;
    xhCtx.save();
    xhCtx.strokeStyle = '#ff6600';
    xhCtx.shadowColor = '#ff6600';
    xhCtx.shadowBlur  = 14;
    xhCtx.lineWidth   = 1.5;
    xhCtx.lineCap     = 'square';
    xhCtx.beginPath();
    xhCtx.moveTo(lx+tl,ly); xhCtx.lineTo(lx,ly); xhCtx.lineTo(lx,ly+tl);
    xhCtx.moveTo(rx-tl,ly); xhCtx.lineTo(rx,ly); xhCtx.lineTo(rx,ly+tl);
    xhCtx.moveTo(lx,ry-tl); xhCtx.lineTo(lx,ry); xhCtx.lineTo(lx+tl,ry);
    xhCtx.moveTo(rx,ry-tl); xhCtx.lineTo(rx,ry); xhCtx.lineTo(rx-tl,ry);
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

// === AUTOFIRE — hold mouse to spam pew pew pew ===
function fireShot() {
  playPew();
  shootFlash = { x: mouseX, y: mouseY, t: Date.now() };

  let nearest = null, nearestD = HIT_RADIUS;
  for (const t of targets) {
    if (t.dead) continue;
    const d = Math.hypot(mouseX - t.screenX, mouseY - t.screenY);
    if (d < nearestD) { nearestD = d; nearest = t; }
  }
  if (nearest) shootTarget(nearest);
}

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  fireShot();
  autoFireTimer = setInterval(fireShot, FIRE_RATE_MS);
});

document.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  clearInterval(autoFireTimer);
  autoFireTimer = null;
});

window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

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
    for (let i = 0; i < MAX_ON_SCREEN; i++) spawnTarget();
    requestAnimationFrame(loop);
  })
  .catch(() => {
    loadingText.textContent = 'Add files to media/ and run build-manifest.py';
    loadingText.style.animationName = 'none';
    loadingText.style.opacity = '1';
    loadingText.style.color = '#00ffcc';
    initStars();
    requestAnimationFrame(loop);
  });

// === SPAWN — perspective: starts tiny in the distance, flies toward camera ===
//
// Each target lives in "world space" with an offset (wx, wy) from screen center
// and a depth z that decreases toward 0.  Screen position = center + offset/z,
// display size = baseSize/z.  So targets appear small & centered when far,
// then grow and drift outward as they approach, flying past the view screen.
function spawnTarget() {
  if (!mediaFiles.length || targets.length >= MAX_ON_SCREEN) return;

  const active = new Set(targets.map(t => t.file));
  const pool   = mediaFiles.filter(f => !active.has(f));
  const src    = pool.length ? pool : mediaFiles;
  const file   = src[Math.floor(Math.random() * src.length)];
  const ext    = file.split('.').pop().toLowerCase();
  const isVideo = ext === 'mp4' || ext === 'webm' || ext === 'mov';

  const W = window.innerWidth, H = window.innerHeight;

  // World-space offset from screen center — determines which direction it flies past
  const wx = (Math.random() - 0.5) * W * 0.9;
  const wy = (Math.random() - 0.5) * H * 0.7;

  const z        = 3.0 + Math.random() * 2.0;    // start far away
  const zSpeed   = 0.013 + Math.random() * 0.011; // approach speed
  const baseSize = 220 + Math.random() * 160;     // size at z=1

  const rot      = (Math.random() - 0.5) * 30;
  const rotSpeed = (Math.random() - 0.5) * 0.12;

  // Element stays BASE_PX wide forever; perspective zoom is applied via CSS scale.
  // This means only `transform` changes each frame — no left/top/width thrash.
  const initSX = VW / 2 + wx / z;
  const initSY = VH / 2 + wy / z;
  const initS  = baseSize / (BASE_PX * z);
  const initTx = initSX - BASE_PX / 2;
  const initTy = initSY - BASE_PX / 2;  // hRatio=1 until image loads

  const el = document.createElement('div');
  el.className = 'target';
  el.style.cssText = `width:${BASE_PX}px;left:0;top:0;transform:translate(${initTx}px,${initTy}px) scale(${initS}) rotate(${rot}deg)`;

  const target = {
    el, file, isVideo,
    wx, wy, z, zSpeed, baseSize,
    hRatio: 1,
    rot, rotSpeed,
    dead: false,
    screenX: initSX, screenY: initSY,
    x: initSX - baseSize/(z*2), y: initSY - baseSize/(z*2),
    w: baseSize/z, h: baseSize/z,
  };

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

// === SHOOT — explode immediately in place ===
function shootTarget(target) {
  if (target.dead) return;
  target.dead = true;
  targets.splice(targets.indexOf(target), 1);

  score++;
  scoreVal.textContent = String(score).padStart(3, '0');

  const now = Date.now();
  killStreak   = (now - lastKillTime < 1600) ? killStreak + 1 : 1;
  lastKillTime = now;
  if (killStreak >= 3) showStreakPopup(killStreak);

  playBoom();
  playNuttyClip();
  target._dx = 0;
  target._dy = 0;
  triggerExplosion(target);
}

// === GAME LOOP ===
function loop() {
  drawWarp();
  drawHudOverlay();

  let totalSpeed = 0, activeCount = 0;

  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (t.dead) continue;

    t.z -= t.zSpeed;

    const sx = VW / 2 + t.wx / t.z;
    const sy = VH / 2 + t.wy / t.z;

    // Flee: nudge world-space offset so target drifts away from cursor on screen
    const fx   = mouseX - sx;
    const fy   = mouseY - sy;
    const dist = Math.sqrt(fx * fx + fy * fy);
    if (dist < FLEE_RADIUS && dist > 0) {
      const force = ((FLEE_RADIUS - dist) / FLEE_RADIUS) * FLEE_FORCE;
      t.wx -= (fx / dist) * force * t.z;
      t.wy -= (fy / dist) * force * t.z;
    }

    const maxOff = Math.max(VW, VH) * 1.5;
    if (t.wx >  maxOff) t.wx =  maxOff;
    if (t.wx < -maxOff) t.wx = -maxOff;
    if (t.wy >  maxOff) t.wy =  maxOff;
    if (t.wy < -maxOff) t.wy = -maxOff;

    t.rot += t.rotSpeed;

    const hr   = t.hRatio || 1;
    const dw   = t.baseSize / t.z;           // visual width
    const dh   = dw * hr;                    // visual height
    const s    = dw / BASE_PX;               // CSS scale factor
    const tx   = sx - BASE_PX / 2;           // translate so element center = sx,sy
    const ty   = sy - BASE_PX * hr / 2;

    // Cache for hit detection — no getBoundingClientRect needed
    t.screenX = sx;
    t.screenY = sy;
    t.w = dw;
    t.h = dh;

    if (t.z < 0.1 || sx < -500 || sx > VW + 500 || sy < -500 || sy > VH + 500) {
      t.el.remove();
      targets.splice(i, 1);
      setTimeout(spawnTarget, 150 + Math.random() * 400);
      continue;
    }

    totalSpeed += t.zSpeed * 100;
    activeCount++;

    // Single transform update — GPU composited, no layout reflow
    t.el.style.zIndex    = Math.min(20, Math.max(1, Math.round(8 / t.z)));
    t.el.style.transform = `translate(${tx}px,${ty}px) scale(${s}) rotate(${t.rot}deg)`;
  }

  targetsValEl.textContent = String(activeCount).padStart(2, '0');
  speedValEl.textContent   = activeCount > 0 ? (totalSpeed / activeCount).toFixed(1) : '0.0';

  requestAnimationFrame(loop);
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
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
