(function(){
"use strict";

/* ==========================================================================
  NEON CHAOS: SURVIVE THE ARENA
   Responsive & Mobile-First Engine Architecture
   - Internal World Resolution: 1280 × 720
   - Dynamic Camera Tracking (Landscape Wide-View + Portrait Focused Framing)
   - Screen-Space Touch Controls & Unified Pointer Input Layer
   - Smart Mobile Aim Assist
   - High-contrast visual attack telegraphs (Sniper, Tank, Meteor)
  - Full preservation of all 16 Chaos events & Hiccups
   - Zero-allocation Object Pooling & Adaptive Performance
   ========================================================================== */

// ---------- World Constants (1280x720 Base) ----------
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;
const GROUND_Y = 630;
const CEIL_Y = 55;

const MIN_SPAWN_DISTANCE = 260;
const MAX_ENEMIES = 32;
const INVULN_DURATION = 0.75;
const CONTACT_COOLDOWN = 0.6;
const DEFAULT_GRAVITY = 0.6 * 60;   // 36 px/s^2 base
const PLAYER_BASE_SPEED = 5.2 * 60; // 312 px/s
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;

// Detect device pointer capability
const isCoarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || isCoarsePointer;

// ---------- Settings & Adaptive Quality State ----------
const settings = {
  shake: true,
  flashing: true,
  contrast: false,
  particles: isCoarsePointer ? 'med' : 'high', // 'high' | 'med' | 'low'
  sound: true,
  music: true,
  musicVolume: 0.45,
  soundVolume: 0.65,
  reduceMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  theme: 'noir',
};

// Load persistent settings
try {
  const saved = localStorage.getItem('chaos_arena_settings');
  if (saved) Object.assign(settings, JSON.parse(saved));
} catch(e) {}

const validThemes = ['noir', 'vaporwave', 'tactical', 'pop'];
if (!validThemes.includes(settings.theme)) settings.theme = 'noir';
settings.musicVolume = clamp(settings.musicVolume, 0, 1);
settings.soundVolume = clamp(settings.soundVolume, 0, 1);
document.body.dataset.theme = settings.theme;
document.body.classList.toggle('high-contrast', !!settings.contrast);
document.body.classList.toggle('no-flash', !settings.flashing);
document.body.classList.add('motion-override');
document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);

function saveSettings(){
  try {
    localStorage.setItem('chaos_arena_settings', JSON.stringify(settings));
  } catch(e) {}
}

function getMaxParticles(){
  if (settings.particles === 'low') return 90;
  if (settings.particles === 'med') return 190;
  return 380;
}

// ---------- Canvas & Viewport Architecture ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

let screenW = window.innerWidth;
let screenH = window.innerHeight;
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let isPortrait = screenH > screenW;

// Dynamic Camera System
const camera = {
  x: BASE_WIDTH / 2,
  y: BASE_HEIGHT / 2,
  targetX: BASE_WIDTH / 2,
  targetY: BASE_HEIGHT / 2,
  zoom: 1,
  targetZoom: 1,
  rotation: 0,
  targetRotation: 0,
  shakeX: 0,
  shakeY: 0,
};

function resizeGame(){
  screenW = window.innerWidth;
  screenH = window.innerHeight;
  isPortrait = screenH > screenW;
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(screenW * dpr);
  canvas.height = Math.floor(screenH * dpr);
  canvas.style.width = screenW + 'px';
  canvas.style.height = screenH + 'px';

  // Calculate Camera Zoom for Portrait vs Landscape
  if (isPortrait){
    // In portrait, keep ~640 world units visible horizontally
    camera.targetZoom = (screenW / 650);
    camera.targetZoom = Math.max(0.42, Math.min(camera.targetZoom, 1.4));
  } else {
    // In landscape, fit base arena dimensions with margin
    const zx = screenW / (BASE_WIDTH + 80);
    const zy = screenH / (BASE_HEIGHT + 90);
    camera.targetZoom = Math.min(zx, zy, 1.35);
  }

  // Display touch controls on touch devices
  const touchLayer = document.getElementById('touch-controls');
  if (isTouchDevice && touchLayer){
    touchLayer.classList.add('active');
  }
}
window.addEventListener('resize', resizeGame);
window.addEventListener('orientationchange', resizeGame);
resizeGame();

// Coordinate Conversions (Screen <-> World)
function screenToWorld(sx, sy){
  const cx = screenW / 2;
  const cy = screenH / 2;
  const dx = (sx - cx) / camera.zoom;
  const dy = (sy - cy) / camera.zoom;
  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: rx + camera.x,
    y: ry + camera.y,
  };
}

function worldToScreen(wx, wy){
  const cx = screenW / 2;
  const cy = screenH / 2;
  const dx = wx - camera.x;
  const dy = wy - camera.y;
  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: cx + rx * camera.zoom,
    y: cy + ry * camera.zoom,
  };
}

// ---------- WebAudio Sound System & Background Music ----------
let actx = null;
function initAudio(){
  if (!actx){
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {}
  }
  if (actx && actx.state === 'suspended'){
    actx.resume();
  }
  initBgMusic();
}
['pointerdown', 'keydown', 'click'].forEach(evt => window.addEventListener(evt, initAudio, { once: true }));

// Background Music (track.mp3)
let bgMusic = null;
let bgMusicLoaded = false;

function initBgMusic(){
  if (!bgMusic){
    try {
      bgMusic = new Audio();
      bgMusic.src = 'track.mp3';
      bgMusic.loop = true;
      bgMusic.volume = settings.musicVolume;
      bgMusic.preload = 'auto';

      bgMusic.addEventListener('canplaythrough', () => {
        bgMusicLoaded = true;
      });

      // Handle missing file or loading errors gracefully without throwing
      bgMusic.addEventListener('error', () => {
        bgMusicLoaded = false;
      });
    } catch(e) {}
  }
}

function playBgMusic(){
  initBgMusic();
  if (!settings.music) return;
  if (bgMusic && bgMusic.paused){
    try {
      bgMusic.volume = settings.musicVolume;
      const promise = bgMusic.play();
      if (promise !== undefined){
        promise.catch(() => {
          // Autoplay policy or track.mp3 missing - handled gracefully
        });
      }
    } catch(e) {}
  }
}

function pauseBgMusic(){
  if (bgMusic){
    try {
      bgMusic.pause();
    } catch(e) {}
  }
}

function syncMusicPlayback(){
  if (settings.music && world.state === "PLAYING") playBgMusic();
  else pauseBgMusic();
}

function stopBgMusic(){
  if (bgMusic){
    try {
      bgMusic.pause();
      bgMusic.currentTime = 0;
    } catch(e) {}
  }
}

