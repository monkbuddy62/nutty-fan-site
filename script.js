const AUDIO_DIR   = 'audio/';
const MEDIA_DIR   = 'media/';
const IS_MOBILE   = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
const MAX_ON_SCREEN = IS_MOBILE ? 7 : 12;
const BASE_SPEED  = 0.55;
const MAX_SPEED   = 7;
const FLEE_RADIUS = 230;
const FLEE_FORCE  = 4.5;
const DAMPING     = IS_MOBILE ? 0.975 : 0.97; // slightly more drag on mobile

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
  // Extra fine specks
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 30 + Math.random() * 80;
    spawnParticle(cx, cy, {
      width: '2px', height: '2px',
      background: `rgba(200,180,140,0.8)`,
      borderRadius: '50%',
      transform: 'translate(-50%,-50%)',
      opacity: '0.8',
    }, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.6 + Math.random() * 0.3, Math.random() * 0.1);
  }
}

function explodeStars(cx, cy) {
  const colors = ['#ffcc44', '#ff006e', '#c8aaff', '#44eeff', '#ffffff', '#ffaa00'];
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
      color: color,
      textShadow: `0 0 8px ${color}, 0 0 20px ${color}`,
      transform: 'translate(-50%,-50%) rotate(0deg) scale(1)',
      opacity: '1',
      lineHeight: '1',
      _endTransform: `rotate(${rot}deg) scale(0)`,
    }, Math.cos(angle) * dist, Math.sin(angle) * dist, dur, 0);
    p.textContent = sym;
  }
  // Central flash
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', left: cx + 'px', top: cy + 'px',
    width: '80px', height: '80px',
    background: 'radial-gradient(circle, rgba(255,220,80,0.9) 0%, transparent 70%)',
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
  const rect  = target.el.getBoundingClientRect();
  const imgEl = target.el.querySelector('img');
  if (!imgEl || !imgEl.src) { explodeStars(rect.left + rect.width/2, rect.top + rect.height/2); return; }

  const cols = 3, rows = 2;
  const pw = rect.width  / cols;
  const ph = rect.height / rows;
  // Use actual rendered dimensions for background-size
  const bw = rect.width;
  const bh = rect.height;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = document.createElement('div');
      const px = rect.left + c * pw;
      const py = rect.top  + r * ph;

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
  const el   = target.el;
  const rect = el.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;

  // Dismiss overlay
  if (target._overlay) {
    target._overlay.style.opacity = '0';
    setTimeout(() => target._overlay.remove(), 500);
  }

  // Particles at screen center where photo is hovering
  const style = EXPLOSION_STYLES[Math.floor(Math.random() * EXPLOSION_STYLES.length)];
  if (style === 'dust')         explodeDust(cx, cy);
  else if (style === 'stars')   explodeStars(cx, cy);
  else if (style === 'shatter') explodeShatter(target);

  // Screen flash
  const flash = document.createElement('div');
  flash.className = 'kill-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 220);

  // Collapse in place (JS transition, not CSS class)
  const finalRot = -180 + Math.random() * 360;
  el.style.transition = 'transform 0.4s ease-in, opacity 0.35s ease-in';
  el.style.transform  = `translate(${target._dx}px, ${target._dy}px) rotate(${finalRot}deg) scale(0.03)`;
  el.style.opacity    = '0';

  setTimeout(() => {
    el.remove();
    setTimeout(spawnTarget, 200 + Math.random() * 600);
  }, 450);
}

// === DAMAGE SYSTEM ===
const MAX_HP = 3;

function damageTarget(target, amount) {
  if (target.dead || target.shooting) return;
  const now = Date.now();
  if (now - (target._lastDmg || 0) < 300) return;
  target._lastDmg = now;
  target.hp = (target.hp || MAX_HP) - amount;
  if (target.hp <= 0) {
    shootTarget(target);
    return;
  }
  // Visual hit feedback
  const frac = target.hp / MAX_HP;
  if (frac < 0.67) {
    target.el.style.boxShadow = '0 0 0 3px rgba(255,100,50,0.9), 0 0 18px rgba(255,60,0,0.5)';
  }
  if (frac < 0.34) {
    target.el.style.boxShadow = '0 0 0 5px rgba(255,0,0,1), 0 0 30px rgba(255,0,0,0.8)';
    target.el.style.filter    = 'saturate(0.3) contrast(1.4)';
  }
  // Shake
  target.el.style.setProperty('--tx', target.x + 'px');
  target.el.style.setProperty('--ty', target.y + 'px');
  target.el.style.animation = 'hitShake 0.28s ease';
  setTimeout(() => { if (!target.dead) target.el.style.animation = ''; }, 300);
}

