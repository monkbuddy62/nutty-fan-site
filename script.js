const AUDIO_DIR = 'audio/';
const MEDIA_DIR = 'media/';
const MAX_ON_SCREEN = 12;
const MIN_SPEED = 0.7;
const MAX_SPEED = 2.0;

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

let mediaFiles = [];
let targets = [];
let score = 0;
let killStreak = 0;
let lastKillTime = 0;
let currentAudio = null;

const gameArea    = document.getElementById('gameArea');
const scoreVal    = document.getElementById('scoreVal');
const loadingScreen = document.getElementById('loadingScreen');
const loadingText = document.getElementById('loadingText');
const streakDisp  = document.getElementById('streak-display');

fetch('media/manifest.json')
  .then(r => {
    if (!r.ok) throw new Error('manifest missing');
    return r.json();
  })
  .then(files => {
    mediaFiles = files;
    loadingScreen.classList.add('gone');
    for (let i = 0; i < MAX_ON_SCREEN; i++) spawnTarget();
    requestAnimationFrame(gameLoop);
  })
  .catch(() => {
    loadingText.textContent = 'Add files to media/ and run build-manifest.py';
    loadingText.style.animationName = 'none';
    loadingText.style.opacity = '1';
    loadingText.style.color = '#ff006e';
  });

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

  const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
  const angle = Math.random() * Math.PI * 2;
  const dx = Math.cos(angle) * speed;
  const dy = Math.sin(angle) * speed;

  const rot      = -18 + Math.random() * 36;
  const rotSpeed = -0.25 + Math.random() * 0.5;

  const el = document.createElement('div');
  el.className = 'target';
  el.style.cssText = `width:${w}px;height:${h}px;left:${x}px;top:${y}px;--rot:${rot}deg;transform:rotate(${rot}deg)`;

  if (isVideo) {
    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.muted    = true;
    vid.loop     = true;
    vid.playsInline = true;
    vid.src = MEDIA_DIR + encodeURIComponent(file);
    el.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = MEDIA_DIR + encodeURIComponent(file);
    img.alt = '';
    img.loading = 'lazy';
    el.appendChild(img);
  }

  const target = { el, x, y, dx, dy, w, h, rot, rotSpeed, dead: false };
  targets.push(target);
  gameArea.appendChild(el);

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    shootTarget(target);
  });
}

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

  // Screen flash
  const flash = document.createElement('div');
  flash.className = 'kill-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 220);

  // Audio
  playRandomClip();

  // Explode + remove
  target.el.classList.add('exploding');
  setTimeout(() => {
    target.el.remove();
    setTimeout(spawnTarget, 200 + Math.random() * 600);
  }, 450);
}

function gameLoop() {
  const W = window.innerWidth;
  const H = window.innerHeight;

  for (const t of targets) {
    if (t.dead) continue;

    t.x   += t.dx;
    t.y   += t.dy;
    t.rot += t.rotSpeed;

    if (t.x <= 0)       { t.dx =  Math.abs(t.dx); t.x = 0; }
    if (t.x + t.w >= W) { t.dx = -Math.abs(t.dx); t.x = W - t.w; }
    if (t.y <= 0)       { t.dy =  Math.abs(t.dy); t.y = 0; }
    if (t.y + t.h >= H) { t.dy = -Math.abs(t.dy); t.y = H - t.h; }

    t.el.style.left      = t.x + 'px';
    t.el.style.top       = t.y + 'px';
    t.el.style.transform = `rotate(${t.rot}deg)`;
    t.el.style.setProperty('--rot', t.rot + 'deg');
  }

  requestAnimationFrame(gameLoop);
}

function playRandomClip() {
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
  const file = audioFiles[Math.floor(Math.random() * audioFiles.length)];
  const a = new Audio(AUDIO_DIR + encodeURIComponent(file));
  a.play().catch(() => {});
  currentAudio = a;
}

function showStreakPopup(count) {
  const msg = streakMessages[Math.min(count, 7)] || `🌀 ${count}x CHAOS`;

  // Update streak display in HUD
  streakDisp.textContent = msg;
  streakDisp.classList.add('visible');
  clearTimeout(streakDisp._timer);
  streakDisp._timer = setTimeout(() => streakDisp.classList.remove('visible'), 2000);

  // Big center popup
  const el = document.createElement('div');
  el.className = 'streak-popup';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