function beep(freq, dur, type='square', vol=0.08, delay=0){
  if (!settings.sound || !actx) return;
  try {
    const t0 = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol * settings.soundVolume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch(e) {}
}

function sfxJump(){ beep(440, 0.1, 'square', 0.06); beep(660, 0.08, 'square', 0.05, 0.04); }
function sfxShoot(){ beep(880, 0.05, 'square', 0.04); }
function sfxBonusShoot(){ beep(1100, 0.07, 'triangle', 0.08); beep(1400, 0.09, 'triangle', 0.07, 0.04); }
function sfxHit(){ beep(150, 0.15, 'sawtooth', 0.09); }
function sfxPickup(){ beep(660, 0.08, 'triangle', 0.07); beep(990, 0.1, 'triangle', 0.06, 0.06); }
function sfxChaos(){ [220, 330, 440, 660, 880].forEach((f, i) => beep(f, 0.18, 'sawtooth', 0.07, i * 0.05)); }
function sfxDeath(){ beep(200, 0.5, 'sawtooth', 0.1); beep(100, 0.6, 'sawtooth', 0.08, 0.1); }
function sfxHiccup(){ beep(180, 0.09, 'square', 0.06); beep(90, 0.14, 'sawtooth', 0.07, 0.06); }
function sfxBtn(){ beep(520, 0.06, 'triangle', 0.04); }

// ---------- Math Utilities & Collisions ----------
function rand(a, b){ return a + Math.random() * (b - a); }
function randi(a, b){ return Math.floor(rand(a, b + 1)); }
function choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function dist2(ax, ay, bx, by){ const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }

function rectRectCollision(ax, ay, aw, ah, bx, by, bw, bh){
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function circleRectCollision(cx, cy, cr, rx, ry, rw, rh){
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX, dy = cy - closestY;
  return (dx*dx + dy*dy) <= (cr * cr);
}

function sweptBulletCollision(bullet, dt, target){
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h / 2;
  const tr = Math.max(target.w, target.h) / 2 + bullet.r;
  const x0 = bullet.x, y0 = bullet.y;
  const x1 = bullet.x + bullet.vx * dt;
  const y1 = bullet.y + bullet.vy * dt;
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - tx, fy = y0 - ty;
  const a = dx*dx + dy*dy;
  if (a < 0.0001) {
    return (fx*fx + fy*fy) <= tr*tr ? 0 : -1;
  }
  const b = 2 * (fx*dx + fy*dy);
  const c = fx*fx + fy*fy - tr*tr;
  let disc = b*b - 4*a*c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2*a);
  const t2 = (-b + disc) / (2*a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  if (t1 < 0 && t2 > 1) return 0;
  return -1;
}

// ---------- Object Pools ----------
const bulletPool = [];
for (let i = 0; i < 150; i++){
  bulletPool.push({_pooled: true, _dead: false, x:0, y:0, vx:0, vy:0, life:0, maxLife:0, r:0, color:'#fff', fromPlayer:false, isBonus:false});
}
function getBullet(){
  const b = bulletPool.length > 0 ? bulletPool.pop() : {_pooled:false, _dead:false, x:0, y:0, vx:0, vy:0, life:0, maxLife:0, r:0, color:'#fff', fromPlayer:false, isBonus:false};
  b._pooled = false;
  b._dead = false;
  b.isBonus = false;
  return b;
}
function releaseBullet(b){
  if (!b) return;
  b._pooled = true;
  bulletPool.push(b);
}

const particlePool = [];
for (let i = 0; i < 400; i++){
  particlePool.push({_pooled: true, x:0, y:0, vx:0, vy:0, life:0, maxLife:0, color:'#fff', size:2, meteor:false, targetY:0});
}
function getParticle(){
  const p = particlePool.length > 0 ? particlePool.pop() : {_pooled:false, x:0, y:0, vx:0, vy:0, life:0, maxLife:0, color:'#fff', size:2, meteor:false, targetY:0};
  p._pooled = false;
  return p;
}
function releaseParticle(p){
  if (!p) return;
  p._pooled = true;
  particlePool.push(p);
}

// ---------- Central World State ----------
const world = {
  state: "MENU", // MENU, PLAYING, PAUSED, GAME_OVER

  time: 0,
  realTime: 0,
  timeScale: 1,

  baseGravity: DEFAULT_GRAVITY,
  gravity: DEFAULT_GRAVITY,
  gravityDir: 1,

  invertColors: false,
  bgHue: 260,

  wave: 1,
  enemiesToSpawn: 0,
  spawnCooldown: 0,

  chaos: 0,
  chaosTriggered: false,

  score: 0,
  kills: 0,
  survivalTime: 0,
  player: null,

  enemies: [],
  bullets: [],
  pickups: [],
  particles: [],
  floaters: [],
  stars: [],
  activeEffects: [],

  input: {
    moveX: 0,
    jumpPressed: false,
    jumpHeld: false,
    shootPressed: false,
    shootHeld: false,
    aimX: 0,
    aimY: 0,
    hasAimTouch: false,
    aimAngle: 0,
  },

  killsSincePickup: 0,
  fps: 60,
  _nextHiccupTime: 0,
};

// Ambient Stars
for (let i = 0; i < 115; i++){
  world.stars.push({
    x: rand(0, BASE_WIDTH),
    y: rand(0, BASE_HEIGHT),
    r: rand(0.6, 2.2),
    s: rand(8, 40),
    alpha: rand(0.3, 0.8)
  });
}

// ---------- Effects & Modifiers System ----------
function addEffect(type, duration, data = {}){
  for (let i = world.activeEffects.length - 1; i >= 0; i--){
    if (world.activeEffects[i].type === type){
      world.activeEffects.splice(i, 1);
    }
  }
  const effect = { type, remaining: duration, duration, data };
  startEffectInstance(effect);
  world.activeEffects.push(effect);
}

function startEffectInstance(e){
  switch(e.type){
    case "meteorShower":
      e.data.spawnTimer = 0;
      e.data.meteorsLeft = 14;
      break;
    case "crateRain":
      e.data.spawnTimer = 0;
      e.data.cratesLeft = 6;
      break;
    case "gravityFlip":
      camera.targetRotation = Math.PI;
      break;
  }
}

function recomputeWorldModifiers(){
  world.timeScale = 1;
  world.gravity = world.baseGravity;
  world.gravityDir = 1;
  world.invertColors = false;

  let playerScaleMult = 1;
  let playerMaxJumpsBonus = 0;
  let playerFireMult = 1;
  let playerSpeedMult = 1;
  let controlInversion = false;

  for (const e of world.activeEffects){
    switch(e.type){
      case "slowMo":      world.timeScale *= 0.42; break;
      case "turbo":       world.timeScale *= 1.75; break;
      case "giantMode":   playerScaleMult *= 1.75; break;
      case "tinyMode":    playerScaleMult *= 0.55; break;
      case "gravityFlip": world.gravityDir = -1; break;
      case "reverseCtrl": controlInversion = true; break;
      case "tripleJump":  playerMaxJumpsBonus = 1; break;
      case "rapidFire":   playerFireMult *= 3; break;
      case "colorInvert": world.invertColors = true; break;
    }
  }

  if (world.player){
    world.player.scaleMult = playerScaleMult;
    world.player.effectiveMaxJumps = 2 + playerMaxJumpsBonus;
    world.player.fireRateMult = playerFireMult;
    world.player.speedMult = playerSpeedMult;
    world.player.controlInverted = controlInversion;
  }

  const hasGravityFlip = world.activeEffects.some(e => e.type === "gravityFlip");
  camera.targetRotation = hasGravityFlip ? Math.PI : 0;

  const bonusPip = document.getElementById('pip-3');
  if (bonusPip){
    bonusPip.classList.toggle('active', playerMaxJumpsBonus > 0);
  }
}

// ---------- All 16 Chaos Events ----------
const chaosEventDefs = [
  {
    name: "GRAVITY FLIP!!",
    start(){ addEffect("gravityFlip", 10); }
  },
  {
    name: "GIANT MODE",
    start(){ addEffect("giantMode", 6); }
  },
  {
    name: "TINY MODE",
    start(){ addEffect("tinyMode", 6); }
  },
  {
    name: "SLOW-MO CHAOS",
    start(){ addEffect("slowMo", 4); }
  },
  {
    name: "TURBO TIME",
    start(){ addEffect("turbo", 4); }
  },
  {
    name: "METEOR SHOWER",
    start(){
      addEffect("meteorShower", 3.8);
      triggerScreenShake(10, 10);
    }
  },
  {
    name: "CONFETTI PURGE",
    start(){
      for (const e of world.enemies){
        spawnParticles(e.x + e.w/2, e.y + e.h/2, 20, ['#ff2ec4','#2efff2','#fff62e','#a12eff'], 260, 0.85);
        world.score += 8;
        if (!e.dead) world.kills++;
      }
      world.enemies.length = 0;
      floatText(BASE_WIDTH / 2, BASE_HEIGHT / 2, "ENEMIES = CONFETTI!", '#2efff2');
    }
  },
  {
    name: "REVERSE CONTROLS",
    start(){ addEffect("reverseCtrl", 4.5); }
  },
  {
    name: "HEALING RAIN",
    start(){
      if (world.player){
        world.player.hp = clamp(world.player.hp + 45, 0, world.player.maxHp);
        floatText(world.player.x + world.player.w/2, world.player.y - 25, "+45 HP HEAL!", '#2eff6a');
        updateHUD();
      }
    }
  },
  {
    name: "WIND STORM",
    start(){
      const dir = Math.random() < 0.5 ? -1 : 1;
      const strength = rand(140, 320);
      addEffect("windStorm", 5.5, { dir, strength });
    }
  },
  {
    name: "INVERT REALITY",
    start(){ addEffect("colorInvert", 7); }
  },
  {
    name: "TRIPLE JUMP UNLOCKED",
    start(){ addEffect("tripleJump", 8); }
  },
  {
    name: "BULLET STORM",
    start(){ addEffect("rapidFire", 4.5); }
  },
  {
    name: "SCREEN SHAKE APOCALYPSE",
    start(){ triggerScreenShake(26, 26); }
  },
  {
    name: "BONUS CRATE RAIN",
    start(){ addEffect("crateRain", 1.4); }
  },
  {
    name: "HUE SHIFT MAYHEM",
    start(){ addEffect("hueCycle", 2.2); }
  },
];

const chaosEventDescriptions = {
  "GRAVITY FLIP!!": "The arena ceiling becomes your new floor.",
  "GIANT MODE": "Your size and weight surge for a few seconds.",
  "TINY MODE": "Shrink down and slip through the chaos.",
  "SLOW-MO CHAOS": "Everything moves in slow motion.",
  "TURBO TIME": "The arena accelerates. Keep moving.",
  "METEOR SHOWER": "Watch the floor markers and keep clear.",
  "CONFETTI PURGE": "Every enemy on screen is cleared.",
  "REVERSE CONTROLS": "Movement is temporarily reversed.",
  "HEALING RAIN": "Recover up to 45 health.",
  "WIND STORM": "A strong gust pushes you across the arena.",
  "INVERT REALITY": "The arena colors turn inside out.",
  "TRIPLE JUMP UNLOCKED": "Gain one extra jump while airborne.",
  "BULLET STORM": "Your weapon fires much faster.",
  "SCREEN SHAKE APOCALYPSE": "The arena shakes hard. Stay focused.",
  "BONUS CRATE RAIN": "Extra mystery crates are falling.",
  "HUE SHIFT MAYHEM": "The arena palette cycles rapidly.",
};

const chaosEventAccents = {
  "GRAVITY FLIP!!": "cyan",
  "GIANT MODE": "amber",
  "TINY MODE": "magenta",
  "SLOW-MO CHAOS": "cyan",
  "TURBO TIME": "amber",
  "METEOR SHOWER": "danger",
  "CONFETTI PURGE": "magenta",
  "REVERSE CONTROLS": "amber",
  "HEALING RAIN": "green",
  "WIND STORM": "cyan",
  "INVERT REALITY": "magenta",
  "TRIPLE JUMP UNLOCKED": "green",
  "BULLET STORM": "amber",
  "SCREEN SHAKE APOCALYPSE": "danger",
  "BONUS CRATE RAIN": "green",
  "HUE SHIFT MAYHEM": "magenta",
};

function triggerChaosEvent(){
  const ev = choice(chaosEventDefs);
  ev.start();
  showEventBanner(ev.name, chaosEventDescriptions[ev.name] || "Arena conditions have changed.", chaosEventAccents[ev.name] || 'cyan');
  sfxChaos();
  triggerScreenShake(14, 14);
  if (world.player){
    spawnParticles(world.player.x + world.player.w/2, world.player.y + world.player.h/2,
      28, ['#2efff2','#ff2ec4','#fff62e','#a12eff'], 300, 0.9);
  }
}

// ---------- Screen Shake Helper ----------
function triggerScreenShake(sx, sy){
  if (!settings.shake) return;
  camera.shakeX = Math.max(camera.shakeX, sx);
  camera.shakeY = Math.max(camera.shakeY, sy);
}

// ---------- Responsive Banner System ----------
const bannerEl = document.getElementById('banner');
const bannerTitle = document.getElementById('banner-title');
const bannerSub = document.getElementById('banner-sub');
let bannerTimer = null;

function showEventBanner(title, sub="", accent='cyan'){
  if (!bannerEl || !bannerTitle) return;
  setUIText(bannerTitle, title);
  if (bannerSub) setUIText(bannerSub, sub);
  bannerEl.dataset.accent = accent;
  bannerEl.classList.add('active');

  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    bannerEl.classList.remove('active');
    bannerTimer = null;
  }, 1700);
}