// === SHOCKWAVE ===
function triggerShockwave(cx, cy) {
  // Visual ring
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    position: 'fixed', left: cx + 'px', top: cy + 'px',
    width: '30px', height: '30px', borderRadius: '50%',
    border: '3px solid rgba(200,150,255,0.85)',
    boxShadow: '0 0 12px rgba(200,150,255,0.5)',
    transform: 'translate(-50%,-50%) scale(1)',
    pointerEvents: 'none', zIndex: '200',
    transition: 'transform 0.55s ease-out, opacity 0.55s ease-out',
    opacity: '1',
  });
  document.body.appendChild(ring);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.transform = 'translate(-50%,-50%) scale(18)';
    ring.style.opacity   = '0';
  }));
  setTimeout(() => ring.remove(), 600);

  // Push + damage targets in radius
  const RADIUS = window.innerWidth * 0.45;
  targets.forEach(t => {
    if (t.dead) return;
    const dx = (t.x + t.w/2) - cx;
    const dy = (t.y + t.h/2) - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < RADIUS && dist > 0) {
      const force = (1 - dist/RADIUS) * 9;
      t.dx += (dx/dist) * force;
      t.dy += (dy/dist) * force;
      damageTarget(t, 1);
    }
  });
  playBoom();
}

// === FLICK BLAST ===
function triggerFlick(cx, cy, nx, ny, power) {
  // Visual streak
  const streak = document.createElement('div');
  const angle  = Math.atan2(ny, nx) * 180 / Math.PI;
  Object.assign(streak.style, {
    position: 'fixed', left: cx + 'px', top: cy + 'px',
    width: '120px', height: '4px',
    background: 'linear-gradient(to right, rgba(255,200,100,0.9), transparent)',
    borderRadius: '2px',
    transform: `translate(-10px,-2px) rotate(${angle}deg)`,
    transformOrigin: '0 50%',
    pointerEvents: 'none', zIndex: '200',
    transition: 'opacity 0.3s',
    opacity: '1',
  });
  document.body.appendChild(streak);
  requestAnimationFrame(() => requestAnimationFrame(() => { streak.style.opacity = '0'; }));
  setTimeout(() => streak.remove(), 350);

  // Push + damage targets in the flick direction
  const CONE   = 0.7; // cos of max angle (≈45°)
  const RADIUS = 350;
  targets.forEach(t => {
    if (t.dead) return;
    const dx   = (t.x + t.w/2) - cx;
    const dy   = (t.y + t.h/2) - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > RADIUS || dist === 0) return;
    const dot = (dx/dist)*nx + (dy/dist)*ny;
    if (dot < CONE) return; // outside cone
    const force = dot * power * 5;
    t.dx += nx * force;
    t.dy += ny * force;
    damageTarget(t, 1);
  });
}

