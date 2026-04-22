const AUDIO_DIR  = 'audio/';
const MEDIA_DIR  = 'media/';
const MAX_ON_SCREEN = 12;
const BASE_SPEED    = 0.6;
const MAX_SPEED     = 7;
const FLEE_RADIUS   = 230;
const FLEE_FORCE    = 4.5;
const DAMPING       = 0.97;

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
let mediaFiles  = [];
let targets     = [];
let score       = 0;
let killStreak  = 0;
let lastKillTime = 0;
let muted       = false;
let mouseX      = -9999;
let mouseY      = -9999;
let audioCtx    = null;
let currentClip = null;

// === DOM ===
const gameArea      = document.getElementById('gameArea');
const scoreVal      = document.getElementById('scoreVal');
const loadingScreen = document.getElementById('loadingScreen');
const loadingText   = document.getElementById('loadingText');
const streakDisp    = document.getElementById('streak-display');
const muteBtn       = document.getElementById('muteBtn');

// === AUDIO CONTEXT (lazy init — avoids browser autoplay block) ===
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playPew() {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.13);
  } catch(e) {}
}

function playBoom() {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    const bufLen = Math.floor(ctx.sampleRate * 0.35);
    const buf  = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    const src    = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain   = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, ctx.currentTime);
    src.buffer = buf;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.start(ctx.currentTime);
  } catch(e) {}
}

function playNuttyClip() {
  if (muted) return;
  if (currentClip) { currentClip.pause(); currentClip.currentTime = 0; }
  const file = audioFiles[Math.floor(Math.random() * audioFiles.length)];
  const a = new Audio(AUDIO_DIR + encodeURIComponent(file));
  a.play().catch(() => {});
  currentClip = a;
}

// === MUTE TOGGLE ===
muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', muted);
  if (muted && currentClip) { currentClip.pause(); currentClip.currentTime = 0; }
});

// === STARFIELD ===
const canvas = document.getElementById('stars');
const ctx2d  = canvas.getContext('2d');

const STAR_LAYERS = [
  { count: 180, speed: 0.05, size: 0.8, alpha: 0.5 },
  { count: 80,  speed: 0.12, size: 1.4, alpha: 0.7 },
  { count: 30,  speed: 0.22, size: 2.2, alpha: 0.9 },
];

let stars = [];

function initStars() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  stars = [];
  STAR_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      stars.push({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        layer: li,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
  });
}

function drawStars() {
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  const now = performance.now() / 1000;
  stars.forEach(s => {
    const layer = STAR_LAYERS[s.layer];
    s.y += layer.speed;
    if (s.y > canvas.height) { s.y = 0; s.x = Math.random() * canvas.width; }
    const twinkle = 0.6 + 0.4 * Math.sin(s.twinkle + now * (1 + s.layer * 0.5));
    ctx2d.beginPath();
    ctx2d.arc(s.x, s.y, layer.size, 0, Math.PI * 2);
    ctx2d.fillStyle = `rgba(200, 190, 255, ${layer.alpha * twinkle})`;
    ctx2d.fill();
  });
}

window.addEventListener('resize', () => {
  initStars();
  targets.forEach(t => {
    if (t.x + t.w > window.innerWidth)  t.x = window.innerWidth  - t.w;
    if (t.y + t.h > window.innerHeight) t.y = window.innerHeight - t.h;
  });
});

// === MOUSE TRACKING ===
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mouseleave', ()  => { mouseX = -9999; mouseY = -9999; });

// Miss click — pew with no kill
gameArea.addEventListener('click', () => playPew());

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
    // still draw stars
    initStars();
    requestAnimationFrame(loop);
  });

// === SPAWN ===
function spawnTarget() {
  if (!mediaFiles.length) return;
  const file = mediaFiles[Math.floor(Math.random() * mediaFiles.length)];
  const ext  = file.split('.').pop().toLowerCase();
  const isVideo = ext === 'mp4' || ext === 'webm' || ext === 'mov';

  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = 130 + Math.random() * 120;
  const h = w * (0.65 + Math.random() * 0.55);

  const x = Math.random() * Math.max(1, W - w);
  const y = Math.random() * Math.max(1, H - h);

  const speed = BASE_SPEED + Math.random() * 0.8;
  const angle = Math.random() * Math.PI * 2;
  const dx    = Math.cos(angle) * speed;
  const dy    = Math.sin(angle) * speed;
  const rot      = -18 + Math.random() * 36;
  const rotSpeed = -0.2 + Math.random() * 0.4;

  const el = document.createElement('div');
  el.className = 'target';
  el.style.cssText = `width:${w}px;height:${h}px;left:${x}px;top:${y}px;--rot:${rot}deg;transform:rotate(${rot}deg)`;

  if (isVideo) {
    const vid = document.createElement('video');
    vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
    vid.src = MEDIA_DIR + encodeURIComponent(file);
    el.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = MEDIA_DIR + encodeURIComponent(file);
    img.alt = ''; img.loading = 'lazy';
    el.appendChild(img);
  }

  const target = { el, x, y, dx, dy, w, h, rot, rotSpeed, dead: false };
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

// === GAME LOOP ===
function loop() {
  const W = window.innerWidth;
  const H = window.innerHeight;

  drawStars();

  for (const t of targets) {
    if (t.dead) continue;

    // Flee from cursor
    const cx  = mouseX - (t.x + t.w / 2);
    const cy  = mouseY - (t.y + t.h / 2);
    const dist = Math.sqrt(cx * cx + cy * cy);
    if (dist < FLEE_RADIUS && dist > 0) {
      const force = ((FLEE_RADIUS - dist) / FLEE_RADIUS) * FLEE_FORCE;
      t.dx -= (cx / dist) * force;
      t.dy -= (cy / dist) * force;
    }

    // Damping — slows fleeing gradually
    t.dx *= DAMPING;
    t.dy *= DAMPING;

    // Keep minimum drift speed
    const spd = Math.sqrt(t.dx * t.dx + t.dy * t.dy);
    if (spd < BASE_SPEED && spd > 0) {
      t.dx = (t.dx / spd) * BASE_SPEED;
      t.dy = (t.dy / spd) * BASE_SPEED;
    }
    // Cap max speed
    if (spd > MAX_SPEED) {
      t.dx = (t.dx / spd) * MAX_SPEED;
      t.dy = (t.dy / spd) * MAX_SPEED;
    }

    t.x   += t.dx;
    t.y   += t.dy;
    t.rot += t.rotSpeed;

    // Bounce off walls
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

// === STREAK POPUP ===
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