function showWaveBanner(waveNum, count){
  const subText = isPortrait ? `${count} ENEMIES\nGET READY` : `${count} ENEMIES · GET READY`;
  showEventBanner(`WAVE ${waveNum}`, subText, 'cyan');
}

// ---------- Floating Text ----------
function floatText(x, y, text, color='#fff62e'){
  world.floaters.push({ x, y, text, color, life: 1.1, maxLife: 1.1, vy: -45 });
}

// ---------- Particles (Pooled) ----------
function spawnParticles(x, y, count, colors, spread=200, life=0.6){
  const maxAllowed = getMaxParticles();
  for (let i = 0; i < count; i++){
    if (world.particles.length >= maxAllowed) break;
    const p = getParticle();
    p.x = x; p.y = y;
    p.vx = rand(-spread, spread);
    p.vy = rand(-spread, spread);
    p.life = life + rand(-0.15, 0.25);
    p.maxLife = p.life;
    p.color = choice(colors);
    p.size = rand(2.5, 5);
    p.meteor = false;
    world.particles.push(p);
  }
}

// ---------- Player Factory ----------
function createPlayer(){
  return {
    x: BASE_WIDTH / 2 - 18,
    y: GROUND_Y - 44,
    w: 36,
    h: 44,
    vx: 0,
    vy: 0,
    onGround: false,
    jumpsUsed: 0,
    baseMaxJumps: 2,
    effectiveMaxJumps: 2,

    hp: 100,
    maxHp: 100,
    facing: 1,
    invuln: 0,

    baseSpeed: PLAYER_BASE_SPEED,
    speedMult: 1,
    scaleMult: 1,
    fireRateMult: 1,
    controlInverted: false,

    fireCooldown: 0,
    baseFireInterval: 0.18,

    drift: 0,
    aimWobble: 0,
    coyoteTimer: 0,
    jumpBuffer: 0,
    hiccupUntil: 0,

    trail: [],
    color: '#2efff2',
  };
}

// ---------- Enemy Factory ----------
function createEnemy(type, fromLeft){
  const baseX = fromLeft ? -40 : BASE_WIDTH + 40;
  const e = {
    type,
    x: baseX,
    y: GROUND_Y - 32,
    w: 32,
    h: 32,
    vx: 0,
    vy: 0,
    hp: 20,
    maxHp: 20,
    dmg: 8,
    color: '#ff2ec4',
    shootCooldown: 1.0,
    hitFlash: 0,
    wobble: rand(0, Math.PI * 2),
    contactCooldown: 0,
    aiTimer: 0,
    dead: false,
    attackTelegraph: 0,
  };

  const wave = world.wave;
  const speedScale = clamp(1 + (wave - 1) * 0.035, 1, 2.1);
  const hpScale = clamp(1 + (wave - 1) * 0.09, 1, 3.4);
  const attackScale = clamp(1 - (wave - 1) * 0.03, 0.45, 1);

  switch(type){
    case 'grunt':
      e.hp = Math.round(20 * hpScale);
      e.maxHp = e.hp;
      e.color = '#ff2ec4';
      e.speed = 88 * speedScale;
      e.dmg = 8 + Math.floor((wave - 1) * 0.4);
      e.w = 32; e.h = 32;
      e.y = GROUND_Y - e.h;
      break;
    case 'flyer':
      e.hp = Math.round(15 * hpScale);
      e.maxHp = e.hp;
      e.color = '#a12eff';
      e.speed = 125 * speedScale;
      e.dmg = 7 + Math.floor((wave - 1) * 0.3);
      e.w = 28; e.h = 24;
      e.y = rand(120, 310);
      e.strafePhase = rand(0, Math.PI * 2);
      break;
    case 'tank':
      e.hp = Math.round(60 * hpScale);
      e.maxHp = e.hp;
      e.color = '#ff6a2e';
      e.speed = 46 * speedScale;
      e.dmg = 15 + Math.floor((wave - 1) * 0.6);
      e.w = 46; e.h = 42;
      e.shootCooldown = 2.4;
      e.y = GROUND_Y - e.h;
      break;
    case 'sniper':
      e.hp = Math.round(18 * hpScale);
      e.maxHp = e.hp;
      e.color = '#fff62e';
      e.speed = 58 * speedScale;
      e.dmg = 12 + Math.floor((wave - 1) * 0.4);
      e.w = 30; e.h = 30;
      e.y = GROUND_Y - e.h;
      e.shootCooldown = 1.8 * attackScale;
      e.projectileSpeed = 380 * clamp(1 + (wave - 1) * 0.02, 1, 1.5);
      e.preferredDist = 280;
      break;
  }
  return e;
}

// ---------- Safe Enemy Spawning ----------
function trySpawnEnemy(){
  if (world.enemies.length >= MAX_ENEMIES) return false;

  let types;
  if (world.wave <= 1) types = ['grunt'];
  else if (world.wave <= 3) types = ['grunt', 'grunt', 'grunt', 'flyer', 'sniper'];
  else if (world.wave <= 5) types = ['grunt', 'grunt', 'flyer', 'sniper', 'tank'];
  else types = ['grunt', 'flyer', 'tank', 'sniper', 'flyer', 'sniper', 'tank'];

  const type = choice(types);
  const fromLeft = Math.random() < 0.5;

  for (let attempt = 0; attempt < 8; attempt++){
    const baseX = fromLeft ? rand(-50, 20) : rand(BASE_WIDTH - 20, BASE_WIDTH + 50);
    const baseY = (type === 'flyer') ? rand(100, 320) : (GROUND_Y - 32);

    if (world.player){
      const px = world.player.x + world.player.w/2;
      const py = world.player.y + world.player.h/2;
      if (dist2(baseX, baseY, px, py) < MIN_SPAWN_DISTANCE * MIN_SPAWN_DISTANCE){
        continue;
      }
    }

    const enemy = createEnemy(type, fromLeft);
    enemy.x = baseX - enemy.w / 2;
    enemy.y = baseY;
    world.enemies.push(enemy);
    return true;
  }
  return false;
}

// ---------- Pickups ----------
function spawnPickup(x, y, forced){
  const kind = forced || (Math.random() < 0.5 ? 'coin' : (Math.random() < 0.5 ? 'heart' : 'crate'));
  world.pickups.push({
    x, y, w: 24, h: 24,
    kind, vy: -160,
    born: world.time,
    bob: rand(0, Math.PI * 2),
    collected: false,
  });
}

// ---------- Mobile Auto-Aim Assist ----------
function getAssistedAimAngle(playerCx, playerCy, baseAngle){
  let bestEnemy = null;
  let bestScore = -Infinity;

  for (const e of world.enemies){
    if (e.dead) continue;
    const ecx = e.x + e.w / 2;
    const ecy = e.y + e.h / 2;
    const dx = ecx - playerCx;
    const dy = ecy - playerCy;
    const d = Math.hypot(dx, dy);
    if (d > 460 || d < 20) continue;

    const angleTo = Math.atan2(dy, dx);
    let diff = angleTo - baseAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const absDiff = Math.abs(diff);
    if (absDiff < 0.65) { // ~37° cone
      const score = (1 - absDiff / 0.65) * 2 + (1 - d / 460);
      if (score > bestScore){
        bestScore = score;
        bestEnemy = { angle: angleTo, diff };
      }
    }
  }

  if (bestEnemy){
    return baseAngle + bestEnemy.diff * 0.32;
  }
  return baseAngle;
}

// ---------- Shooting System ----------
function firePlayerBullet(){
  const p = world.player;
  if (!p) return;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;

  const hiccupping = world.realTime < p.hiccupUntil;
  const wobbleRange = hiccupping ? 0.35 : 0.12;
  p.aimWobble = p.aimWobble * 0.65 + rand(-wobbleRange, wobbleRange) * 0.35;

  let baseAngle;
  if (world.input.hasAimTouch){
    baseAngle = world.input.aimAngle;
  } else {
    baseAngle = Math.atan2(world.input.aimY - cy, world.input.aimX - cx);
  }

  let finalAngle = getAssistedAimAngle(cx, cy, baseAngle) + p.aimWobble;

  const speed = 700;
  const b = getBullet();
  b.x = cx; b.y = cy;
  b.vx = Math.cos(finalAngle) * speed;
  b.vy = Math.sin(finalAngle) * speed;
  b.life = 1.35;
  b.maxLife = 1.35;
  b.r = 5.5;
  b.color = choice(['#2efff2', '#fff62e', '#ff2ec4']);
  b.fromPlayer = true;
  b.damage = 10;
  world.bullets.push(b);

  sfxShoot();
  spawnParticles(cx, cy, 3, ['#fff', '#2efff2'], 160, 0.2);

  // Accidental 6% Extra Shot Mechanic (Enhanced with Visuals & Audio)
  if (Math.random() < 0.06){
    const extraAng = finalAngle + rand(-0.25, 0.25);
    const b2 = getBullet();
    b2.x = cx; b2.y = cy;
    b2.vx = Math.cos(extraAng) * speed * 1.05;
    b2.vy = Math.sin(extraAng) * speed * 1.05;
    b2.life = 1.35;
    b2.maxLife = 1.35;
    b2.r = 6.5;
    b2.color = '#fff62e';
    b2.fromPlayer = true;
    b2.damage = 12;
    b2.isBonus = true;
    world.bullets.push(b2);

    sfxBonusShoot();
    floatText(cx, cy - 15, "+1 EXTRA SHOT! (6%)", '#fff62e');
    spawnParticles(cx, cy, 8, ['#fff62e', '#ff9900'], 220, 0.4);
  }
}

function fireEnemyBullet(e, targetX, targetY){
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const speed = e.projectileSpeed || 360;
  const ang = Math.atan2(targetY - cy, targetX - cx);

  const b = getBullet();
  b.x = cx; b.y = cy;
  b.vx = Math.cos(ang) * speed;
  b.vy = Math.sin(ang) * speed;
  b.life = 2.6;
  b.maxLife = 2.6;
  b.r = 5.5;
  b.color = '#ff6a2e';
  b.fromPlayer = false;
  b.damage = 7;
  world.bullets.push(b);

  beep(300, 0.08, 'sawtooth', 0.05);
}