// === MOBILE TOUCH CONTROLS ===
if (IS_MOBILE) {
  let tapTime = 0, tapX = 0, tapY = 0;
  let pressTimer = null, pressActive = false, pressEl = null;
  let swipeStartX = 0, swipeStartY = 0, swipeStartT = 0;
  let swipeCurX = 0, swipeCurY = 0;

  // Show hint
  const tip = document.createElement('div');
  tip.textContent = 'tap · double-tap · swipe · hold';
  Object.assign(tip.style, {
    position: 'fixed', bottom: '2rem', left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: "'Courier New', monospace",
    fontSize: '0.7rem', color: 'rgba(200,170,255,0.5)',
    pointerEvents: 'none', zIndex: '100',
    whiteSpace: 'nowrap', animation: 'blink 2s infinite',
  });
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 5000);

  function endPress() {
    clearTimeout(pressTimer);
    if (pressActive) {
      pressActive = false;
      mouseX = -9999; mouseY = -9999;
      if (pressEl) { pressEl.style.opacity = '0'; setTimeout(() => pressEl && pressEl.remove(), 300); pressEl = null; }
    }
  }

  document.addEventListener('touchstart', e => {
    const t0 = e.touches[0];
    swipeStartX = swipeCurX = t0.clientX;
    swipeStartY = swipeCurY = t0.clientY;
    swipeStartT = Date.now();

    // Double-tap detection (empty space only)
    if (!e.target.closest('.target')) {
      const now = Date.now();
      if (now - tapTime < 300 && Math.hypot(t0.clientX - tapX, t0.clientY - tapY) < 40) {
        triggerShockwave(t0.clientX, t0.clientY);
        tapTime = 0;
        return;
      }
      tapTime = now; tapX = t0.clientX; tapY = t0.clientY;
    }

    // Long press on empty space
    if (!e.target.closest('.target')) {
      pressTimer = setTimeout(() => {
        pressActive = true;
        mouseX = swipeStartX; mouseY = swipeStartY;

        pressEl = document.createElement('div');
        Object.assign(pressEl.style, {
          position: 'fixed', left: swipeStartX + 'px', top: swipeStartY + 'px',
          width: '60px', height: '60px', borderRadius: '50%',
          border: '2px solid rgba(200,150,255,0.5)',
          background: 'rgba(200,150,255,0.07)',
          transform: 'translate(-50%,-50%) scale(1)',
          pointerEvents: 'none', zIndex: '200',
          transition: 'transform 1.8s ease-out, opacity 0.3s',
        });
        document.body.appendChild(pressEl);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          pressEl.style.transform = 'translate(-50%,-50%) scale(4)';
        }));
      }, 380);
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    const t0 = e.touches[0];
    swipeCurX = t0.clientX;
    swipeCurY = t0.clientY;
    if (pressActive) { mouseX = t0.clientX; mouseY = t0.clientY; }
    // Movement cancels long press
    if (Math.hypot(t0.clientX - swipeStartX, t0.clientY - swipeStartY) > 12) {
      clearTimeout(pressTimer);
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    mouseX = -9999; mouseY = -9999;
    if (pressActive) { endPress(); return; }
    clearTimeout(pressTimer);

    const dt   = Date.now() - swipeStartT;
    const ddx  = swipeCurX - swipeStartX;
    const ddy  = swipeCurY - swipeStartY;
    const dist = Math.hypot(ddx, ddy);
    const vel  = dist / Math.max(dt, 1);

    if (vel > 0.6 && dist > 40 && dt < 400) {
      triggerFlick(swipeStartX, swipeStartY, ddx/dist, ddy/dist, Math.min(vel, 2));
    }
  }, { passive: true });
}

// === DESKTOP MOUSE CONTROLS ===
if (!IS_MOBILE) {
  let mouseDown = false;
  let pressTimer = null, pressActive = false, pressEl = null;
  let dragStartX = 0, dragStartY = 0, dragStartT = 0;
  let dragCurX = 0, dragCurY = 0;
  let lastClickTime = 0, lastClickX = 0, lastClickY = 0;

  function endMousePress() {
    clearTimeout(pressTimer);
    if (pressActive) {
      pressActive = false;
      if (pressEl) { pressEl.style.opacity = '0'; setTimeout(() => pressEl && pressEl.remove(), 300); pressEl = null; }
    }
  }

  gameArea.addEventListener('mousedown', e => {
    if (e.target.closest('.target')) return;
    mouseDown = true;
    dragStartX = dragCurX = e.clientX;
    dragStartY = dragCurY = e.clientY;
    dragStartT = Date.now();

    // Double click → shockwave
    const now = Date.now();
    if (now - lastClickTime < 300 && Math.hypot(e.clientX - lastClickX, e.clientY - lastClickY) < 40) {
      triggerShockwave(e.clientX, e.clientY);
      lastClickTime = 0;
      return;
    }
    lastClickTime = now; lastClickX = e.clientX; lastClickY = e.clientY;

    // Long press
    pressTimer = setTimeout(() => {
      pressActive = true;
      pressEl = document.createElement('div');
      Object.assign(pressEl.style, {
        position: 'fixed', left: dragStartX + 'px', top: dragStartY + 'px',
        width: '60px', height: '60px', borderRadius: '50%',
        border: '2px solid rgba(200,150,255,0.5)',
        background: 'rgba(200,150,255,0.07)',
        transform: 'translate(-50%,-50%) scale(1)',
        pointerEvents: 'none', zIndex: '200',
        transition: 'transform 1.8s ease-out, opacity 0.3s',
      });
      document.body.appendChild(pressEl);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pressEl.style.transform = 'translate(-50%,-50%) scale(4)';
      }));
    }, 380);
  });

  window.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    dragCurX = e.clientX;
    dragCurY = e.clientY;
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 12) clearTimeout(pressTimer);
  });

  window.addEventListener('mouseup', e => {
    if (!mouseDown) return;
    mouseDown = false;
    if (pressActive) { endMousePress(); return; }
    endMousePress();

    const dt   = Date.now() - dragStartT;
    const ddx  = dragCurX - dragStartX;
    const ddy  = dragCurY - dragStartY;
    const dist = Math.hypot(ddx, ddy);
    const vel  = dist / Math.max(dt, 1);

    if (vel > 0.6 && dist > 40 && dt < 400) {
      triggerFlick(dragStartX, dragStartY, ddx/dist, ddy/dist, Math.min(vel, 2));
    }
  });
}

