const AUDIO_DIR   = 'audio/';
const MEDIA_DIR   = 'media/';
const MAX_ON_SCREEN = 12;
const BASE_SPEED  = 0.55;
const MAX_SPEED   = 7;
const FLEE_RADIUS = 230;
const FLEE_FORCE  = 4.5;
const DAMPING     = 0.97;

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
  6: '🌀 NUTTY OBLITERATED',
  7: '☠️ UNSTOPPABLE',
};

// === STATE ===
let mediaFiles   = [];
let targets      = [];
let score        = 0;
let killStreak   = 0;
let lastKillTime = 0;
let muted        = false;
let mouseX       = -9999;
let mouseY       = -9999;
let audioCtx     = null;
let currentClip  = null;

// === DOM ===
const gameArea      = document.getElementById('gameArea');
const scoreVal      = document.getElementById('scoreVal');
const loadingScreen = document.getElementById('loadingScreen');
const loadingText   = document.getElementById('loadingText');
const streakDisp    = document.getElementById('streak-display');
const muteBtn       = document.getElementById('muteBtn');

// === AUDIO ===
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playPew() {
  if (muted) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator(), gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, c.currentTime + 0.13);
    gain.gain.setValueAtTime(0.16, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.13);
    osc.start(c.currentTime); osc.stop(c.currentTime + 0.14);
  } catch(e) {}
}

function playBoom() {
  if (muted) return;
  try {
    const c = getCtx();
    const len = Math.floor(c.sampleRate * 0.35);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(), flt = c.createBiquadFilter(), gain = c.createGain();
    flt.type = 'lowpass'; flt.frequency.value = 340;
    src.buffer = buf; src.connect(flt); flt.connect(gain); gain.connect(c.destination);
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

// === WARP STARFIELD ===
const canvas = document.getElementById('stars');
const sctx   = canvas.getContext('2d');
const NUM_STARS = 320;
let stars = [];

function resetStar(s, randomZ) {
  s.x = (Math.random() - 0.5) * 2;
  s.y = (Math.random() - 0.5) * 2;
  s.z = randomZ ? Math.random() : 1.0;
  s.pz = s.z;
}

function initStars() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  stars = [];
  for (let i = 0; i < NUM_STARS; i++) {
    const s = {};
    resetStar(s, true); // spread at random depths on init
    stars.push(s);
  }
}

function drawWarp() {
  const W  = canvas.width;
  const H  = canvas.height;
  const cx = W / 2;
  const cy = H / 2;

  // Fade trail — lower alpha = longer streaks
  sctx.fillStyle = 'rgba(0,0,0,0.18)';
  sctx.fillRect(0, 0, W, H);

  const SPEED = 0.008;
  const SCALE = 0.55;

  for (const s of stars) {
    s.pz = s.z;
    s.z -= SPEED;

    if (s.z <= 0) { resetStar(s, false); continue; }

    // Project current and previous positions
    const sx  = (s.x  / s.z)  * cx * SCALE + cx;
    const sy  = (s.y  / s.z)  * cy * SCALE + cy;
    const spx = (s.x  / s.pz) * cx * SCALE + cx;
    const spy = (s.y  / s.pz) * cy * SCALE + cy;

    // Skip if off screen
    if (sx < 0 || sx > W || sy < 0 || sy > H) { resetStar(s, false); continue; }

    const brightness = Math.min(1, (1 - s.z) * 1.4);
    const thickness  = Math.max(0.3, (1 - s.z) * 2.8);

    sctx.beginPath();
    sctx.moveTo(spx, spy);
    sctx.lineTo(sx, sy);
    sctx.strokeStyle = `rgba(210,200,255,${brightness})`;
    sctx.lineWidth = thickness;
    sctx.stroke();
  }
}

window.addEventListener('resize', () => {
  initStars();
  const W = window.innerWidth, H = window.innerHeight;
  targets.forEach(t => {
    if (t.x + t.w > W) t.x = W - t.w;
    if (t.y + t.h > H) t.y = H - t.h;
  });
});

// === INPUT ===
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });
gameArea.addEventListener('click', () => playPew()); // miss click

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
    loadingText.style.color = '#c8aaff';
    initStars();
    requestAnimationFrame(loop);
  });