// ---------- Damage System ----------
function damagePlayer(amount, source){
  const p = world.player;
  if (!p || world.state !== "PLAYING" || p.invuln > 0) return;

  p.hp -= amount;
  p.invuln = INVULN_DURATION;
  triggerScreenShake(12, 12);
  sfxHit();
  spawnParticles(p.x + p.w/2, p.y + p.h/2, 12, ['#ff2ec4', '#ff6a2e'], 250, 0.5);

  if (p.hp <= 0){
    p.hp = 0;
    triggerGameOver();
  }
  updateHUD();
}

// ---------- Game State Control ----------
function resetGame(){
  world.score = 0;
  world.kills = 0;
  world.survivalTime = 0;
  world.wave = 1;
  world.chaos = 0;
  world.chaosTriggered = false;
  world.time = 0;
  world.realTime = 0;
  world.baseGravity = DEFAULT_GRAVITY;
  world.gravityDir = 1;
  world.bgHue = 260;
  world.killsSincePickup = 0;
  camera.shakeX = 0;
  camera.shakeY = 0;
  camera.rotation = 0;

  for (const b of world.bullets) releaseBullet(b);
  world.bullets.length = 0;
  for (const p of world.particles) releaseParticle(p);
  world.particles.length = 0;
  world.enemies.length = 0;
  world.pickups.length = 0;
  world.floaters.length = 0;
  world.activeEffects = [];

  recomputeWorldModifiers();
  world.player = createPlayer();
  world.enemiesToSpawn = 5 + world.wave * 2;
  world.spawnCooldown = 0.8;
  world._nextHiccupTime = 10;
}

function startGame(){
  hideAllOverlays();
  resetGame();
  world.state = "PLAYING";
  initAudio();
  playBgMusic();
  updateHUD();
  showWaveBanner(world.wave, world.enemiesToSpawn);
}

function pauseGame(){
  if (world.state === "PLAYING"){
    world.state = "PAUSED";
    pauseBgMusic();
    showOverlay('pause-screen');
    sfxBtn();
  }
}

function resumeGame(){
  if (world.state === "PAUSED"){
    world.state = "PLAYING";
    playBgMusic();
    hideAllOverlays();
    sfxBtn();
  }
}

function triggerGameOver(){
  if (world.state === "GAME_OVER") return;
  world.state = "GAME_OVER";
  pauseBgMusic();
  sfxDeath();

  const finalStats = {
    score: world.score,
    wave: world.wave,
    kills: world.kills,
    time: formatRunTime(world.survivalTime),
  };

  if (world.player){
    spawnParticles(world.player.x + world.player.w/2, world.player.y + world.player.h/2,
      45, ['#ff2ec4','#ff6a2e','#fff62e'], 380, 1.4);
  }

  setTimeout(() => {
    const finalScore = document.getElementById('final-score');
    const finalWave = document.getElementById('final-wave');
    const finalKills = document.getElementById('final-kills');
    const finalTime = document.getElementById('final-time');
    const flavor = document.getElementById('game-over-flavor');
    if (finalScore) finalScore.textContent = finalStats.score;
    if (finalWave) finalWave.textContent = finalStats.wave;
    if (finalKills) finalKills.textContent = finalStats.kills;
    if (finalTime) finalTime.textContent = finalStats.time;
    if (flavor) {
      flavor.textContent = choice([
        "You were overwhelmed by the forces of arbitrary chaos.",
        "A gravity flip finally caught up with you.",
        "Turns out giant mode has consequences on small screens.",
        "Reality briefly won this round.",
        "The mystery crates were not in a cooperative mood."
      ]);
    }
    showOverlay('game-over-screen');
  }, 800);
}

// ---------- UI Overlay Helpers ----------
const overlayContainer = document.getElementById('overlay-container');
const allModals = document.querySelectorAll('.modal-card');

