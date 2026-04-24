/* =========================================================
   Единорог: Догонялки
   Управляешь Леди Ливнерог (единорогом) и должен коснуться
   всех персонажей Времени Приключений на каждой волне.
   Персонажи убегают, каждая волна сложнее.
   Графика — canvas, звуки — Web Audio API.
   ========================================================= */
(() => {
  'use strict';

  // ---------- Constants ----------
  const FIELD_PADDING = 40;
  const PLAYER_RADIUS = 28;
  const CHAR_RADIUS = 22;
  const CATCH_DIST = PLAYER_RADIUS + CHAR_RADIUS - 8;
  const PLAYER_SPEED = 220;
  const BASE_CHAR_SPEED = 90;
  const CHAR_SPEED_WAVE_SCALE = 12;
  const FLEE_RADIUS = 160;
  const FLEE_FORCE = 1.6;
  const BASE_TIME_PER_CHAR = 8;
  const MIN_TIME = 15;
  const RAINBOW_COLORS = ['#ff0000','#ff8800','#ffff00','#00cc44','#0088ff','#8800ff'];
  const TRAIL_LENGTH = 18;
  const TRAIL_INTERVAL = 0.025;

  // ---------- Characters ----------
  const CHARACTERS = [
    { id: 'finn',   name: 'Финн',              bodyColor: '#4488ff', hatColor: '#ffffff', faceColor: '#ffe0b2' },
    { id: 'jake',   name: 'Джейк',             bodyColor: '#f5c542', hatColor: null,       faceColor: '#f5c542' },
    { id: 'bmo',    name: 'БиМО',              bodyColor: '#40c8a0', hatColor: null,       faceColor: '#a0ffda' },
    { id: 'iceking', name: 'Снежный Король',   bodyColor: '#88bbff', hatColor: '#ffdd44', faceColor: '#c8ddff' },
    { id: 'pb',     name: 'Принцесса Жвачка',  bodyColor: '#ff80b8', hatColor: '#ff4488', faceColor: '#ffc8e0' },
    { id: 'marcy',  name: 'Марселин',           bodyColor: '#444466', hatColor: null,       faceColor: '#d8d8e8' },
  ];

  // ---------- State ----------
  const S = {
    canvas: null, ctx: null,
    dpr: 1, width: 0, height: 0, vw: 0, vh: 0,
    running: false, paused: false, over: false,
    wave: 1, score: 0, best: 0,
    timeLeft: 0, totalTime: 0,
    player: null,
    chars: [],
    caught: 0, totalChars: 0,
    soundOn: true,
    lastFrame: 0,
    menuOpen: 'main',
    trail: [],
    trailTimer: 0,
    particles: [],
    starField: [],
  };

  // ---------- Storage ----------
  const STORAGE_KEY = 'unicorn-tag.v1';
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.best === 'number') S.best = d.best;
      if (typeof d.soundOn === 'boolean') S.soundOn = d.soundOn;
    } catch (_) {}
  }
  function saveSave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        best: S.best, soundOn: S.soundOn,
      }));
    } catch (_) {}
  }

  // ---------- Audio ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playTone(freq, dur, type, vol) {
    if (!S.soundOn) return;
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  }
  function sndCatch() {
    playTone(660, 0.12, 'sine', 0.18);
    setTimeout(() => playTone(880, 0.15, 'sine', 0.15), 80);
    setTimeout(() => playTone(1100, 0.18, 'sine', 0.12), 160);
  }
  function sndWaveComplete() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.25, 'sine', 0.15), i * 120));
  }
  function sndGameOver() {
    playTone(400, 0.3, 'triangle', 0.15);
    setTimeout(() => playTone(300, 0.4, 'triangle', 0.12), 200);
  }

  // ---------- Sprite drawing ----------
  function drawRainicorn(ctx, x, y, r, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Body (rainbow gradient)
    const bodyLen = r * 2.2;
    const bodyW = r * 0.9;
    for (let i = 0; i < 6; i++) {
      const sx = -bodyLen / 2 + (bodyLen / 6) * i;
      ctx.fillStyle = RAINBOW_COLORS[i];
      ctx.fillRect(sx, -bodyW / 2, bodyLen / 6 + 1, bodyW);
    }
    // Rounded ends
    ctx.fillStyle = RAINBOW_COLORS[0];
    ctx.beginPath();
    ctx.ellipse(-bodyLen / 2, 0, bodyW / 2, bodyW / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = RAINBOW_COLORS[5];
    ctx.beginPath();
    ctx.ellipse(bodyLen / 2, 0, bodyW / 2, bodyW / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(bodyLen / 2 + r * 0.4, 0, r * 0.55, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Horn
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    const hornBase = bodyLen / 2 + r * 0.6;
    ctx.moveTo(hornBase, -r * 0.15);
    ctx.lineTo(hornBase + r * 0.55, 0);
    ctx.lineTo(hornBase, r * 0.15);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(bodyLen / 2 + r * 0.35, -r * 0.12, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bodyLen / 2 + r * 0.38, -r * 0.15, r * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // Mane
    ctx.fillStyle = '#ff88cc';
    for (let i = 0; i < 4; i++) {
      const mx = bodyLen / 2 + r * 0.1 - i * r * 0.2;
      ctx.beginPath();
      ctx.ellipse(mx, -bodyW / 2 - r * 0.1, r * 0.15, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawCharacter(ctx, char, x, y, r) {
    ctx.save();
    ctx.translate(x, y);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 0.7, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    const c = char.def;

    if (c.id === 'finn') {
      // White bear hat
      ctx.fillStyle = c.hatColor;
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.beginPath();
      ctx.arc(-r * 0.6, -r * 0.6, r * 0.22, 0, Math.PI * 2);
      ctx.arc(r * 0.6, -r * 0.6, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      // Face
      ctx.fillStyle = c.faceColor;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.05, r * 0.5, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.05, r * 0.08, 0, Math.PI * 2);
      ctx.arc(r * 0.18, -r * 0.05, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      // Mouth
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, r * 0.15, r * 0.15, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    } else if (c.id === 'jake') {
      // Yellow body
      ctx.fillStyle = c.bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.8, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      // Jowls
      ctx.fillStyle = '#e8b030';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.25, r * 0.55, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(-r * 0.25, -r * 0.15, r * 0.18, r * 0.22, 0, 0, Math.PI * 2);
      ctx.ellipse(r * 0.25, -r * 0.15, r * 0.18, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-r * 0.22, -r * 0.1, r * 0.08, 0, Math.PI * 2);
      ctx.arc(r * 0.22, -r * 0.1, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      // Nose
      ctx.fillStyle = '#8b5e2a';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.1, r * 0.12, r * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (c.id === 'bmo') {
      // Body
      ctx.fillStyle = c.bodyColor;
      ctx.beginPath();
      roundRect(ctx, -r * 0.7, -r * 0.8, r * 1.4, r * 1.6, r * 0.2);
      ctx.fill();
      // Screen
      ctx.fillStyle = c.faceColor;
      ctx.beginPath();
      roundRect(ctx, -r * 0.5, -r * 0.6, r * 1.0, r * 0.8, r * 0.1);
      ctx.fill();
      // Face on screen
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(-r * 0.2, -r * 0.3, r * 0.08, 0, Math.PI * 2);
      ctx.arc(r * 0.2, -r * 0.3, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -r * 0.08, r * 0.15, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
      // Button
      ctx.fillStyle = '#ff5555';
      ctx.beginPath();
      ctx.arc(0, r * 0.5, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      // D-pad
      ctx.fillStyle = '#226644';
      ctx.fillRect(-r * 0.45, r * 0.35, r * 0.25, r * 0.08);
      ctx.fillRect(-r * 0.4, r * 0.27, r * 0.08, r * 0.25);
    } else if (c.id === 'iceking') {
      // Body/robe
      ctx.fillStyle = c.bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.1, r * 0.7, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      // Face
      ctx.fillStyle = c.faceColor;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.05, r * 0.5, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crown
      ctx.fillStyle = c.hatColor;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.45);
      ctx.lineTo(-r * 0.25, -r * 0.9);
      ctx.lineTo(-r * 0.05, -r * 0.55);
      ctx.lineTo(r * 0.05, -r * 0.95);
      ctx.lineTo(r * 0.2, -r * 0.55);
      ctx.lineTo(r * 0.35, -r * 0.85);
      ctx.lineTo(r * 0.4, -r * 0.45);
      ctx.closePath();
      ctx.fill();
      // Crown gems
      ctx.fillStyle = '#ff2244';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.7, r * 0.06, 0, Math.PI * 2);
      ctx.arc(r * 0.05, -r * 0.75, r * 0.06, 0, Math.PI * 2);
      ctx.arc(r * 0.35, -r * 0.68, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(-r * 0.2, -r * 0.1, r * 0.14, r * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(r * 0.2, -r * 0.1, r * 0.14, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.08, r * 0.06, 0, Math.PI * 2);
      ctx.arc(r * 0.18, -r * 0.08, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
      // Nose
      ctx.fillStyle = '#7799cc';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.12, r * 0.12, r * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      // Beard
      ctx.fillStyle = '#ddeeff';
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.2);
      ctx.quadraticCurveTo(-r * 0.3, r * 1.0, 0, r * 0.95);
      ctx.quadraticCurveTo(r * 0.3, r * 1.0, r * 0.4, r * 0.2);
      ctx.closePath();
      ctx.fill();
    } else if (c.id === 'pb') {
      // Hair
      ctx.fillStyle = c.hatColor;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.3, r * 0.65, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Face
      ctx.fillStyle = c.faceColor;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.05, r * 0.5, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.fillStyle = c.bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.6, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crown
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, -r * 0.75);
      ctx.lineTo(-r * 0.15, -r * 1.05);
      ctx.lineTo(0, -r * 0.82);
      ctx.lineTo(r * 0.15, -r * 1.05);
      ctx.lineTo(r * 0.25, -r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#44bbff';
      ctx.beginPath();
      ctx.arc(0, -r * 0.88, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-r * 0.18, 0, r * 0.07, 0, Math.PI * 2);
      ctx.arc(r * 0.18, 0, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      // Mouth
      ctx.strokeStyle = '#cc3366'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, r * 0.18, r * 0.12, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    } else if (c.id === 'marcy') {
      // Hair
      ctx.fillStyle = '#222233';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 0.75, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Long hair strands
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, r * 0.5, r * 0.2, r * 0.45, -0.2, 0, Math.PI * 2);
      ctx.ellipse(r * 0.3, r * 0.5, r * 0.2, r * 0.45, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Face
      ctx.fillStyle = c.faceColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.5, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#cc0033';
      ctx.beginPath();
      ctx.ellipse(-r * 0.18, -r * 0.05, r * 0.09, r * 0.11, 0, 0, Math.PI * 2);
      ctx.ellipse(r * 0.18, -r * 0.05, r * 0.09, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.03, r * 0.045, 0, Math.PI * 2);
      ctx.arc(r * 0.18, -r * 0.03, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
      // Fangs
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-r * 0.08, r * 0.18);
      ctx.lineTo(-r * 0.05, r * 0.3);
      ctx.lineTo(-r * 0.02, r * 0.18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.02, r * 0.18);
      ctx.lineTo(r * 0.05, r * 0.3);
      ctx.lineTo(r * 0.08, r * 0.18);
      ctx.fill();
      // Mouth line
      ctx.strokeStyle = '#8a3355'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, r * 0.16, r * 0.12, 0.05 * Math.PI, 0.95 * Math.PI);
      ctx.stroke();
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, rad) {
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
  }

  // ---------- Particles ----------
  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      S.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.4 + Math.random() * 0.4,
        r: 2 + Math.random() * 4,
        color,
      });
    }
  }

  // ---------- Star field ----------
  function initStarField() {
    S.starField = [];
    for (let i = 0; i < 80; i++) {
      S.starField.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.5 + Math.random() * 1.5,
        twinkle: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
      });
    }
  }

  // ---------- Waves ----------
  function getWaveConfig(wave) {
    const charCount = Math.min(2 + wave, CHARACTERS.length);
    const speed = BASE_CHAR_SPEED + wave * CHAR_SPEED_WAVE_SCALE;
    const time = Math.max(MIN_TIME, charCount * BASE_TIME_PER_CHAR - wave * 0.5);
    return { charCount, speed, time };
  }

  function spawnWave() {
    const cfg = getWaveConfig(S.wave);
    S.chars = [];
    S.caught = 0;
    S.totalChars = cfg.charCount;
    S.timeLeft = cfg.time;
    S.totalTime = cfg.time;

    // Shuffle characters and pick cfg.charCount
    const shuffled = [...CHARACTERS].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, cfg.charCount);

    const pad = CHAR_RADIUS + 30;
    const fw = S.width - pad * 2;
    const fh = S.height - pad * 2 - 60;

    picked.forEach((def) => {
      let x, y, tries = 0;
      do {
        x = pad + Math.random() * fw;
        y = pad + 60 + Math.random() * fh;
        tries++;
      } while (tries < 50 && dist(x, y, S.player.x, S.player.y) < FLEE_RADIUS * 1.2);

      S.chars.push({
        def,
        x, y,
        vx: 0, vy: 0,
        angle: Math.random() * Math.PI * 2,
        changeTimer: Math.random() * 2,
        speed: cfg.speed,
        caught: false,
        bobPhase: Math.random() * Math.PI * 2,
      });
    });

    updateHUD();
  }

  // ---------- Helpers ----------
  function dist(x1, y1, x2, y2) {
    const dx = x1 - x2, dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- Input ----------
  const keys = {};
  let touchStart = null;
  let touchDir = { x: 0, y: 0 };

  function getInputDir() {
    let dx = 0, dy = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) dx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) dx += 1;
    if (keys['ArrowUp'] || keys['KeyW']) dy -= 1;
    if (keys['ArrowDown'] || keys['KeyS']) dy += 1;
    dx += touchDir.x;
    dy += touchDir.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; }
    return { x: dx, y: dy };
  }

  // ---------- HUD ----------
  function updateHUD() {
    const $wave = document.getElementById('waveValue');
    const $catch = document.getElementById('catchValue');
    const $timer = document.getElementById('timerValue');
    const $score = document.getElementById('scoreValue');
    const $best = document.getElementById('bestValue');

    $wave.textContent = S.wave;
    $catch.textContent = S.caught + ' / ' + S.totalChars;
    const mins = Math.floor(S.timeLeft / 60);
    const secs = Math.floor(S.timeLeft % 60);
    $timer.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    $score.textContent = S.score;
    $best.textContent = S.best;
  }

  function floater(text, x, y, cls) {
    const el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    const rect = S.canvas.getBoundingClientRect();
    el.style.left = (x / S.vw * rect.width) + 'px';
    el.style.top = (y / S.vh * rect.height) + 'px';
    document.getElementById('floaters').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._tid);
    el._tid = setTimeout(() => el.classList.remove('show'), 2000);
  }

  // ---------- Menu ----------
  function showMenu(id) {
    S.menuOpen = id;
    ['menuMain', 'menuPause', 'menuWaveComplete', 'menuOver'].forEach((m) => {
      document.getElementById(m).classList.toggle('show', m === 'menu' + id.charAt(0).toUpperCase() + id.slice(1));
    });
    const hud = document.getElementById('hud');
    hud.style.display = (id === 'none') ? 'flex' : 'none';
  }

  function showMenuById(elId) {
    ['menuMain', 'menuPause', 'menuWaveComplete', 'menuOver'].forEach((m) => {
      document.getElementById(m).classList.toggle('show', m === elId);
    });
    const hud = document.getElementById('hud');
    hud.style.display = (elId === '') ? 'flex' : 'none';
  }

  // ---------- Game flow ----------
  function startGame() {
    S.wave = 1;
    S.score = 0;
    S.over = false;
    S.paused = false;
    S.trail = [];
    S.particles = [];

    S.player = {
      x: S.width / 2,
      y: S.height / 2,
      angle: 0,
    };

    spawnWave();
    S.running = true;
    showMenuById('');
    document.getElementById('hud').style.display = 'flex';
    S.lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function pauseGame() {
    if (!S.running || S.over) return;
    S.paused = true;
    showMenuById('menuPause');
  }

  function resumeGame() {
    S.paused = false;
    showMenuById('');
    document.getElementById('hud').style.display = 'flex';
    S.lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function waveComplete() {
    const timeBonus = Math.round(S.timeLeft * 10);
    const waveScore = S.totalChars * 100;
    S.score += waveScore + timeBonus;
    if (S.score > S.best) { S.best = S.score; }
    saveSave();
    sndWaveComplete();

    document.getElementById('waveScore').textContent = waveScore;
    document.getElementById('waveTimeBonus').textContent = timeBonus;
    document.getElementById('waveCompleteText').textContent =
      'Волна ' + S.wave + ' пройдена! Все персонажи пойманы.';
    showMenuById('menuWaveComplete');
  }

  function nextWave() {
    S.wave++;
    S.trail = [];
    S.particles = [];
    S.player.x = S.width / 2;
    S.player.y = S.height / 2;
    spawnWave();
    showMenuById('');
    document.getElementById('hud').style.display = 'flex';
    S.lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function gameOver() {
    S.over = true;
    S.running = false;
    if (S.score > S.best) { S.best = S.score; }
    saveSave();
    sndGameOver();

    document.getElementById('overWave').textContent = S.wave;
    document.getElementById('overScore').textContent = S.score;
    document.getElementById('overBest').textContent = S.best;
    showMenuById('menuOver');
  }

  function toMainMenu() {
    S.running = false;
    S.paused = false;
    S.over = false;
    showMenuById('menuMain');
  }

  // ---------- Update ----------
  function update(dt) {
    // Timer
    S.timeLeft -= dt;
    if (S.timeLeft <= 0) {
      S.timeLeft = 0;
      gameOver();
      return;
    }

    // Player movement
    const input = getInputDir();
    const px = S.player.x + input.x * PLAYER_SPEED * dt;
    const py = S.player.y + input.y * PLAYER_SPEED * dt;
    S.player.x = clamp(px, PLAYER_RADIUS, S.width - PLAYER_RADIUS);
    S.player.y = clamp(py, PLAYER_RADIUS + 50, S.height - PLAYER_RADIUS);

    if (input.x !== 0 || input.y !== 0) {
      S.player.angle = Math.atan2(input.y, input.x);
    }

    // Rainbow trail
    S.trailTimer -= dt;
    if (S.trailTimer <= 0 && (input.x !== 0 || input.y !== 0)) {
      S.trail.push({ x: S.player.x, y: S.player.y, life: 0.5 });
      if (S.trail.length > TRAIL_LENGTH) S.trail.shift();
      S.trailTimer = TRAIL_INTERVAL;
    }

    // Update trail
    for (let i = S.trail.length - 1; i >= 0; i--) {
      S.trail[i].life -= dt;
      if (S.trail[i].life <= 0) S.trail.splice(i, 1);
    }

    // Characters AI
    for (const ch of S.chars) {
      if (ch.caught) continue;
      ch.bobPhase += dt * 3;

      const dx = ch.x - S.player.x;
      const dy = ch.y - S.player.y;
      const d = Math.sqrt(dx * dx + dy * dy);

      // Flee from player
      if (d < FLEE_RADIUS && d > 0) {
        const fleeFactor = (1 - d / FLEE_RADIUS) * FLEE_FORCE;
        ch.vx += (dx / d) * fleeFactor * ch.speed * dt * 8;
        ch.vy += (dy / d) * fleeFactor * ch.speed * dt * 8;
      }

      // Random wandering
      ch.changeTimer -= dt;
      if (ch.changeTimer <= 0) {
        ch.angle = Math.random() * Math.PI * 2;
        ch.changeTimer = 1.5 + Math.random() * 2;
      }
      ch.vx += Math.cos(ch.angle) * ch.speed * dt;
      ch.vy += Math.sin(ch.angle) * ch.speed * dt;

      // Damping
      ch.vx *= 0.92;
      ch.vy *= 0.92;

      // Move
      ch.x += ch.vx * dt;
      ch.y += ch.vy * dt;

      // Bounce off walls
      const pad = CHAR_RADIUS + 10;
      if (ch.x < pad) { ch.x = pad; ch.vx = Math.abs(ch.vx); }
      if (ch.x > S.width - pad) { ch.x = S.width - pad; ch.vx = -Math.abs(ch.vx); }
      if (ch.y < pad + 50) { ch.y = pad + 50; ch.vy = Math.abs(ch.vy); }
      if (ch.y > S.height - pad) { ch.y = S.height - pad; ch.vy = -Math.abs(ch.vy); }

      // Check catch
      if (dist(S.player.x, S.player.y, ch.x, ch.y) < CATCH_DIST) {
        ch.caught = true;
        S.caught++;
        S.score += 50;
        sndCatch();
        floater('+50 ' + ch.def.name, ch.x, ch.y, 'catch');
        spawnParticles(ch.x, ch.y, ch.def.bodyColor, 12);

        if (S.caught >= S.totalChars) {
          waveComplete();
          return;
        }
      }
    }

    // Update particles
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }

    updateHUD();
  }

  // ---------- Render ----------
  function render() {
    const ctx = S.ctx;
    const w = S.vw, h = S.vh;
    ctx.clearRect(0, 0, w, h);

    // Background
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, '#1a0a40');
    grad.addColorStop(0.5, '#120830');
    grad.addColorStop(1, '#080418');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Star field
    const time = performance.now() / 1000;
    for (const star of S.starField) {
      const alpha = 0.3 + 0.4 * Math.sin(star.twinkle + time * star.speed);
      ctx.fillStyle = 'rgba(200,180,255,' + alpha + ')';
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r * S.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ground hints (magical meadow spots)
    ctx.fillStyle = 'rgba(120,80,200,0.06)';
    for (let i = 0; i < 8; i++) {
      const gx = ((i * 137 + 50) % (w - 100)) + 50;
      const gy = ((i * 211 + 100) % (h - 200)) + 100;
      ctx.beginPath();
      ctx.ellipse(gx, gy, 60 * S.dpr, 30 * S.dpr, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rainbow trail
    for (let i = 0; i < S.trail.length; i++) {
      const t = S.trail[i];
      const alpha = (t.life / 0.5) * 0.6;
      const colorIdx = i % RAINBOW_COLORS.length;
      ctx.fillStyle = RAINBOW_COLORS[colorIdx];
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(t.x * S.dpr, t.y * S.dpr, (4 + i * 0.3) * S.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Characters (uncaught)
    for (const ch of S.chars) {
      if (ch.caught) continue;
      const bob = Math.sin(ch.bobPhase) * 3;
      drawCharacter(ctx, ch, ch.x * S.dpr, (ch.y + bob) * S.dpr, CHAR_RADIUS * S.dpr);
    }

    // Caught characters (faded)
    ctx.globalAlpha = 0.25;
    for (const ch of S.chars) {
      if (!ch.caught) continue;
      drawCharacter(ctx, ch, ch.x * S.dpr, ch.y * S.dpr, CHAR_RADIUS * S.dpr);
    }
    ctx.globalAlpha = 1;

    // Particles
    for (const p of S.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x * S.dpr, p.y * S.dpr, p.r * S.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Player (Lady Rainicorn)
    if (S.player) {
      // Glow
      ctx.save();
      ctx.shadowColor = '#ff88cc';
      ctx.shadowBlur = 20 * S.dpr;
      drawRainicorn(ctx, S.player.x * S.dpr, S.player.y * S.dpr, PLAYER_RADIUS * S.dpr, S.player.angle);
      ctx.restore();
    }

    // Timer warning
    if (S.timeLeft <= 5 && S.timeLeft > 0 && S.running && !S.paused) {
      ctx.fillStyle = 'rgba(255,50,50,' + (0.15 + 0.1 * Math.sin(time * 8)) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // Character name labels
    ctx.font = (11 * S.dpr) + 'px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    for (const ch of S.chars) {
      if (ch.caught) continue;
      ctx.fillStyle = 'rgba(255,240,255,0.85)';
      ctx.fillText(ch.def.name, ch.x * S.dpr, (ch.y - CHAR_RADIUS - 8) * S.dpr);
    }
  }

  // ---------- Game loop ----------
  function loop(ts) {
    if (!S.running || S.paused || S.over) return;
    const dt = Math.min((ts - S.lastFrame) / 1000, 0.05);
    S.lastFrame = ts;
    update(dt);
    if (!S.running || S.paused || S.over) { render(); return; }
    render();
    requestAnimationFrame(loop);
  }

  // ---------- Resize ----------
  function resize() {
    const c = S.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.parentElement.getBoundingClientRect();
    S.width = rect.width;
    S.height = rect.height;
    S.dpr = dpr;
    S.vw = Math.round(rect.width * dpr);
    S.vh = Math.round(rect.height * dpr);
    c.width = S.vw;
    c.height = S.vh;
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
    if (!S.running) render();
  }

  // ---------- Init ----------
  function init() {
    S.canvas = document.getElementById('stage');
    S.ctx = S.canvas.getContext('2d');
    loadSave();
    initStarField();
    resize();
    window.addEventListener('resize', resize);

    // Keyboard
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (e.code === 'Escape') {
        if (S.menuOpen === 'none' || document.getElementById('hud').style.display === 'flex') {
          pauseGame();
        }
      }
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    // Touch
    S.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
      touchDir = { x: 0, y: 0 };
    }, { passive: false });
    S.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!touchStart) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 10) {
        touchDir = { x: dx / len, y: dy / len };
      }
    }, { passive: false });
    S.canvas.addEventListener('touchend', () => {
      touchStart = null;
      touchDir = { x: 0, y: 0 };
    });

    // Sound toggle
    document.getElementById('btnSound').addEventListener('click', () => {
      S.soundOn = !S.soundOn;
      document.getElementById('btnSound').classList.toggle('muted', !S.soundOn);
      saveSave();
    });
    document.getElementById('btnSound').classList.toggle('muted', !S.soundOn);

    // Pause
    document.getElementById('btnPause').addEventListener('click', pauseGame);

    // Menu buttons
    document.getElementById('btnPlay').addEventListener('click', () => {
      ensureAudio();
      startGame();
    });
    document.getElementById('btnResume').addEventListener('click', resumeGame);
    document.getElementById('btnRestartFromPause').addEventListener('click', () => {
      S.paused = false;
      startGame();
    });
    document.getElementById('btnPauseToMenu').addEventListener('click', toMainMenu);
    document.getElementById('btnNextWave').addEventListener('click', nextWave);
    document.getElementById('btnWaveToMenu').addEventListener('click', toMainMenu);
    document.getElementById('btnRetry').addEventListener('click', startGame);
    document.getElementById('btnOverMenu').addEventListener('click', toMainMenu);

    // Initial render
    render();

    // SDK
    if (window.YSDK) {
      window.YSDK.init().then(() => window.YSDK.gameReady());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