// === SPAWN ===
function spawnTarget() {
  if (!mediaFiles.length) return;

  const file    = mediaFiles[Math.floor(Math.random() * mediaFiles.length)];
  const ext     = file.split('.').pop().toLowerCase();
  const isVideo = ext === 'mp4' || ext === 'webm' || ext === 'mov';

  const W = window.innerWidth, H = window.innerHeight;
  const w = 150 + Math.random() * 110;

  const x = Math.random() * Math.max(1, W - w);
  const y = Math.random() * Math.max(1, H - w);

  const spd   = BASE_SPEED + Math.random() * 0.7;
  const angle = Math.random() * Math.PI * 2;
  const rot      = -15 + Math.random() * 30;
  const rotSpeed = -0.18 + Math.random() * 0.36;

  const el = document.createElement('div');
  el.className = 'target';
  el.style.cssText = `width:${w}px;left:${x}px;top:${y}px;--rot:${rot}deg;transform:rotate(${rot}deg)`;

  // h starts as square placeholder; updated once media dimensions are known
  const target = {
    el, x, y,
    dx: Math.cos(angle) * spd,
    dy: Math.sin(angle) * spd,
    w, h: w,
    rot, rotSpeed, dead: false,
  };

  if (isVideo) {
    const vid = document.createElement('video');
    vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
    vid.style.cssText = 'display:block;width:100%;';
    vid.src = MEDIA_DIR + encodeURIComponent(file);
    // Update h once we know video dimensions
    vid.addEventListener('loadedmetadata', () => {
      if (vid.videoWidth > 0) {
        target.h = w * (vid.videoHeight / vid.videoWidth);
        el.style.height = target.h + 'px';
      }
    }, { once: true });
    el.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.alt = ''; img.loading = 'lazy';
    // height:auto on img means container auto-sizes; read back after load
    img.onload = () => {
      if (img.naturalWidth > 0) {
        target.h = w * (img.naturalHeight / img.naturalWidth);
        // no need to set el height — img height:auto drives it
      }
    };
    img.src = MEDIA_DIR + encodeURIComponent(file);
    el.appendChild(img);
  }

  targets.push(target);
  gameArea.appendChild(el);
  el.addEventListener('click', e => { e.stopPropagation(); shootTarget(target); });
}

// === SHOOT ===
function shootTarget(target) {
  if (target.dead) return;
  target.dead = true;
  targets.splice(targets.indexOf(target), 1);

  score++;
  scoreVal.textContent = score;

  const now = Date.now();
  killStreak = (now - lastKillTime < 1600) ? killStreak + 1 : 1;
  lastKillTime = now;
  if (killStreak >= 3) showStreakPopup(killStreak);

  const flash = document.createElement('div');
  flash.className = 'kill-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 220);

  playPew();
  playBoom();
  playNuttyClip();

  target.el.classList.add('exploding');
  setTimeout(() => {
    target.el.remove();
    setTimeout(spawnTarget, 200 + Math.random() * 600);
  }, 450);
}

// === MAIN LOOP ===
function loop() {
  const W = window.innerWidth, H = window.innerHeight;

  drawWarp();

  for (const t of targets) {
    if (t.dead) continue;

    // Flee from cursor
    const fx   = mouseX - (t.x + t.w / 2);
    const fy   = mouseY - (t.y + t.h / 2);
    const dist = Math.sqrt(fx * fx + fy * fy);
    if (dist < FLEE_RADIUS && dist > 0) {
      const force = ((FLEE_RADIUS - dist) / FLEE_RADIUS) * FLEE_FORCE;
      t.dx -= (fx / dist) * force;
      t.dy -= (fy / dist) * force;
    }

    // Damping + speed clamp
    t.dx *= DAMPING;
    t.dy *= DAMPING;
    const spd = Math.sqrt(t.dx * t.dx + t.dy * t.dy);
    if (spd < BASE_SPEED && spd > 0) { t.dx = t.dx / spd * BASE_SPEED; t.dy = t.dy / spd * BASE_SPEED; }
    if (spd > MAX_SPEED)             { t.dx = t.dx / spd * MAX_SPEED;   t.dy = t.dy / spd * MAX_SPEED; }

    t.x   += t.dx;
    t.y   += t.dy;
    t.rot += t.rotSpeed;

    // Bounce
    if (t.x <= 0)       { t.dx =  Math.abs(t.dx); t.x = 0; }
    if (t.x + t.w >= W) { t.dx = -Math.abs(t.dx); t.x = W - t.w; }
    if (t.y <= 0)       { t.dy =  Math.abs(t.dy); t.y = 0; }
    if (t.y + t.h >= H) { t.dy = -Math.abs(t.dy); t.y = H - t.h; }

    t.el.style.left = t.x + 'px';
    t.el.style.top  = t.y + 'px';
    t.el.style.transform = `rotate(${t.rot}deg)`;
    t.el.style.setProperty('--rot', t.rot + 'deg');
  }

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