function showOverlay(id){
  if (!overlayContainer) return;
  overlayContainer.classList.remove('hidden');
  overlayContainer.dataset.screen = id;
  allModals.forEach(m => m.classList.add('modal-hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('modal-hidden');
}

function hideAllOverlays(){
  if (!overlayContainer) return;
  overlayContainer.classList.add('hidden');
  delete overlayContainer.dataset.screen;
  allModals.forEach(m => m.classList.add('modal-hidden'));
}

// ---------- Update Loops ----------
function updateEffects(dt, realDt){
  for (let i = world.activeEffects.length - 1; i >= 0; i--){
    const e = world.activeEffects[i];
    switch(e.type){
      case "meteorShower":
        e.data.spawnTimer -= realDt;
        if (e.data.spawnTimer <= 0 && e.data.meteorsLeft > 0){
          spawnMeteor();
          e.data.meteorsLeft--;
          e.data.spawnTimer = 0.16;
        }
        break;
      case "hueCycle":
        world.bgHue += 35 * (realDt / 0.08);
        break;
      case "crateRain":
        e.data.spawnTimer -= realDt;
        if (e.data.spawnTimer <= 0 && e.data.cratesLeft > 0){
          spawnPickup(rand(80, BASE_WIDTH - 80), -20, 'crate');
          e.data.cratesLeft--;
          e.data.spawnTimer = 0.22;
        }
        break;
    }

    e.remaining -= realDt;
    if (e.remaining <= 0){
      world.activeEffects.splice(i, 1);
    }
  }
  recomputeWorldModifiers();
}

function spawnMeteor(){
  const p = getParticle();
  p.meteor = true;
  p.x = rand(60, BASE_WIDTH - 60);
  p.y = -30;
  p.targetY = (world.gravityDir === 1) ? GROUND_Y : CEIL_Y;
  p.vx = rand(-50, 50);
  p.vy = rand(420, 650);
  p.life = 5;
  p.maxLife = 5;
  p.color = '#ff6a2e';
  p.size = rand(7, 14);
  world.particles.push(p);
}

function updatePlayer(dt){
  const p = world.player;
  if (!p) return;

  const touchControlsLayer = document.getElementById('touch-controls');

  // Hiccup Scheduling (Wall Clock Real-time)
  if (!world._nextHiccupTime){
    world._nextHiccupTime = world.realTime + rand(8, 16);
  }
  if (world.realTime >= world._nextHiccupTime){
    world._nextHiccupTime = world.realTime + rand(9, 18);
    const duration = rand(0.5, 0.95);
    p.hiccupUntil = world.realTime + duration;
    triggerScreenShake(14, 14);
    floatText(p.x + p.w/2, p.y - 12, "STUMBLE!", '#fff62e');
    sfxHiccup();

    // Glitch effect on canvas and touch controls
    if (settings.flashing){
      canvas.classList.add('hiccup-glitch');
      if (touchControlsLayer) touchControlsLayer.classList.add('hiccup-active');
      setTimeout(() => {
        canvas.classList.remove('hiccup-glitch');
        if (touchControlsLayer) touchControlsLayer.classList.remove('hiccup-active');
      }, duration * 1000);
    }
  }

  // Direction handling (with hiccup inversion)
  let moveDir = world.input.moveX;
  const hiccupping = world.realTime < p.hiccupUntil;
  if (hiccupping || p.controlInverted){
    moveDir = -moveDir;
  }

  // Drunk drift & stumble sine wave
  p.drift += rand(-60, 60) * dt;
  p.drift *= Math.pow(0.94, dt * 60);
  p.drift = clamp(p.drift, -85, 85);
  const sineStumble = Math.sin(world.time * 5.2) * 32;

  // Wind Storm Chaos Effect
  let windVx = 0;
  for (const e of world.activeEffects){
    if (e.type === "windStorm") windVx += e.data.dir * e.data.strength;
  }

  const speedScale = p.scaleMult > 1 ? 0.75 : (p.scaleMult < 1 ? 1.3 : 1);
  const maxSpeed = p.baseSpeed * p.speedMult * speedScale;
  const baseVx = moveDir * maxSpeed;
  const stumble = (moveDir !== 0) ? (sineStumble + p.drift) : (sineStumble * 0.35 + p.drift * 0.25);
  p.vx = baseVx + stumble + windVx;

  if (moveDir !== 0){
    p.facing = moveDir > 0 ? 1 : -1;
  }

  // Gravity
  const g = world.gravity * world.gravityDir * (p.scaleMult > 1 ? 1.3 : 1);
  p.vy += g * dt;

  // Jump with Coyote Time & Buffer
  if (world.input.jumpPressed){
    p.jumpBuffer = JUMP_BUFFER;
  }
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

  if (p.onGround){
    p.coyoteTimer = COYOTE_TIME;
  } else {
    p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
  }

  const canGroundJump = p.coyoteTimer > 0;
  const canAirJump = !p.onGround && p.coyoteTimer <= 0 && p.jumpsUsed < p.effectiveMaxJumps;

  if (p.jumpBuffer > 0 && (canGroundJump || canAirJump)){
    p.jumpBuffer = 0;
    const jumpPower = rand(9.8, 14.2) * 60;
    p.vy = (world.gravityDir === 1 ? -1 : 1) * jumpPower;
    if (canGroundJump){
      p.jumpsUsed = 1;
    } else {
      p.jumpsUsed++;
    }
    p.coyoteTimer = 0;
    p.onGround = false;
    sfxJump();
    spawnParticles(p.x + p.w/2, (world.gravityDir === 1 ? p.y + p.h : p.y), 8, ['#2efff2', '#fff'], 190, 0.35);
  }

  // Update Jump Pips UI
  const pip1 = document.getElementById('pip-1');
  const pip2 = document.getElementById('pip-2');
  const pip3 = document.getElementById('pip-3');
  const remainingJumps = Math.max(0, p.effectiveMaxJumps - p.jumpsUsed);
  if (pip1) pip1.classList.toggle('pip-active', remainingJumps >= 1);
  if (pip2) pip2.classList.toggle('pip-active', remainingJumps >= 2);
  if (pip3) pip3.classList.toggle('pip-active', remainingJumps >= 3);

  // Integrate position
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.x = clamp(p.x, 0, BASE_WIDTH - p.w);

  // Floor & Ceiling Collision
  const groundYNormal = (world.gravityDir === 1) ? (GROUND_Y - p.h) : CEIL_Y;
  const ceilYNormal = (world.gravityDir === 1) ? CEIL_Y : (GROUND_Y - p.h);
  const fallingDown = (world.gravityDir === 1) ? (p.vy >= 0) : (p.vy <= 0);

  if (fallingDown){
    const reachedFloor = (world.gravityDir === 1) ? (p.y >= groundYNormal) : (p.y <= groundYNormal);
    if (reachedFloor){
      p.y = groundYNormal;
      p.vy = 0;
      if (!p.onGround) p.jumpsUsed = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
  } else {
    const hitCeil = (world.gravityDir === 1) ? (p.y <= ceilYNormal) : (p.y >= ceilYNormal);
    if (hitCeil){
      p.y = ceilYNormal;
      p.vy = 0;
    }
    p.onGround = false;
  }

  // Continuous Shooting
  if (p.fireCooldown > 0){
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  }
  const interval = p.baseFireInterval / p.fireRateMult;
  if ((world.input.shootHeld || world.input.shootPressed) && p.fireCooldown <= 0){
    firePlayerBullet();
    p.fireCooldown = interval;
    world.input.shootPressed = false;
  }

  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

  // Motion Trail
  p.trail.push({ x: p.x + p.w/2, y: p.y + p.h/2 });
  if (p.trail.length > 8) p.trail.shift();
}

function updateEnemies(dt){
  const p = world.player;
  if (!p) return;

  for (const e of world.enemies){
    e.wobble += dt * 10;
    e.aiTimer += dt;
    if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
    if (e.contactCooldown > 0) e.contactCooldown = Math.max(0, e.contactCooldown - dt);
    if (e.shootCooldown > 0) e.shootCooldown = Math.max(0, e.shootCooldown - dt);

    const dx = (p.x + p.w/2) - (e.x + e.w/2);
    const dy = (p.y + p.h/2) - (e.y + e.h/2);
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;

    switch(e.type){
      case 'grunt':
        e.x += nx * e.speed * dt;
        e.y = (world.gravityDir === 1) ? (GROUND_Y - e.h) : CEIL_Y;
        break;

      case 'flyer':
        e.strafePhase += dt * 3.2;
        const strafeX = -ny * Math.sin(e.strafePhase) * 0.6;
        const strafeY = nx * Math.sin(e.strafePhase) * 0.6;
        e.x += (nx * 0.75 + strafeX) * e.speed * dt;
        e.y += (ny * 0.45 + strafeY) * e.speed * dt + Math.sin(e.wobble) * 20 * dt;
        e.y = clamp(e.y, CEIL_Y, GROUND_Y - e.h);
        break;

      case 'tank':
        e.x += nx * e.speed * dt;
        e.y = (world.gravityDir === 1) ? (GROUND_Y - e.h) : CEIL_Y;
        // Tank Attack Telegraph when close to player
        if (d < 170){
          e.attackTelegraph = Math.min(1, e.attackTelegraph + dt * 2.5);
        } else {
          e.attackTelegraph = Math.max(0, e.attackTelegraph - dt * 2);
        }
        break;

      case 'sniper': {
        const pd = d - e.preferredDist;
        let moveFactor = (pd < -35) ? -1 : (pd > 35 ? 0.5 : 0);
        e.x += nx * e.speed * moveFactor * dt;
        e.x += -ny * Math.sin(e.aiTimer * 1.5) * e.speed * 0.3 * dt;
        e.y = (world.gravityDir === 1) ? (GROUND_Y - e.h) : CEIL_Y;

        // Sniper Aim Telegraph (intensifies right before shooting)
        if (e.shootCooldown < 0.8 && d < 540 && d > 60){
          e.attackTelegraph = clamp(1 - (e.shootCooldown / 0.8), 0, 1);
        } else {
          e.attackTelegraph = 0;
        }

        if (e.shootCooldown <= 0 && d < 540 && d > 60){
          fireEnemyBullet(e, p.x + p.w/2, p.y + p.h/2);
          e.shootCooldown = rand(1.1, 1.9) * clamp(1 - (world.wave - 1) * 0.03, 0.45, 1.1);
        }
        break;
      }
    }

    // Contact Damage
    if (e.contactCooldown <= 0 && rectRectCollision(p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h)){
      damagePlayer(e.dmg, e.type + "_contact");
      e.contactCooldown = CONTACT_COOLDOWN;
    }
  }

  // Pairwise Enemy Separation
  const SEP_R = 40;
  const n = world.enemies.length;
  for (let i = 0; i < n; i++){
    const a = world.enemies[i];
    for (let j = i + 1; j < n; j++){
      const b = world.enemies[j];
      const ddx = (a.x + a.w/2) - (b.x + b.w/2);
      const ddy = (a.y + a.h/2) - (b.y + b.h/2);
      const d2 = ddx*ddx + ddy*ddy;
      if (d2 < SEP_R*SEP_R && d2 > 0.01){
        const dd = Math.sqrt(d2);
        const push = (SEP_R - dd) / dd * 45 * dt;
        a.x += ddx * push; a.y += ddy * push;
        b.x -= ddx * push; b.y -= ddy * push;
      }
    }
  }
}

function updateBullets(dt){
  const p = world.player;
  const MAX_STEP = 0.016;

  for (let i = world.bullets.length - 1; i >= 0; i--){
    const b = world.bullets[i];
    let rem = dt;
    let hit = false;

    while (rem > 0 && !hit){
      const step = Math.min(rem, MAX_STEP);
      rem -= step;

      if (b.fromPlayer){
        for (const e of world.enemies){
          if (e.dead) continue;
          const t = sweptBulletCollision(b, step, e);
          if (t >= 0 && t <= 1){
            b.x += b.vx * step * t;
            b.y += b.vy * step * t;
            e.hp -= b.damage;
            e.hitFlash = 0.12;
            spawnParticles(b.x, b.y, 6, [e.color, '#fff'], 190, 0.3);
            if (e.hp <= 0) killEnemy(e);
            hit = true;
            break;
          }
        }
      } else {
        if (p && circleRectCollision(b.x, b.y, b.r, p.x, p.y, p.w, p.h)){
          damagePlayer(b.damage, "enemy_bullet");
          spawnParticles(b.x, b.y, 6, ['#ff6a2e', '#ff2ec4'], 190, 0.3);
          hit = true;
        }
      }
      if (hit) break;
      b.x += b.vx * step;
      b.y += b.vy * step;
    }

    b.life -= dt;
    if (hit || b.life <= 0 || b.x < -60 || b.x > BASE_WIDTH + 60 || b.y < -80 || b.y > BASE_HEIGHT + 80){
      releaseBullet(b);
      world.bullets.splice(i, 1);
    }
  }
}

function killEnemy(e){
  if (e.dead) return;
  e.dead = true;
  world.kills++;
  world.score += (e.type === 'tank') ? 35 : (e.type === 'sniper' ? 25 : 15);
  world.chaos = clamp(world.chaos + 8.5, 0, 100);
  world.killsSincePickup++;

  spawnParticles(e.x + e.w/2, e.y + e.h/2, 16, [e.color, '#fff62e', '#fff'], 260, 0.65);

  let dropChance = 0.35 + Math.min(0.55, (world.killsSincePickup - 1) * 0.025);
  if (Math.random() < dropChance){
    spawnPickup(e.x + e.w/2, e.y + e.h/2);
    world.killsSincePickup = 0;
  }
  updateHUD();
}

function updatePickups(dt){
  const p = world.player;
  if (!p) return;

  for (let i = world.pickups.length - 1; i >= 0; i--){
    const pu = world.pickups[i];
    pu.bob += dt * 8;

    if (pu.vy !== 0){
      pu.y += pu.vy * dt;
      const targetY = (world.gravityDir === 1) ? (GROUND_Y - 14) : (CEIL_Y + 14);
      if ((world.gravityDir === 1 && pu.y >= targetY) || (world.gravityDir === -1 && pu.y <= targetY)){
        pu.y = targetY;
        pu.vy = 0;
      } else {
        pu.vy += world.gravity * 0.5 * dt * world.gravityDir;
      }
    }

    if (pu.collected) continue;
    if (rectRectCollision(p.x, p.y, p.w, p.h, pu.x - pu.w/2, pu.y - pu.h/2, pu.w, pu.h)){
      pu.collected = true;
      sfxPickup();
      if (pu.kind === 'coin'){
        world.score += 15;
        floatText(pu.x, pu.y, '+15', '#fff62e');
      } else if (pu.kind === 'heart'){
        p.hp = clamp(p.hp + 25, 0, p.maxHp);
        floatText(pu.x, pu.y, '+25 HP', '#2eff6a');
      } else if (pu.kind === 'crate'){
        world.chaos = clamp(world.chaos + 35, 0, 100);
        floatText(pu.x, pu.y, 'MYSTERY CRATE! +35%', '#a12eff');
        spawnParticles(pu.x, pu.y, 14, ['#a12eff', '#fff'], 240, 0.5);
      }
      updateHUD();
      world.pickups.splice(i, 1);
    }
  }
}

function updateParticles(dt){
  const p = world.player;
  for (let i = world.particles.length - 1; i >= 0; i--){
    const part = world.particles[i];
    part.x += part.vx * dt;
    part.y += part.vy * dt;

    if (part.meteor){
      part.vy += world.gravity * 0.7 * dt;
      const impacted = (world.gravityDir === 1) ? (part.y >= GROUND_Y) : (part.y <= CEIL_Y);
      if (impacted){
        const landY = (world.gravityDir === 1) ? GROUND_Y : CEIL_Y;
        spawnParticles(part.x, landY, 10, ['#ff6a2e', '#fff62e'], 260, 0.45);
        if (p && circleRectCollision(part.x, part.y, part.size * 2.8, p.x, p.y, p.w, p.h)){
          damagePlayer(16, "meteor");
        }
        releaseParticle(part);
        world.particles.splice(i, 1);
        continue;
      }
    } else {
      part.vy += world.gravity * 0.12 * dt * world.gravityDir;
    }

    part.life -= dt;
    if (part.life <= 0 || part.x < -80 || part.x > BASE_WIDTH + 80 || part.y < -150 || part.y > BASE_HEIGHT + 150){
      releaseParticle(part);
      world.particles.splice(i, 1);
    }
  }

  for (let i = world.floaters.length - 1; i >= 0; i--){
    const f = world.floaters[i];
    f.y += f.vy * dt;
    f.life -= dt;
    if (f.life <= 0) world.floaters.splice(i, 1);
  }
}

function updateWaves(dt){
  if (world.enemiesToSpawn > 0){
    world.spawnCooldown -= dt;
    if (world.spawnCooldown <= 0){
      if (trySpawnEnemy()) world.enemiesToSpawn--;
      world.spawnCooldown = rand(0.5, 0.9) * clamp(1 - (world.wave - 1) * 0.04, 0.45, 1.1);
    }
  } else if (world.enemies.length === 0){
    world.wave++;
    world.enemiesToSpawn = 5 + world.wave * 2;
    world.spawnCooldown = 1.2;
    showWaveBanner(world.wave, world.enemiesToSpawn);
    if (world.wave % 3 === 0) spawnPickup(BASE_WIDTH / 2, -20, 'crate');
  }
}

function updateChaos(dt){
  world.chaos = clamp(world.chaos + dt * 0.7, 0, 100);
  if (world.chaos >= 100){
    world.chaos = 0;
    triggerChaosEvent();
  }
  updateHUD();
}

function updateCamera(dt){
  const p = world.player;
  if (!p) return;

  if (isPortrait){
    const halfViewW = (screenW / camera.zoom) / 2;
    const minX = halfViewW;
    const maxX = BASE_WIDTH - halfViewW;
    camera.targetX = clamp(p.x + p.w / 2, Math.min(minX, maxX), Math.max(minX, maxX));
    camera.targetY = BASE_HEIGHT / 2 + 10;
  } else {
    camera.targetX = lerp(BASE_WIDTH / 2, p.x + p.w / 2, 0.35);
    camera.targetY = BASE_HEIGHT / 2;
  }

  camera.x = lerp(camera.x, camera.targetX, 0.12);
  camera.y = lerp(camera.y, camera.targetY, 0.12);
  camera.zoom = lerp(camera.zoom, camera.targetZoom, 0.1);
  camera.rotation = lerp(camera.rotation, camera.targetRotation, 0.08);

  const shakeDecay = Math.pow(0.92, dt * 60);
  camera.shakeX *= shakeDecay;
  camera.shakeY *= shakeDecay;
  if (Math.abs(camera.shakeX) < 0.05) camera.shakeX = 0;
  if (Math.abs(camera.shakeY) < 0.05) camera.shakeY = 0;
}

function cleanupDead(){
  for (let i = world.enemies.length - 1; i >= 0; i--){
    if (world.enemies[i].dead) world.enemies.splice(i, 1);
  }
}

// ---------- HUD Refresh ----------
const effectDisplayNames = {
  gravityFlip: 'GRAVITY FLIP', giantMode: 'GIANT MODE', tinyMode: 'TINY MODE',
  slowMo: 'SLOW-MO', turbo: 'TURBO', meteorShower: 'METEOR SHOWER',
  reverseCtrl: 'REVERSED CONTROLS', windStorm: 'WIND STORM', colorInvert: 'COLOR INVERSION',
  tripleJump: 'TRIPLE JUMP', rapidFire: 'RAPID FIRE', crateRain: 'CRATE RAIN', hueCycle: 'HUE SHIFT',
};

function setUIText(element, value){
  if (!element) return;
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function updateHUD(){
  const p = world.player;
  const scoreEl = document.getElementById('score');
  const waveEl = document.getElementById('wave');
  const hpText = document.getElementById('hp-text');
  const hpFill = document.getElementById('healthfill');
  const chaosFill = document.getElementById('chaosfill');
  const chaosPct = document.getElementById('chaos-pct');
  const chaosBar = document.getElementById('chaosbar');
  const enemyCount = document.getElementById('enemy-count');
  const killCount = document.getElementById('kill-count');
  const runClock = document.getElementById('run-clock');
  const activeEffect = document.getElementById('active-effect');
  const activeEffectName = document.getElementById('active-effect-name');
  const activeEffectTime = document.getElementById('active-effect-time');
  const healthBar = document.getElementById('healthbar');

  setUIText(scoreEl, world.score);
  setUIText(waveEl, world.wave);
  setUIText(enemyCount, world.enemies.length + world.enemiesToSpawn);
  setUIText(killCount, world.kills);
  setUIText(runClock, formatRunTime(world.survivalTime));

  if (p){
    const hp = Math.max(0, Math.round(p.hp));
    setUIText(hpText, `${hp}/${p.maxHp}`);
    if (hpFill && hpFill.style.width !== `${(hp / p.maxHp) * 100}%`) hpFill.style.width = `${(hp / p.maxHp) * 100}%`;
    if (hpFill) hpFill.classList.toggle('health-danger', hp / p.maxHp <= 0.3);
    if (healthBar && healthBar.getAttribute('aria-valuenow') !== String(hp)) healthBar.setAttribute('aria-valuenow', hp);
  }
  const cpct = Math.min(100, Math.round(world.chaos));
  if (chaosFill && chaosFill.style.width !== `${cpct}%`) chaosFill.style.width = `${cpct}%`;
  setUIText(chaosPct, `${cpct}%`);
  if (chaosBar) chaosBar.classList.toggle('chaos-ready', cpct >= 90);
  if (chaosBar && chaosBar.getAttribute('aria-valuenow') !== String(cpct)) chaosBar.setAttribute('aria-valuenow', cpct);

  let shownEffect = null;
  for (const effect of world.activeEffects){
    if (!shownEffect || effect.remaining > shownEffect.remaining) shownEffect = effect;
  }
  if (activeEffect) activeEffect.hidden = !shownEffect;
  if (shownEffect){
    setUIText(activeEffectName, effectDisplayNames[shownEffect.type] || shownEffect.type.toUpperCase());
    setUIText(activeEffectTime, `${Math.max(0, shownEffect.remaining).toFixed(1)}s`);
  }
}

function formatRunTime(seconds){
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const remainder = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

// ==========================================================================
//   RENDERING PIPELINE
// ==========================================================================
function render(){
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0014';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.scale(dpr, dpr);

  const cx = screenW / 2;
  const cy = screenH / 2;
  ctx.translate(cx, cy);

  if (settings.shake && (camera.shakeX > 0 || camera.shakeY > 0)){
    ctx.translate(
      rand(-camera.shakeX, camera.shakeX),
      rand(-camera.shakeY, camera.shakeY)
    );
  }

  ctx.scale(camera.zoom, camera.zoom);
  ctx.rotate(camera.rotation);
  ctx.translate(-camera.x, -camera.y);

  // 1. World Background & Grid
  drawWorldBackground();

  // 2. Attack Telegraphs
  drawAttackTelegraphs();

  // 3. Pickups
  drawPickups();

  // 4. Enemies
  for (const e of world.enemies) drawEnemy(e);

  // 5. Bullets
  drawBullets();

  // 6. Particles
  drawParticles();

  // 7. Player
  drawPlayer();

  // 8. Floating Combat Text
  drawFloaters();

  // 9. Invert Colors
  if (world.invertColors && settings.flashing){
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    ctx.restore();
  }

  ctx.restore();

  // 10. Screen-Space UI
  renderScreenSpaceUI();
}

function drawWorldBackground(){
  ctx.fillStyle = `hsl(${world.bgHue % 360}, 55%, 7%)`;
  ctx.fillRect(-120, -120, BASE_WIDTH + 240, BASE_HEIGHT + 240);

  // Stars
  ctx.fillStyle = '#fff';
  for (const s of world.stars){
    s.y += s.s * 0.016;
    if (s.y > BASE_HEIGHT + 80){ s.y = -80; s.x = rand(0, BASE_WIDTH); }
    ctx.globalAlpha = s.alpha * 0.65;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Vaporwave Grid
  ctx.strokeStyle = `hsla(${(world.bgHue + 140) % 360}, 95%, 60%, 0.22)`;
  ctx.lineWidth = 1.5;

  for (let i = 0; i <= 10; i++){
    const y = GROUND_Y + i * 16;
    ctx.beginPath();
    ctx.moveTo(-120, y);
    ctx.lineTo(BASE_WIDTH + 120, y);
    ctx.stroke();
  }

  const centerGridX = BASE_WIDTH / 2;
  for (let i = -16; i <= 16; i++){
    ctx.beginPath();
    ctx.moveTo(centerGridX + i * 44, GROUND_Y);
    ctx.lineTo(centerGridX + i * 170, BASE_HEIGHT + 140);
    ctx.stroke();
  }

  // Floor
  const floorGrad = ctx.createLinearGradient(0, GROUND_Y, 0, BASE_HEIGHT);
  floorGrad.addColorStop(0, `hsl(${(world.bgHue + 210) % 360}, 80%, 22%)`);
  floorGrad.addColorStop(1, '#05000c');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, GROUND_Y, BASE_WIDTH, BASE_HEIGHT - GROUND_Y);

  // Neon Floor Glowing Line
  ctx.strokeStyle = `hsl(${(world.bgHue + 180) % 360}, 100%, 65%)`;
  ctx.lineWidth = 3;
  ctx.shadowColor = `hsl(${(world.bgHue + 180) % 360}, 100%, 65%)`;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(BASE_WIDTH, GROUND_Y);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Ceiling for Gravity Flip
  if (world.gravityDir === -1){
    ctx.fillStyle = `hsl(${(world.bgHue + 260) % 360}, 80%, 18%)`;
    ctx.fillRect(0, 0, BASE_WIDTH, CEIL_Y);
    ctx.strokeStyle = '#2efff2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, CEIL_Y);
    ctx.lineTo(BASE_WIDTH, CEIL_Y);
    ctx.stroke();
  }
}

// ---------- High-Contrast Attack Telegraphs ----------
function drawAttackTelegraphs(){
  const p = world.player;

  // 1. Meteor Ground Warning Marker
  for (const part of world.particles){
    if (part.meteor){
      const groundImpactY = (world.gravityDir === 1) ? GROUND_Y : CEIL_Y;
      const progress = clamp(part.y / groundImpactY, 0, 1);
      const ringRadius = (1 - progress) * 36 + 10;

      ctx.save();
      ctx.strokeStyle = '#ff6a2e';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ff6a2e';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(part.x, groundImpactY, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#fff62e';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', part.x, groundImpactY - 8);
      ctx.restore();
    }
  }

  // 2. Sniper Red Aim Laser Telegraph
  for (const e of world.enemies){
    if (e.dead) continue;

    if (e.type === 'sniper' && e.attackTelegraph > 0 && p){
      const sx = e.x + e.w / 2;
      const sy = e.y + e.h / 2;
      const px = p.x + p.w / 2;
      const py = p.y + p.h / 2;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 46, 70, ${0.3 + e.attackTelegraph * 0.7})`;
      ctx.lineWidth = 1 + e.attackTelegraph * 2.5;
      ctx.shadowColor = '#ff2e46';
      ctx.shadowBlur = 10 * e.attackTelegraph;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Tank Warning Ring Telegraph
    if (e.type === 'tank' && e.attackTelegraph > 0){
      ctx.save();
      const ecx = e.x + e.w / 2;
      const ecy = e.y + e.h / 2;
      ctx.strokeStyle = `rgba(255, 106, 46, ${0.4 + e.attackTelegraph * 0.6})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ff6a2e';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(ecx, ecy, 28 + e.attackTelegraph * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawPlayer(){
  const p = world.player;
  if (!p) return;
  ctx.save();

  for (let i = 0; i < p.trail.length; i++){
    const t = p.trail[i];
    ctx.globalAlpha = (i / p.trail.length) * 0.35;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  ctx.translate(cx, cy);
  ctx.scale(p.scaleMult * p.facing, p.scaleMult);

  if (p.invuln > 0 && Math.floor(world.time * 18) % 2 === 0){
    ctx.globalAlpha = 0.35;
  }

  // Player Silhouette Body
  ctx.fillStyle = p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 14;
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);

  // Visor
  ctx.fillStyle = '#0a0014';
  ctx.fillRect(-p.w / 2 + 6, -p.h / 2 + 8, p.w - 12, 10);
  ctx.fillStyle = '#fff62e';
  ctx.fillRect(2, -p.h / 2 + 10, 8, 6);

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawEnemy(e){
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  ctx.fillStyle = e.hitFlash > 0 ? '#fff' : e.color;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = 10;

  if (e.type === 'flyer'){
    ctx.beginPath();
    ctx.moveTo(-e.w/2, 0);
    ctx.lineTo(0, -e.h/2);
    ctx.lineTo(e.w/2, 0);
    ctx.lineTo(0, e.h/2);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === 'tank'){
    // Tank core charge glow
    if (e.attackTelegraph > 0){
      ctx.shadowColor = '#ff6a2e';
      ctx.shadowBlur = 18;
    }
    ctx.fillRect(-e.w/2, -e.h/2, e.w, e.h);
    ctx.fillStyle = '#000a';
    ctx.fillRect(-e.w/2 + 6, -e.h/2 + 6, e.w - 12, e.h - 18);
  } else if (e.type === 'sniper'){
    ctx.beginPath();
    ctx.moveTo(0, -e.h/2);
    ctx.lineTo(e.w/2, 0);
    ctx.lineTo(0, e.h/2);
    ctx.lineTo(-e.w/2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, e.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mini Health Bar Above Enemy
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(-e.w / 2, -e.h / 2 - 10, e.w, 4);
  ctx.fillStyle = '#2eff6a';
  ctx.fillRect(-e.w / 2, -e.h / 2 - 10, e.w * clamp(e.hp / e.maxHp, 0, 1), 4);

  ctx.restore();
}

function drawBullets(){
  for (const b of world.bullets){
    ctx.save();
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = b.isBonus ? 16 : 12;

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.r;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
    ctx.stroke();

    ctx.restore();
  }
}

function drawPickups(){
  for (const pu of world.pickups){
    ctx.save();
    ctx.translate(pu.x, pu.y + Math.sin(pu.bob) * 4);
    ctx.shadowBlur = 12;

    if (pu.kind === 'coin'){
      ctx.fillStyle = '#fff62e'; ctx.shadowColor = '#fff62e';
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center'; ctx.fillText('$', 0, 3.5);
    } else if (pu.kind === 'heart'){
      ctx.fillStyle = '#ff2ec4'; ctx.shadowColor = '#ff2ec4';
      ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('❤', 0, 7);
    } else if (pu.kind === 'crate'){
      ctx.fillStyle = '#a12eff'; ctx.shadowColor = '#a12eff';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center'; ctx.fillText('?', 0, 5);
    }
    ctx.restore();
  }
}

function drawParticles(){
  for (const part of world.particles){
    ctx.save();
    ctx.globalAlpha = clamp(part.life / part.maxLife, 0, 1);
    ctx.fillStyle = part.color;

    if (part.meteor){
      ctx.shadowColor = part.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(part.x, part.y, part.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(part.x - part.size/2, part.y - part.size/2, part.size, part.size);
    }
    ctx.restore();
  }
}

function drawFloaters(){
  for (const f of world.floaters){
    ctx.save();
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 14px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

// ---------- Screen-Space UI Elements ----------
function renderScreenSpaceUI(){
  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Off-Screen Enemy Edge Indicators (Portrait Mode)
  if (isPortrait && world.state === "PLAYING"){
    const margin = 26;
    for (const e of world.enemies){
      if (e.dead) continue;
      const sp = worldToScreen(e.x + e.w/2, e.y + e.h/2);

      const isOffLeft = sp.x < 10;
      const isOffRight = sp.x > screenW - 10;
      if (isOffLeft || isOffRight){
        const edgeX = isOffLeft ? margin : (screenW - margin);
        const edgeY = clamp(sp.y, 80, screenH - 120);

        ctx.save();
        ctx.fillStyle = e.color;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        if (isOffLeft){
          ctx.moveTo(edgeX - 8, edgeY);
          ctx.lineTo(edgeX + 6, edgeY - 8);
          ctx.lineTo(edgeX + 6, edgeY + 8);
        } else {
          ctx.moveTo(edgeX + 8, edgeY);
          ctx.lineTo(edgeX - 6, edgeY - 8);
          ctx.lineTo(edgeX - 6, edgeY + 8);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // 2. Virtual Aim Reticle (when aiming via touch)
  if (world.input.hasAimTouch && world.player && world.state === "PLAYING"){
    const pScreen = worldToScreen(world.player.x + world.player.w/2, world.player.y + world.player.h/2);
    const reticleDist = 72;
    const rx = pScreen.x + Math.cos(world.input.aimAngle) * reticleDist;
    const ry = pScreen.y + Math.sin(world.input.aimAngle) * reticleDist;

    ctx.save();
    ctx.strokeStyle = '#fff62e';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#fff62e';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(rx, ry, 9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rx - 14, ry); ctx.lineTo(rx + 14, ry);
    ctx.moveTo(rx, ry - 14); ctx.lineTo(rx, ry + 14);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ==========================================================================
//   MAIN GAME LOOP
// ==========================================================================
let lastTime = performance.now();
let frameCount = 0;
let lastFpsTime = performance.now();

function gameLoop(now){
  requestAnimationFrame(gameLoop);

  const rawDt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  world.realTime += rawDt;

  frameCount++;
  if (now - lastFpsTime >= 1000){
    world.fps = frameCount;
    frameCount = 0;
    lastFpsTime = now;
  }

  const gameDt = rawDt * world.timeScale;

  if (world.state === "PLAYING"){
    world.time += gameDt;
    world.survivalTime += rawDt;

    updateEffects(gameDt, rawDt);
    updatePlayer(gameDt);
    updateEnemies(gameDt);
    updateBullets(gameDt);
    updatePickups(gameDt);
    updateParticles(gameDt);
    updateWaves(gameDt);
    updateChaos(gameDt);
    updateCamera(rawDt);
    cleanupDead();
  } else {
    updateCamera(rawDt);
  }

  render();
}

// ==========================================================================
//   UNIFIED INPUT SYSTEM
// ==========================================================================
const keys = {};
const touchShootPointers = new Set();
let mouseShootHeld = false;

window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code === 'Space') return;
  keys[e.code] = true;
  syncDesktopKeys();

  if (e.code === 'Escape'){
    e.preventDefault();
    if (world.state === "PLAYING") pauseGame();
    else if (world.state === "PAUSED") resumeGame();
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)){
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  syncDesktopKeys();
});

function syncDesktopKeys(){
  const left = !!keys['KeyA'] || !!keys['ArrowLeft'];
  const right = !!keys['KeyD'] || !!keys['ArrowRight'];
  const jump = !!keys['Space'] || !!keys['ArrowUp'] || !!keys['KeyW'];
  const shoot = !!keys['KeyJ'] || mouseShootHeld || touchShootPointers.size > 0;

  if (!activePointers.has('touch_move')){
    world.input.moveX = (left ? -1 : 0) + (right ? 1 : 0);
  }

  if (jump && !world.input.jumpHeld) world.input.jumpPressed = true;
  else world.input.jumpPressed = false;
  world.input.jumpHeld = jump;

  if (shoot && !world.input.shootHeld) world.input.shootPressed = true;
  world.input.shootHeld = shoot;
}

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse'){
    const rect = canvas.getBoundingClientRect();
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    world.input.aimX = worldPos.x;
    world.input.aimY = worldPos.y;
    world.input.hasAimTouch = false;
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0){
    mouseShootHeld = true;
    world.input.shootPressed = true;
    world.input.shootHeld = true;
  } else if (e.pointerType === 'touch' && world.state === "PLAYING"){
    e.preventDefault();
    touchShootPointers.add(e.pointerId);
    canvas.setPointerCapture(e.pointerId);
    updateTouchAim(e);
    world.input.shootPressed = !world.input.shootHeld;
    world.input.shootHeld = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touchShootPointers.has(e.pointerId)){
    updateTouchAim(e);
  }
});

window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0){
    mouseShootHeld = false;
    world.input.shootHeld = !!keys['KeyJ'] || touchShootPointers.size > 0;
  } else if (e.pointerType === 'touch' && touchShootPointers.delete(e.pointerId)){
    world.input.shootHeld = !!keys['KeyJ'] || mouseShootHeld || touchShootPointers.size > 0;
  }
});

window.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch' && touchShootPointers.delete(e.pointerId)){
    world.input.shootHeld = !!keys['KeyJ'] || mouseShootHeld || touchShootPointers.size > 0;
  }
});

function updateTouchAim(e){
  const rect = canvas.getBoundingClientRect();
  const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const p = world.player;
  if (!p) return;
  world.input.aimAngle = Math.atan2(worldPos.y - (p.y + p.h / 2), worldPos.x - (p.x + p.w / 2));
  world.input.hasAimTouch = true;
}

// ---------- Touch Controls Multitouch Layer ----------
const activePointers = new Map();

function bindTouchButton(id, onDown, onUp){
  const el = document.getElementById(id);
  if (!el) return;

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('pressed');
    onDown(e);
  });

  const clear = (e) => {
    el.classList.remove('pressed');
    onUp(e);
  };
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
}

// Move Left / Right
bindTouchButton('tc-left',
  () => { world.input.moveX = -1; activePointers.set('touch_move', true); },
  () => { if (world.input.moveX === -1) world.input.moveX = 0; activePointers.delete('touch_move'); }
);

bindTouchButton('tc-right',
  () => { world.input.moveX = 1; activePointers.set('touch_move', true); },
  () => { if (world.input.moveX === 1) world.input.moveX = 0; activePointers.delete('touch_move'); }
);

// Jump Button (Top of Left cluster)
bindTouchButton('tc-jump',
  () => {
    world.input.jumpPressed = true;
    world.input.jumpHeld = true;
  },
  () => {
    world.input.jumpHeld = false;
  }
);

// Shoot Button (Bottom of Right cluster)
bindTouchButton('tc-shoot',
  () => {
    world.input.shootPressed = true;
    world.input.shootHeld = true;
    if (!world.input.hasAimTouch && world.player){
      world.input.aimAngle = world.player.facing > 0 ? 0 : Math.PI;
    }
  },
  () => {
    world.input.shootHeld = false;
  }
);

// Virtual Aim Touchpad (Top of Right cluster)
const aimPad = document.getElementById('aim-touchpad');
const aimDot = document.getElementById('aim-touch-dot');
let aimPointerId = null;

if (aimPad){
  aimPad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    aimPointerId = e.pointerId;
    aimPad.setPointerCapture(e.pointerId);
    handleAimTouch(e);
  });

  aimPad.addEventListener('pointermove', (e) => {
    if (e.pointerId === aimPointerId) handleAimTouch(e);
  });

  const endAim = (e) => {
    if (e.pointerId === aimPointerId){
      aimPointerId = null;
      if (aimDot) aimDot.style.transform = 'translate(-50%, -50%)';
    }
  };
  aimPad.addEventListener('pointerup', endAim);
  aimPad.addEventListener('pointercancel', endAim);
}

function handleAimTouch(e){
  const rect = aimPad.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = e.clientX - centerX;
  const dy = e.clientY - centerY;
  const dist = Math.hypot(dx, dy);

  if (dist > 5){
    world.input.aimAngle = Math.atan2(dy, dx);
    world.input.hasAimTouch = true;
    const maxR = rect.width / 2 - 12;
    const clampedR = Math.min(dist, maxR);
    const dotX = (dx / dist) * clampedR;
    const dotY = (dy / dist) * clampedR;
    if (aimDot){
      aimDot.style.transform = `translate(calc(-50% + ${dotX}px), calc(-50% + ${dotY}px))`;
    }
  }
}

// Pause HUD Button
const pauseBtn = document.getElementById('pause-btn');
if (pauseBtn){
  pauseBtn.addEventListener('click', () => {
    if (world.state === "PLAYING") pauseGame();
    else if (world.state === "PAUSED") resumeGame();
  });
}

// Menu Handlers
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('pauseRestartBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('mainMenuBtn').addEventListener('click', () => {
  world.state = "MENU";
  showOverlay('title-screen');
  sfxBtn();
});
document.getElementById('pauseQuitBtn').addEventListener('click', () => {
  world.state = "MENU";
  showOverlay('title-screen');
  sfxBtn();
});

// Modals: How To Play
document.getElementById('howToPlayBtn').addEventListener('click', () => { showOverlay('how-to-play-modal'); sfxBtn(); });
document.getElementById('pauseHowToPlayBtn').addEventListener('click', () => { showOverlay('how-to-play-modal'); sfxBtn(); });
document.getElementById('closeHowToPlayBtn').addEventListener('click', () => {
  if (world.state === "PAUSED") showOverlay('pause-screen');
  else showOverlay('title-screen');
  sfxBtn();
});

document.getElementById('aboutBtn').addEventListener('click', () => { showOverlay('about-modal'); sfxBtn(); });
document.getElementById('closeAboutBtn').addEventListener('click', () => {
  showOverlay('title-screen');
  sfxBtn();
});

// Modals: Settings
document.getElementById('settingsBtn').addEventListener('click', () => { showOverlay('settings-modal'); sfxBtn(); });
document.getElementById('pauseSettingsBtn').addEventListener('click', () => { showOverlay('settings-modal'); sfxBtn(); });
document.getElementById('closeSettingsBtn').addEventListener('click', () => {
  saveSettings();
  if (world.state === "PAUSED") showOverlay('pause-screen');
  else showOverlay('title-screen');
  sfxBtn();
});

// Settings Toggles
function updateToggleBtn(id, active, label){
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.textContent = label || (active ? 'ON' : 'OFF');
  btn.classList.toggle('off', !active);
  btn.setAttribute('aria-pressed', String(!!active));
}

function applyTheme(theme){
  settings.theme = validThemes.includes(theme) ? theme : 'noir';
  document.body.dataset.theme = settings.theme;
  document.querySelectorAll('#theme-select, #theme-select-menu').forEach(select => {
    select.value = settings.theme;
  });
  saveSettings();
}

document.getElementById('theme-select').addEventListener('change', (e) => applyTheme(e.target.value));
document.getElementById('theme-select-menu').addEventListener('change', (e) => applyTheme(e.target.value));
document.getElementById('theme-select').value = settings.theme;
document.getElementById('theme-select-menu').value = settings.theme;

document.getElementById('toggle-shake').addEventListener('click', () => {
  settings.shake = !settings.shake;
  updateToggleBtn('toggle-shake', settings.shake);
  sfxBtn();
});

document.getElementById('toggle-flashing').addEventListener('click', () => {
  settings.flashing = !settings.flashing;
  document.body.classList.toggle('no-flash', !settings.flashing);
  updateToggleBtn('toggle-flashing', settings.flashing);
  sfxBtn();
});

document.getElementById('toggle-contrast').addEventListener('click', () => {
  settings.contrast = !settings.contrast;
  document.body.classList.toggle('high-contrast', settings.contrast);
  updateToggleBtn('toggle-contrast', settings.contrast);
  sfxBtn();
});

document.getElementById('toggle-particles').addEventListener('click', () => {
  if (settings.particles === 'high') settings.particles = 'med';
  else if (settings.particles === 'med') settings.particles = 'low';
  else settings.particles = 'high';
  updateToggleBtn('toggle-particles', true, settings.particles.toUpperCase());
  sfxBtn();
});

document.getElementById('toggle-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  updateToggleBtn('toggle-sound', settings.sound);
  sfxBtn();
});