// === WARP STARFIELD ===
const canvas = document.getElementById('stars');
const sctx   = canvas.getContext('2d');
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

  const spd      = BASE_SPEED + Math.random() * 0.7;
  const angle    = Math.random() * Math.PI * 2;
  const rot      = -15 + Math.random() * 30;
  const rotSpeed = -0.18 + Math.random() * 0.36;

  const el = document.createElement('div');
  el.className = 'target';
  el.style.cssText = `width:${w}px;left:${x}px;top:${y}px;--rot:${rot}deg;transform:rotate(${rot}deg)`;

  const target = {
    el, x, y,
    dx: Math.cos(angle) * spd,
    dy: Math.sin(angle) * spd,
    w, h: w,
    rot, rotSpeed, dead: false,
    hp: MAX_HP, maxHp: MAX_HP,
  };

  if (isVideo) {
    const vid = document.createElement('video');
    vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
    vid.style.cssText = 'display:block;width:100%;';
    vid.src = MEDIA_DIR + encodeURIComponent(file);
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
    img.onload = () => {
      if (img.naturalWidth > 0) target.h = w * (img.naturalHeight / img.naturalWidth);
    };
    img.src = MEDIA_DIR + encodeURIComponent(file);
    el.appendChild(img);
  }

  targets.push(target);
  gameArea.appendChild(el);
  el.addEventListener('click', e => { e.stopPropagation(); damageTarget(target, 1); });
}

// === SHOOT — fly to center, hold, then explode ===
function shootTarget(target) {
  if (target.dead || target.shooting) return;
  target.shooting = true;
  target.dead = true;
  targets.splice(targets.indexOf(target), 1);

  score++;
  scoreVal.textContent = score;

  const now = Date.now();
  killStreak   = (now - lastKillTime < 1600) ? killStreak + 1 : 1;
  lastKillTime = now;
  if (killStreak >= 3) showStreakPopup(killStreak);

  playPew();

  const el = target.el;
  const W  = window.innerWidth;
  const H  = window.innerHeight;

  // Move element out of gameArea onto body so it shares stacking context with overlay
  el.style.position = 'fixed';
  el.style.left = target.x + 'px';
  el.style.top  = target.y + 'px';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '30';
  document.body.appendChild(el);

  // Dim overlay so photo stands out — z-index 25, below target's 30
  const overlay = document.createElement('div');
  overlay.className = 'kill-overlay';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));
  target._overlay = overlay;

  // Transform needed to move center of element to screen center, upright, big
  const dx    = W / 2 - (target.x + target.w / 2);
  const dy    = H / 2 - (target.y + target.h / 2);
  const scale = Math.min(W * 0.72, H * 0.72) / target.w;
  target._dx    = dx;
  target._dy    = dy;
  target._scale = scale;

  // Fly to center
  el.style.transition = 'transform 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`;
  }));

  // Hold for 2.8s after fly-in (0.7s), then explode
  setTimeout(() => {
    playBoom();
    playNuttyClip();
    triggerExplosion(target);
  }, 700 + 2800);
}

// === GAME LOOP ===
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

    t.dx *= DAMPING;
    t.dy *= DAMPING;
    const spd = Math.sqrt(t.dx * t.dx + t.dy * t.dy);
    if (spd < BASE_SPEED && spd > 0) { t.dx = t.dx / spd * BASE_SPEED; t.dy = t.dy / spd * BASE_SPEED; }
    if (spd > MAX_SPEED)             { t.dx = t.dx / spd * MAX_SPEED;   t.dy = t.dy / spd * MAX_SPEED; }

    t.x   += t.dx;
    t.y   += t.dy;
    t.rot += t.rotSpeed;

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
