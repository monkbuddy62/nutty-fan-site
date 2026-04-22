// === SCROLL REVEAL ===
const revealBlocks = document.querySelectorAll('.reveal-block');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
revealBlocks.forEach(b => revealObserver.observe(b));

// === TOP 10 — click to toggle reveal ===
document.querySelectorAll('.moment').forEach(m => {
  m.addEventListener('click', () => m.classList.toggle('revealed'));
});

// === RATING ENGINE ===
const loadingMessages = [
  'Initializing Nutty scan…',
  'Scanning neural patterns…',
  'Detecting nonsense levels…',
  'Cross-referencing with known idiots…',
  'Consulting the dice gods…',
  'Calculating chaos coefficient…',
  'Results are bad. Preparing bad results…',
];

const resultSets = [
  {
    suck: '97%',
    brain: 'buffering…',
    loyalty: 'questionable at best',
    dnd: 'rolled a 1 on intelligence',
    vibe: 'chaotic neutral (barely)',
    verdict: '"A man of unique vision." — no one, ever.',
  },
  {
    suck: '84%',
    brain: '404 Not Found',
    loyalty: 'sold you out for a blanket',
    dnd: 'threw a hot iron at the horse',
    vibe: 'certified pee-er',
    verdict: '"He just wanted a blanket, okay?" — Nutty\'s defense attorney',
  },
  {
    suck: 'ERROR: value exceeds maximum',
    brain: '9',
    loyalty: 'lol',
    dnd: 'Paladin named Jake (???)',
    vibe: 'chaotic stupid',
    verdict: '"I think your just gonna have to shove these up your ass." — Nutty, re: these results',
  },
  {
    suck: '91%',
    brain: 'critically low',
    loyalty: 'ran off to check for traps',
    dnd: 'shoved bread in the wound',
    vibe: 'sneaky bite energy',
    verdict: '"He was checking his door for traps the whole time." — eyewitness report',
  },
  {
    suck: '88%',
    brain: 'offline',
    loyalty: '"man these mfers are useless"',
    dnd: '"uhh what" (re: Dwarven)',
    vibe: 'unhinged paladin',
    verdict: '"I\'m Nutty. I\'m playing a paladin named Jake." — him, seriously',
  },
];

// Glitch result shown on every 5th click
const glitchResult = {
  suck: 'WE LIVE BY CHAOS',
  brain: 'CHAOS',
  loyalty: 'CHAOS CHAOS',
  dnd: '🌀 CHAOS 🌀',
  vibe: 'CHAOS',
  verdict: 'CHAOS CHAOS WE LIVE BY CHAOS',
};

let analyzeCount = 0;

function runAnalysis() {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const loadingArea = document.getElementById('loadingArea');
  const resultsArea = document.getElementById('resultsArea');
  const progressBar = document.getElementById('progressBar');
  const loadingStatus = document.getElementById('loadingStatus');

  analyzeBtn.classList.add('hidden');
  resultsArea.classList.add('hidden');
  loadingArea.classList.remove('hidden');
  progressBar.style.width = '0%';
  analyzeCount++;

  let msgIndex = 0;
  let progress = 0;

  const msgInterval = setInterval(() => {
    if (msgIndex < loadingMessages.length) {
      loadingStatus.textContent = loadingMessages[msgIndex++];
    }
  }, 360);

  const progressInterval = setInterval(() => {
    progress += Math.random() * 3.5 + 1;
    if (progress >= 100) {
      progress = 100;
      clearInterval(progressInterval);
      clearInterval(msgInterval);
      progressBar.style.width = '100%';
      setTimeout(showResults, 350);
    }
    progressBar.style.width = progress + '%';
  }, 80);
}

function showResults() {
  const loadingArea = document.getElementById('loadingArea');
  const resultsArea = document.getElementById('resultsArea');
  const resultCard = document.querySelector('.result-card');

  loadingArea.classList.add('hidden');
  resultsArea.classList.remove('hidden');

  const isGlitch = analyzeCount % 5 === 0;
  const result = isGlitch
    ? glitchResult
    : resultSets[Math.floor(Math.random() * resultSets.length)];

  document.getElementById('res-suck').textContent    = result.suck;
  document.getElementById('res-brain').textContent   = result.brain;
  document.getElementById('res-loyalty').textContent = result.loyalty;
  document.getElementById('res-dnd').textContent     = result.dnd;
  document.getElementById('res-vibe').textContent    = result.vibe;
  document.getElementById('res-verdict').textContent = result.verdict;

  if (isGlitch) {
    resultCard.classList.add('glitching');
    playAudio(clips[11]); // "i will shit on this table"
    setTimeout(() => resultCard.classList.remove('glitching'), 500);
  }

  document.getElementById('analyzeAgainBtn').onclick = () => {
    resultsArea.classList.add('hidden');
    document.getElementById('analyzeBtn').classList.remove('hidden');
  };
}

document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