document.getElementById('toggle-music').addEventListener('click', () => {
  settings.music = !settings.music;
  updateToggleBtn('toggle-music', settings.music);
  syncMusicPlayback();
  saveSettings();
  sfxBtn();
});

document.getElementById('toggle-motion').addEventListener('click', () => {
  settings.reduceMotion = !settings.reduceMotion;
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
  updateToggleBtn('toggle-motion', settings.reduceMotion);
  saveSettings();
  sfxBtn();
});

const musicVolumeInput = document.getElementById('music-volume');
const soundVolumeInput = document.getElementById('sound-volume');
function updateVolumeLabel(id, value){
  const label = document.getElementById(id);
  if (label) label.textContent = `${Math.round(value * 100)}%`;
}
if (musicVolumeInput){
  musicVolumeInput.value = Math.round(settings.musicVolume * 100);
  updateVolumeLabel('music-volume-value', settings.musicVolume);
  musicVolumeInput.addEventListener('input', () => {
    settings.musicVolume = Number(musicVolumeInput.value) / 100;
    if (bgMusic) bgMusic.volume = settings.musicVolume;
    updateVolumeLabel('music-volume-value', settings.musicVolume);
  });
  musicVolumeInput.addEventListener('change', saveSettings);
}
if (soundVolumeInput){
  soundVolumeInput.value = Math.round(settings.soundVolume * 100);
  updateVolumeLabel('sound-volume-value', settings.soundVolume);
  soundVolumeInput.addEventListener('input', () => {
    settings.soundVolume = Number(soundVolumeInput.value) / 100;
    updateVolumeLabel('sound-volume-value', settings.soundVolume);
  });
  soundVolumeInput.addEventListener('change', saveSettings);
}

updateToggleBtn('toggle-shake', settings.shake);
updateToggleBtn('toggle-flashing', settings.flashing);
updateToggleBtn('toggle-contrast', settings.contrast);
updateToggleBtn('toggle-particles', true, settings.particles.toUpperCase());
updateToggleBtn('toggle-sound', settings.sound);
updateToggleBtn('toggle-music', settings.music);
updateToggleBtn('toggle-motion', settings.reduceMotion);

// Fullscreen API
function toggleFullscreen(){
  if (!document.fullscreenElement){
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    else if (document.documentElement.webkitRequestFullscreen) document.documentElement.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}
document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
document.getElementById('pauseFullscreenBtn').addEventListener('click', toggleFullscreen);

// Start on Title Screen
showOverlay('title-screen');
requestAnimationFrame(gameLoop);

console.log("%cNEON CHAOS · 1280x720 RESPONSIVE ENGINE LOADED", "color:#2efff2;font-weight:bold;font-size:14px;");

})();