// === SOUNDBOARD ===
const clips = [
  { label: 'This girl is coming on to me',      file: 'Nuty this girl is coming on to me.wav' },
  { label: '3 inch dick — on the char sheet',   file: 'Nutty- And a 3 inch dick_is that on your char sheet_its going to be now.wav' },
  { label: 'Shoving bread in the hole',          file: 'Nutty Molly - I start shoving bread in his bleeding hole... ew.wav' },
  { label: 'The Disappointment Shake',           file: 'Nutty Jake - I shake my head at jake in dissapointment.wav' },
  { label: 'You got that recorded, Pat?',        file: 'Nutty - woah yoiu got that recorded right pat.wav' },
  { label: 'Just wanted a blanket',              file: 'Nutty - thats alot of hate i just wanted a blanket.wav' },
  { label: 'Sneaky Bite',                        file: 'Nutty - sneaky bite.wav' },
  { label: 'I hate mages',                       file: 'nutty - ohh i hate mages.wav' },
  { label: 'Useless in a fight',                 file: 'Nutty - man these mfrers are useless in a fight.wav' },
  { label: 'Hot iron at the horse',              file: 'Nutty - ima take that hot iron and ima throw it at the horse.wav' },
  { label: "I'm Nutty, Paladin Named Jake",      file: 'Nutty - Im nutty im playing a paladin named jake.wav' },
  { label: 'I will shit on this table',          file: 'Nutty - if you want me to ill shit on this table.wav' },
  { label: 'Shove these up your ass',            file: 'Nutty - I think your just gonna have to shove these up your ass.wav' },
  { label: 'I pee on him',                       file: 'Nutty - i pee on him.wav' },
  { label: 'Checking for traps',                 file: 'nutty - checking my door for traps.wav' },
  { label: 'Can you read Dwarven?',              file: 'Nutty - can you read dwarven uhh what .wav' },
  { label: '3.5 inch dick (upgrade)',            file: 'Nutty - can i get that 3.5 inch dick.wav' },
  { label: 'And a 3 inch dick',                  file: 'Nutty - and a 3 inch dick.wav' },
  { label: '??? RARE DROP ???', rare: true,      file: 'Jake Pat Nut - Nutty shitting on a plate (full)).wav' },
];

const chaosClip = { file: 'Jake Nuty - Chaos Chaos we live by chaos.wav' };

let totalClicks = 0;
let lastThree = [];

// Combo: "i pee on him" (13) → "shoving bread" (2) → "shit on table" (11)
const COMBO = [13, 2, 11];

let currentAudio = null;

function playAudio(clip) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  const audio = new Audio('audio/' + encodeURIComponent(clip.file));
  audio.play().catch(() => {});
  currentAudio = audio;
  return audio;
}

function trackClick(index) {
  totalClicks++;
  lastThree.push(index);
  if (lastThree.length > 3) lastThree.shift();

  if (totalClicks === 10) revealSecretButton();

  if (
    lastThree.length === 3 &&
    lastThree[0] === COMBO[0] &&
    lastThree[1] === COMBO[1] &&
    lastThree[2] === COMBO[2]
  ) {
    triggerCombo();
  }
}

function buildSoundboard() {
  const grid = document.getElementById('soundGrid');

  clips.forEach((clip, i) => {
    const btn = document.createElement('button');
    btn.className = 'sound-btn' + (clip.rare ? ' rare' : '');
    btn.textContent = clip.label;

    if (clip.rare) {
      btn.addEventListener('click', () => {
        totalClicks++;
        if (totalClicks >= 10) revealSecretButton();

        if (Math.random() < 0.15) {
          btn.textContent = 'Shitting on a Plate (Full)';
          btn.classList.remove('rare');
          btn.classList.add('playing');
          setTimeout(() => btn.classList.remove('playing'), 500);
          playAudio(clip);
          lastThree.push(i);
          if (lastThree.length > 3) lastThree.shift();
        } else {
          const orig = btn.textContent;
          btn.textContent = 'nope…';
          setTimeout(() => { if (btn.classList.contains('rare')) btn.textContent = '??? RARE DROP ???'; }, 1200);
        }
      });
    } else {
      btn.addEventListener('click', () => {
        btn.classList.add('playing');
        setTimeout(() => btn.classList.remove('playing'), 400);
        playAudio(clip);
        trackClick(i);
      });
    }

    grid.appendChild(btn);
  });
}

function revealSecretButton() {
  const wrap = document.getElementById('secretBtn');
  if (!wrap.classList.contains('hidden')) return;
  wrap.classList.remove('hidden');
  triggerChaosOverlay();

  document.getElementById('chaosBtn').addEventListener('click', () => {
    const btn = document.getElementById('chaosBtn');
    btn.classList.add('playing');
    setTimeout(() => btn.classList.remove('playing'), 500);
    playAudio(chaosClip);
    triggerChaosOverlay();
    totalClicks++;
  });
}

function triggerCombo() {
  const display = document.getElementById('comboDisplay');
  display.textContent = '🔥 CHAOS COMBO UNLOCKED — the unholy trinity has been achieved. 🔥';
  display.classList.remove('hidden');
  playAudio(chaosClip);
  triggerChaosOverlay();
  setTimeout(() => display.classList.add('hidden'), 5000);
}

function triggerChaosOverlay() {
  const overlay = document.getElementById('chaosOverlay');
  overlay.classList.remove('hidden');
  // force reflow so animation replays
  void overlay.offsetWidth;
  setTimeout(() => overlay.classList.add('hidden'), 520);
}

buildSoundboard();
