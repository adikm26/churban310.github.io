// ============================================================
//  Эволюция Гоблина — v2
//  Клик по всему экрану, 10 уровней, детальные иллюстрации,
//  тихая фоновая мелодия. Без внешних зависимостей.
// ============================================================

(() => {
'use strict';

// ---- Форматирование чисел (1.2K, 3.4M, ...) ----
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc'];
  const tier = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3));
  const scaled = n / Math.pow(10, tier * 3);
  return scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0) + units[tier];
}

// ---- Уровни эволюции (10) ----
const LEVELS = [
  { title: 'Малыш гоблин',      xp: 0,      biome: 'forest'  },
  { title: 'Гоблинёнок',        xp: 50,     biome: 'forest'  },
  { title: 'Юный собиратель',   xp: 150,    biome: 'forest'  },
  { title: 'Разбойник',         xp: 400,    biome: 'grove'   },
  { title: 'Охотник',           xp: 1000,   biome: 'grove'   },
  { title: 'Воин',              xp: 2500,   biome: 'grove'   },
  { title: 'Гоблин-ветеран',    xp: 6000,   biome: 'cave'    },
  { title: 'Шаман',             xp: 15000,  biome: 'cave'    },
  { title: 'Вождь',             xp: 40000,  biome: 'kingdom' },
  { title: 'Король гоблинов',   xp: 100000, biome: 'kingdom' },
];

function levelForXp(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
  return idx;
}
function levelProgress(xp) {
  const idx = levelForXp(xp);
  if (idx >= LEVELS.length - 1) return { idx, pct: 1, cur: xp, next: xp };
  return { idx, pct: (xp - LEVELS[idx].xp) / (LEVELS[idx + 1].xp - LEVELS[idx].xp),
    cur: LEVELS[idx].xp, next: LEVELS[idx + 1].xp };
}

// ---- Апгрейды ----
const UPGRADES = [
  { id: 'pickaxe', icon: '⛏️', title: 'Кирка',              desc: 'Добавляет добычу за клик.',
    kind: 'click', unlockLevel: 1, costBase: 10,      costGrowth: 1.15, perLevel: 1 },
  { id: 'cunning', icon: '🗿', title: 'Гоблинская хитрость',desc: 'Автоматический сбор монет.',
    kind: 'idle',  unlockLevel: 1, costBase: 25,      costGrowth: 1.17, perLevel: 0.5 },
  { id: 'torch',   icon: '🔥', title: 'Факел в пещере',     desc: 'Свет помогает находить самоцветы.',
    kind: 'click', unlockLevel: 2, costBase: 120,     costGrowth: 1.16, perLevel: 3 },
  { id: 'bat',     icon: '🦇', title: 'Ручная мышь',        desc: 'Приносит монеты из тёмных уголков.',
    kind: 'idle',  unlockLevel: 3, costBase: 350,     costGrowth: 1.19, perLevel: 2 },
  { id: 'dagger',  icon: '🗡️', title: 'Кинжал удачи',       desc: 'От клинка монеты сами разлетаются.',
    kind: 'click', unlockLevel: 4, costBase: 1500,    costGrowth: 1.17, perLevel: 10 },
  { id: 'mine',    icon: '⚒️', title: 'Золотая шахта',      desc: 'Кузены-шахтёры добывают золото.',
    kind: 'idle',  unlockLevel: 5, costBase: 5500,    costGrowth: 1.2,  perLevel: 8 },
  { id: 'totem',   icon: '🪵', title: 'Тотем шамана',       desc: 'Ритуальная магия усиливает удары.',
    kind: 'click', unlockLevel: 6, costBase: 25000,   costGrowth: 1.18, perLevel: 40 },
  { id: 'dragon',  icon: '🐉', title: 'Прирученный дракон', desc: 'Сидит на золоте и делится им.',
    kind: 'idle',  unlockLevel: 7, costBase: 100000,  costGrowth: 1.2,  perLevel: 60 },
  { id: 'artifact',icon: '🔮', title: 'Древний артефакт',   desc: 'Щелчок — и монеты льются рекой.',
    kind: 'click', unlockLevel: 8, costBase: 600000,  costGrowth: 1.2,  perLevel: 300 },
  { id: 'throne',  icon: '👑', title: 'Трон короля',        desc: 'Доход, достойный монарха.',
    kind: 'idle',  unlockLevel: 9, costBase: 2000000, costGrowth: 1.2,  perLevel: 500 },
];
function upgradeCost(up, n) { return Math.floor(up.costBase * Math.pow(up.costGrowth, n)); }

// ---- Сейв ----
const SAVE_KEY = 'goblinEvolution.save.v2';
function makeDefaultState() {
  const levels = {};
  for (const u of UPGRADES) levels[u.id] = 0;
  return { coins: 0, totalCoins: 0, levels, sfx: true, music: true };
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return makeDefaultState();
    const data = JSON.parse(raw);
    const def = makeDefaultState();
    return { ...def, ...data, levels: { ...def.levels, ...(data.levels || {}) } };
  } catch (_) { return makeDefaultState(); }
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) {} }

// ---- Звук (Web Audio) ----
const Sound = (() => {
  let ctx = null;
  let masterSfx = null, masterMusic = null;
  let sfxOn = true, musicOn = true;
  let musicStarted = false;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    masterSfx = ctx.createGain();   masterSfx.gain.value = sfxOn ? 0.45 : 0;
    masterMusic = ctx.createGain(); masterMusic.gain.value = musicOn ? 0.12 : 0;
    masterSfx.connect(ctx.destination);
    masterMusic.connect(ctx.destination);
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setSfx(on) { sfxOn = on; if (masterSfx) masterSfx.gain.value = on ? 0.45 : 0; }
  function setMusic(on) {
    musicOn = on;
    if (masterMusic) masterMusic.gain.linearRampToValueAtTime(on ? 0.12 : 0, (ctx?.currentTime || 0) + 0.3);
    if (on) startMusic();
  }

  function blip({ freq = 660, dur = 0.18, type = 'sine', gain = 0.3, freqEnd = null, delay = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(masterSfx);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function coin() { ensure(); if (!ctx) return; resume();
    blip({ freq: 1200, freqEnd: 1800, dur: 0.08, type: 'triangle', gain: 0.2 });
    blip({ freq: 1600, freqEnd: 2500, dur: 0.07, type: 'sine',     gain: 0.12, delay: 0.04 });
  }
  function purchase() { ensure(); if (!ctx) return; resume();
    blip({ freq: 520,  freqEnd: 880,  dur: 0.15, type: 'square',   gain: 0.15 });
    blip({ freq: 880,  freqEnd: 1320, dur: 0.13, type: 'triangle', gain: 0.12, delay: 0.09 });
  }
  function fail() { ensure(); if (!ctx) return; resume();
    blip({ freq: 300, freqEnd: 150, dur: 0.18, type: 'sawtooth', gain: 0.1 });
  }
  function levelUp() { ensure(); if (!ctx) return; resume();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      blip({ freq: f, dur: 0.24, type: 'triangle', gain: 0.2, delay: i * 0.1 }));
    blip({ freq: 1318.5, dur: 0.55, type: 'sine', gain: 0.16, delay: 0.55 });
  }

  // Фоновая мелодия — мягкая пентатоника. 16-секундный паттерн.
  function startMusic() {
    ensure(); if (!ctx || musicStarted) return; musicStarted = true;

    // Тихая «подушка» (два низких синусных голоса)
    const pad = ctx.createGain(); pad.gain.value = 0.4; pad.connect(masterMusic);
    [130.81, 196].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
      lfo.frequency.value = 0.1 + Math.random() * 0.1; lfoG.gain.value = 1.5;
      lfo.connect(lfoG).connect(o.frequency);
      o.connect(pad); o.start(); lfo.start();
    });

    // Мелодия поверх подушки: пентатоника C D E G A, 16 шагов по 0.5 с.
    // E4 C4 G4 A4 — повтор — E4 G4 A4 C5
    const scale = [329.63, 261.63, 392, 440, 329.63, 261.63, 392, 440,
                   329.63, 392, 440, 523.25, 440, 392, 329.63, 261.63];
    const step = 0.5; // секунда на шаг
    const patternLen = scale.length * step; // 8 секунд

    function note(f, t, dur) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // лёгкое vibrato
      const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
      lfo.frequency.value = 5; lfoG.gain.value = 1.8;
      lfo.connect(lfoG).connect(o.frequency);
      o.connect(g).connect(masterMusic);
      o.start(t); o.stop(t + dur + 0.05);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }

    const start = ctx.currentTime + 0.2;
    function scheduleLoop(iter = 0) {
      const t0 = start + iter * patternLen;
      for (let i = 0; i < scale.length; i++) {
        note(scale[i], t0 + i * step, step * 0.9);
      }
      // зацикливаем
      setTimeout(() => scheduleLoop(iter + 1), patternLen * 1000 - 100);
    }
    scheduleLoop();
  }

  return { coin, purchase, fail, levelUp, ensure, resume, setSfx, setMusic, startMusic };
})();

// ---- Goblin illustrations (10 штук, SVG) ----
// Базовый viewBox 500x500, фигура рисуется путями/градиентами.
// Общая палитра и шаблоны — общие defs, потом каждая иллюстрация — своя композиция.

function goblinSvg(level /* 1..10 */) {
  const defs = `
    <defs>
      <radialGradient id="skin" cx="40%" cy="30%" r="75%">
        <stop offset="0%"   stop-color="#cdeb7a"/>
        <stop offset="40%"  stop-color="#85b945"/>
        <stop offset="100%" stop-color="#3e6c1c"/>
      </radialGradient>
      <radialGradient id="skinDark" cx="40%" cy="30%" r="75%">
        <stop offset="0%"   stop-color="#a9d560"/>
        <stop offset="40%"  stop-color="#5f8b2a"/>
        <stop offset="100%" stop-color="#25430f"/>
      </radialGradient>
      <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#b07a42"/>
        <stop offset="100%" stop-color="#5b3a1d"/>
      </linearGradient>
      <linearGradient id="armor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#cdd4de"/>
        <stop offset="55%" stop-color="#7d8694"/>
        <stop offset="100%" stop-color="#3b4150"/>
      </linearGradient>
      <linearGradient id="darkArmor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5a4a8a"/>
        <stop offset="100%" stop-color="#1c1432"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffeb8c"/>
        <stop offset="55%" stop-color="#f2c34a"/>
        <stop offset="100%" stop-color="#a06d00"/>
      </linearGradient>
      <radialGradient id="magic" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(180, 220, 255, .95)"/>
        <stop offset="80%" stop-color="rgba(140, 100, 255, .4)"/>
        <stop offset="100%" stop-color="rgba(140, 100, 255, 0)"/>
      </radialGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.6"/>
      </filter>
    </defs>
  `;

  // Шаблонные рисовалки (голова с чертами лица, ухи, руки/ноги базовые) — без прямых углов.
  const baseFace = `
    <g filter="url(#soft)">
      <!-- голова -->
      <path d="M250 60 C 330 60, 380 120, 380 190 C 380 250, 340 290, 250 295 C 160 290, 120 250, 120 190 C 120 120, 170 60, 250 60 Z" fill="url(#skin)"/>
      <!-- уши -->
      <path d="M120 180 L60 130 L85 205 Z" fill="url(#skin)"/>
      <path d="M380 180 L440 130 L415 205 Z" fill="url(#skin)"/>
      <!-- волосы/щетина сверху -->
      <path d="M170 95 Q190 80 220 95 Q250 75 280 95 Q310 80 340 95 L330 125 Q250 100 170 125 Z" fill="#2a4a10" opacity=".55"/>
      <!-- нос -->
      <path d="M250 170 C 265 175, 270 200, 255 220 C 245 225, 235 220, 230 210 C 225 195, 235 172, 250 170 Z" fill="#5e8b2a"/>
      <!-- рот -->
      <path d="M200 240 Q250 270 300 240" stroke="#2d4710" stroke-width="6" stroke-linecap="round" fill="none"/>
      <!-- клыки -->
      <path d="M225 252 L232 275 L238 252 Z" fill="#fff"/>
      <path d="M262 252 L268 275 L275 252 Z" fill="#fff"/>
      <!-- глаза -->
      <ellipse cx="215" cy="175" rx="16" ry="19" fill="#fff"/>
      <ellipse cx="285" cy="175" rx="16" ry="19" fill="#fff"/>
      <ellipse cx="218" cy="180" rx="7" ry="9" fill="#1a1a1a"/>
      <ellipse cx="288" cy="180" rx="7" ry="9" fill="#1a1a1a"/>
      <circle cx="221" cy="176" r="2.5" fill="#fff"/>
      <circle cx="291" cy="176" r="2.5" fill="#fff"/>
      <!-- брови -->
      <path d="M195 150 Q215 140 235 155" stroke="#2a4a10" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M265 155 Q285 140 305 150" stroke="#2a4a10" stroke-width="5" stroke-linecap="round" fill="none"/>
    </g>
  `;

  // Индивидуальные композиции для каждого уровня.
  const scenes = {
    1: () => `
      <!-- Малыш гоблин: пухлый, сидит на попе, в подгузнике -->
      ${defs}
      <!-- попа/подгузник -->
      <ellipse cx="250" cy="430" rx="140" ry="58" fill="#fff" stroke="#dedede" stroke-width="3"/>
      <ellipse cx="250" cy="430" rx="140" ry="58" fill="url(#cloth)" opacity=".1"/>
      <!-- тело -->
      <path d="M170 360 Q250 300 330 360 Q340 400 320 430 Q250 420 180 430 Q160 400 170 360 Z" fill="url(#skin)"/>
      <!-- ручки-ножки -->
      <ellipse cx="140" cy="400" rx="28" ry="38" fill="url(#skin)" transform="rotate(-15 140 400)"/>
      <ellipse cx="360" cy="400" rx="28" ry="38" fill="url(#skin)" transform="rotate(15 360 400)"/>
      <ellipse cx="200" cy="460" rx="30" ry="22" fill="url(#skin)"/>
      <ellipse cx="300" cy="460" rx="30" ry="22" fill="url(#skin)"/>
      ${baseFace}
      <!-- соска -->
      <circle cx="250" cy="275" r="14" fill="#f2c0d0" stroke="#a76a85" stroke-width="3"/>
      <rect x="243" y="265" width="14" height="6" rx="2" fill="#fff" stroke="#a76a85" stroke-width="2"/>
    `,
    2: () => `
      ${defs}
      <!-- Гоблинёнок: стоит, с палкой, коротенькая повязка -->
      <ellipse cx="215" cy="470" rx="24" ry="16" fill="#25430f"/>
      <ellipse cx="285" cy="470" rx="24" ry="16" fill="#25430f"/>
      <path d="M160 330 Q250 280 340 330 L330 440 Q250 450 170 440 Z" fill="url(#skin)"/>
      <!-- повязка -->
      <path d="M165 405 Q250 430 335 405 L330 445 Q250 460 170 445 Z" fill="url(#cloth)"/>
      <!-- ручки -->
      <path d="M160 330 Q110 390 130 435 Q155 440 175 425 Q180 370 190 345 Z" fill="url(#skin)"/>
      <path d="M340 330 Q390 390 370 435 Q345 440 325 425 Q320 370 310 345 Z" fill="url(#skin)"/>
      <!-- палочка в руке -->
      <rect x="372" y="310" width="10" height="140" rx="3" fill="#6b4421" transform="rotate(-12 377 380)"/>
      ${baseFace}
    `,
    3: () => `
      ${defs}
      <!-- Юный собиратель: тунику, мешочек грибов -->
      <ellipse cx="215" cy="472" rx="26" ry="16" fill="#25430f"/>
      <ellipse cx="285" cy="472" rx="26" ry="16" fill="#25430f"/>
      <path d="M160 330 Q250 280 340 330 L335 445 Q250 455 165 445 Z" fill="url(#skin)"/>
      <!-- туника -->
      <path d="M155 345 Q250 320 345 345 L355 440 Q250 460 145 440 Z" fill="#9d7a3a" stroke="#6a4e1a" stroke-width="3"/>
      <path d="M250 320 L250 445" stroke="#6a4e1a" stroke-width="3" opacity=".5"/>
      <!-- ручки -->
      <path d="M160 330 Q110 390 130 435 Q155 440 175 425 Q180 370 190 345 Z" fill="url(#skin)"/>
      <path d="M340 330 Q390 390 370 435 Q345 440 325 425 Q320 370 310 345 Z" fill="url(#skin)"/>
      <!-- мешочек -->
      <ellipse cx="395" cy="395" rx="32" ry="28" fill="#8a5a25" stroke="#3d2810" stroke-width="3"/>
      <path d="M375 370 Q395 360 415 370" stroke="#3d2810" stroke-width="4" fill="none"/>
      <!-- грибочки -->
      <circle cx="388" cy="375" r="8" fill="#c94a4a"/>
      <circle cx="388" cy="375" r="3" fill="#fff" opacity=".7"/>
      <circle cx="402" cy="380" r="6" fill="#d68a3a"/>
      ${baseFace}
    `,
    4: () => `
      ${defs}
      <!-- Разбойник: короткий плащ, повязка на глаз, кинжал в руке -->
      <ellipse cx="215" cy="472" rx="26" ry="16" fill="#1b1208"/>
      <ellipse cx="285" cy="472" rx="26" ry="16" fill="#1b1208"/>
      <!-- штаны -->
      <path d="M175 400 L205 470 L245 470 L240 395 Z" fill="#3a2a18" stroke="#1a1008" stroke-width="3"/>
      <path d="M325 400 L295 470 L255 470 L260 395 Z" fill="#3a2a18" stroke="#1a1008" stroke-width="3"/>
      <!-- тело -->
      <path d="M160 330 Q250 280 340 330 L335 430 Q250 440 165 430 Z" fill="url(#skin)"/>
      <!-- куртка кожаная -->
      <path d="M150 340 Q250 315 350 340 L355 435 Q250 448 145 435 Z" fill="#5b3f22" stroke="#231608" stroke-width="3"/>
      <path d="M250 318 L250 440" stroke="#231608" stroke-width="2"/>
      <!-- шнуровка -->
      <g stroke="#c6a363" stroke-width="2" fill="none">
        <path d="M235 335 L265 345 M235 355 L265 365 M235 375 L265 385 M235 395 L265 405"/>
      </g>
      <!-- пояс с пряжкой -->
      <rect x="150" y="395" width="200" height="14" fill="#221508" rx="4"/>
      <rect x="243" y="394" width="16" height="18" fill="url(#gold)" stroke="#6a4f1a" stroke-width="2" rx="2"/>
      <!-- плечевой ремень через грудь -->
      <path d="M170 330 L300 420" stroke="#c2a56b" stroke-width="8" stroke-linecap="round" opacity=".9"/>
      <path d="M170 330 L300 420" stroke="#3a2a18" stroke-width="2" fill="none" opacity=".6"/>
      <!-- ручки -->
      <path d="M160 330 Q110 390 130 435 Q155 440 175 425 Q180 370 190 345 Z" fill="url(#skin)"/>
      <path d="M340 330 Q390 390 370 435 Q345 440 325 425 Q320 370 310 345 Z" fill="url(#skin)"/>
      ${baseFace}
      <!-- бандана поверх головы (верхняя часть волос) -->
      <path d="M130 110 Q250 70 370 110 L380 145 Q250 130 120 145 Z" fill="#8a1f1f" stroke="#3a0a0a" stroke-width="3"/>
      <!-- узел банданы сбоку -->
      <path d="M380 130 Q420 115 430 150 Q410 165 385 160 Z" fill="#8a1f1f" stroke="#3a0a0a" stroke-width="3"/>
      <path d="M380 155 Q395 175 385 190 Q365 180 375 160 Z" fill="#8a1f1f" stroke="#3a0a0a" stroke-width="2"/>
      <!-- повязка на правый глаз -->
      <rect x="200" y="170" width="45" height="14" fill="#1a1a1a" rx="2"/>
      <path d="M198 177 L155 195" stroke="#1a1a1a" stroke-width="6" stroke-linecap="round"/>
      <path d="M245 177 L280 195" stroke="#1a1a1a" stroke-width="6" stroke-linecap="round"/>
      <!-- ухмылка: перекрываем стандартный рот клыком побольше -->
      <path d="M225 252 L230 282 L238 252 Z" fill="#fff"/>
      <!-- кинжал в правой руке -->
      <rect x="355" y="410" width="12" height="48" fill="#3d2810" stroke="#1f1608" stroke-width="2" rx="2"/>
      <rect x="345" y="408" width="32" height="8" fill="#6a4f1a" stroke="#3d2810" stroke-width="2" rx="2"/>
      <path d="M349 408 L373 408 L361 335 Z" fill="url(#armor)" stroke="#22252e" stroke-width="2"/>
      <path d="M361 360 L361 400" stroke="#5a606a" stroke-width="1.5" opacity=".6"/>
    `,
    5: () => `
      ${defs}
      <!-- Охотник: перо в волосах, лук за спиной -->
      <ellipse cx="215" cy="475" rx="28" ry="16" fill="#25430f"/>
      <ellipse cx="285" cy="475" rx="28" ry="16" fill="#25430f"/>
      <path d="M160 330 Q250 280 340 330 L335 445 Q250 455 165 445 Z" fill="url(#skin)"/>
      <!-- кожаная жилетка с заклёпками -->
      <path d="M155 340 Q250 315 345 340 L350 445 Q250 460 150 445 Z" fill="#7a4a22" stroke="#3d2810" stroke-width="3"/>
      <g fill="#cdd4de">
        <circle cx="190" cy="370" r="4"/><circle cx="220" cy="360" r="4"/>
        <circle cx="280" cy="360" r="4"/><circle cx="310" cy="370" r="4"/>
        <circle cx="250" cy="400" r="4"/>
      </g>
      <!-- ручки -->
      <path d="M160 330 Q110 390 130 435 Q155 440 175 425 Q180 370 190 345 Z" fill="url(#skin)"/>
      <path d="M340 330 Q390 390 370 435 Q345 440 325 425 Q320 370 310 345 Z" fill="url(#skin)"/>
      ${baseFace}
      <!-- перо в волосах -->
      <path d="M175 80 Q200 30 225 75 Q210 90 195 85 Q185 92 175 80 Z" fill="#d94a4a" stroke="#7a1f1f" stroke-width="2"/>
      <!-- лук за плечом -->
      <path d="M105 250 Q90 340 130 435" stroke="#6a4421" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M105 250 L130 435" stroke="#eee" stroke-width="2" fill="none" opacity=".8"/>
    `,
    6: () => `
      ${defs}
      <!-- Воин: кольчуга, щит, меч -->
      <ellipse cx="215" cy="475" rx="28" ry="16" fill="#25430f"/>
      <ellipse cx="285" cy="475" rx="28" ry="16" fill="#25430f"/>
      <path d="M160 330 Q250 280 340 330 L335 445 Q250 455 165 445 Z" fill="url(#skin)"/>
      <!-- кольчуга: точки на серебристой подложке -->
      <path d="M150 340 Q250 315 350 340 L355 445 Q250 460 145 445 Z" fill="url(#armor)" stroke="#2b2f3a" stroke-width="3"/>
      <g fill="#2b2f3a" opacity=".4">
        ${Array.from({length: 60}).map((_, i) => {
          const x = 155 + (i % 10) * 20 + ((Math.floor(i/10)%2)?10:0);
          const y = 350 + Math.floor(i/10) * 18;
          return `<circle cx="${x}" cy="${y}" r="2.5"/>`;
        }).join('')}
      </g>
      <!-- ручки -->
      <path d="M160 330 Q110 390 130 435 Q155 440 175 425 Q180 370 190 345 Z" fill="url(#skin)"/>
      <path d="M340 330 Q390 390 370 435 Q345 440 325 425 Q320 370 310 345 Z" fill="url(#skin)"/>
      ${baseFace}
      <!-- шлем -->
      <path d="M140 150 Q250 70 360 150 L365 210 Q250 180 135 210 Z" fill="url(#armor)" stroke="#2b2f3a" stroke-width="3"/>
      <rect x="222" y="155" width="56" height="12" fill="#2b2f3a"/>
      <!-- щит -->
      <path d="M95 340 L165 340 L165 455 Q130 475 95 455 Z" fill="#b23a3a" stroke="#5d1919" stroke-width="4"/>
      <path d="M130 352 L130 455 M105 385 L155 385" stroke="#f4d15a" stroke-width="5"/>
      <!-- меч -->
      <rect x="355" y="360" width="10" height="36" fill="#3d2810"/>
      <rect x="340" y="354" width="40" height="10" fill="#3d2810"/>
      <path d="M350 360 L370 360 L360 265 Z" fill="url(#armor)" stroke="#22252e" stroke-width="2"/>
    `,
    7: () => `
      ${defs}
      <!-- Ветеран: полный доспех, шрам, молот -->
      <ellipse cx="215" cy="478" rx="30" ry="16" fill="#25430f"/>
      <ellipse cx="285" cy="478" rx="30" ry="16" fill="#25430f"/>
      <path d="M160 330 Q250 280 340 330 L335 445 Q250 455 165 445 Z" fill="url(#skinDark)"/>
      <!-- плитный доспех -->
      <path d="M140 340 Q250 310 360 340 L365 445 Q250 462 135 445 Z" fill="url(#armor)" stroke="#22252e" stroke-width="4"/>
      <path d="M250 320 L250 455" stroke="#22252e" stroke-width="3"/>
      <path d="M180 360 Q250 375 320 360" stroke="#22252e" stroke-width="3" fill="none"/>
      <path d="M175 400 Q250 415 325 400" stroke="#22252e" stroke-width="3" fill="none"/>
      <!-- наплечники -->
      <path d="M150 320 Q130 345 150 380 Q170 345 170 320 Z" fill="url(#armor)" stroke="#22252e" stroke-width="3"/>
      <path d="M350 320 Q370 345 350 380 Q330 345 330 320 Z" fill="url(#armor)" stroke="#22252e" stroke-width="3"/>
      <!-- ручки -->
      <path d="M150 330 Q100 400 120 445 Q150 450 175 430 Q180 370 190 345 Z" fill="url(#skinDark)"/>
      <path d="M350 330 Q400 400 380 445 Q350 450 325 430 Q320 370 310 345 Z" fill="url(#skinDark)"/>
      ${baseFace}
      <!-- шрам над глазом -->
      <path d="M205 135 L225 175" stroke="#3a1a0a" stroke-width="4" fill="none"/>
      <!-- шлем с рогами -->
      <path d="M130 150 Q250 70 370 150 L375 215 Q250 185 125 215 Z" fill="url(#darkArmor)" stroke="#0e0a1a" stroke-width="3"/>
      <path d="M140 160 Q110 110 130 70 Q150 80 160 155 Z" fill="#0e0a1a"/>
      <path d="M360 160 Q390 110 370 70 Q350 80 340 155 Z" fill="#0e0a1a"/>
      <!-- молот -->
      <rect x="365" y="360" width="12" height="110" fill="#4a2f14"/>
      <rect x="345" y="340" width="55" height="40" rx="6" fill="url(#armor)" stroke="#22252e" stroke-width="3"/>
    `,
    8: () => `
      ${defs}
      <!-- Шаман: роба, посох с черепом, светящиеся глаза, перья -->
      <!-- аура -->
      <circle cx="250" cy="280" r="240" fill="url(#magic)" opacity=".55"/>
      <ellipse cx="215" cy="478" rx="30" ry="16" fill="#25430f"/>
      <ellipse cx="285" cy="478" rx="30" ry="16" fill="#25430f"/>
      <!-- роба -->
      <path d="M120 340 Q250 290 380 340 L400 475 L100 475 Z" fill="#55327a" stroke="#1d0f34" stroke-width="4"/>
      <path d="M250 310 L250 475" stroke="#1d0f34" stroke-width="3"/>
      <g fill="#f2c34a" opacity=".8">
        <circle cx="200" cy="420" r="4"/><circle cx="300" cy="420" r="4"/>
        <circle cx="180" cy="445" r="3"/><circle cx="320" cy="445" r="3"/>
        <circle cx="250" cy="395" r="5"/>
      </g>
      <!-- ручки -->
      <path d="M150 330 Q90 380 110 440 Q150 450 170 430 Q180 370 190 345 Z" fill="url(#skinDark)"/>
      <path d="M350 330 Q410 380 390 440 Q350 450 330 430 Q320 370 310 345 Z" fill="url(#skinDark)"/>
      ${baseFace}
      <!-- светящиеся глаза -->
      <circle cx="218" cy="180" r="11" fill="#8cf0ff" opacity=".95"/>
      <circle cx="288" cy="180" r="11" fill="#8cf0ff" opacity=".95"/>
      <!-- перья сверху -->
      <path d="M170 80 Q190 20 210 80 Q195 95 180 90 Z" fill="#d94a4a" stroke="#7a1f1f" stroke-width="2"/>
      <path d="M230 65 Q250 5 270 65 Q255 80 240 75 Z" fill="#f2c34a" stroke="#7a5a14" stroke-width="2"/>
      <path d="M290 80 Q310 20 330 80 Q315 95 300 90 Z" fill="#3eb3ff" stroke="#13457a" stroke-width="2"/>
      <!-- посох с черепом -->
      <rect x="420" y="260" width="10" height="220" fill="#4a2f14"/>
      <circle cx="425" cy="250" r="22" fill="#f2ecd4" stroke="#3a3320" stroke-width="3"/>
      <circle cx="420" cy="248" r="4" fill="#1a1a1a"/><circle cx="432" cy="248" r="4" fill="#1a1a1a"/>
      <path d="M418 260 L422 268 M424 260 L428 268 M430 260 L434 268" stroke="#3a3320" stroke-width="2"/>
      <circle cx="425" cy="235" r="8" fill="#8cf0ff" opacity=".7"/>
    `,
    9: () => `
      ${defs}
      <!-- Вождь: мех, рогатый шлем, тату, большой топор -->
      <ellipse cx="215" cy="478" rx="32" ry="16" fill="#0a0610"/>
      <ellipse cx="285" cy="478" rx="32" ry="16" fill="#0a0610"/>
      <path d="M160 330 Q250 280 340 330 L335 445 Q250 455 165 445 Z" fill="url(#skinDark)"/>
      <!-- тату на лбу -->
      <!-- меховые плечи -->
      <ellipse cx="155" cy="340" rx="46" ry="30" fill="#3a2a18" stroke="#1a1008" stroke-width="3"/>
      <ellipse cx="345" cy="340" rx="46" ry="30" fill="#3a2a18" stroke="#1a1008" stroke-width="3"/>
      <g stroke="#7a5428" stroke-width="2" fill="none">
        <path d="M125 340 L120 370 M145 345 L140 380 M165 345 L165 380"/>
        <path d="M355 340 L360 370 M335 345 L340 380 M325 345 L325 380"/>
      </g>
      <!-- доспех -->
      <path d="M150 355 Q250 330 350 355 L355 455 Q250 465 145 455 Z" fill="url(#darkArmor)" stroke="#0a0610" stroke-width="4"/>
      <path d="M220 355 L250 385 L280 355" stroke="url(#gold)" stroke-width="5" fill="none"/>
      <!-- ручки -->
      <path d="M150 330 Q90 380 110 440 Q150 450 170 430 Q180 370 190 345 Z" fill="url(#skinDark)"/>
      <path d="M350 330 Q410 380 390 440 Q350 450 330 430 Q320 370 310 345 Z" fill="url(#skinDark)"/>
      ${baseFace}
      <!-- шрам -->
      <path d="M200 130 L225 170" stroke="#3a1a0a" stroke-width="4" fill="none"/>
      <path d="M275 135 L300 160" stroke="#3a1a0a" stroke-width="3" fill="none"/>
      <!-- рогатый шлем -->
      <path d="M120 155 Q250 60 380 155 L385 220 Q250 185 115 220 Z" fill="url(#darkArmor)" stroke="#0a0610" stroke-width="4"/>
      <rect x="222" y="160" width="56" height="12" fill="#0a0610"/>
      <!-- рога -->
      <path d="M135 170 Q90 140 70 70 Q105 85 140 160 Z" fill="#f7e2b2" stroke="#6a4f1a" stroke-width="3"/>
      <path d="M365 170 Q410 140 430 70 Q395 85 360 160 Z" fill="#f7e2b2" stroke="#6a4f1a" stroke-width="3"/>
      <!-- топор двуручный -->
      <rect x="395" y="220" width="14" height="260" fill="#3d2810"/>
      <path d="M360 240 Q330 200 400 180 Q470 200 440 240 Q410 265 400 260 Q390 265 360 240 Z" fill="url(#armor)" stroke="#22252e" stroke-width="3"/>
    `,
    10: () => `
      ${defs}
      <!-- Король гоблинов: роба, корона, скипетр, золотое сияние -->
      <circle cx="250" cy="260" r="260" fill="url(#magic)" opacity=".75"/>
      <ellipse cx="215" cy="478" rx="34" ry="16" fill="#0a0610"/>
      <ellipse cx="285" cy="478" rx="34" ry="16" fill="#0a0610"/>
      <path d="M160 330 Q250 280 340 330 L335 445 Q250 455 165 445 Z" fill="url(#skinDark)"/>
      <!-- роба -->
      <path d="M100 345 Q250 290 400 345 L420 475 L80 475 Z" fill="#8a1f1f" stroke="#3a0a0a" stroke-width="4"/>
      <path d="M250 310 L250 475" stroke="#3a0a0a" stroke-width="3"/>
      <g fill="url(#gold)" stroke="#6a4f1a" stroke-width="2">
        <circle cx="160" cy="400" r="7"/>
        <circle cx="200" cy="430" r="6"/>
        <circle cx="250" cy="405" r="8"/>
        <circle cx="300" cy="430" r="6"/>
        <circle cx="340" cy="400" r="7"/>
      </g>
      <!-- меховой воротник -->
      <path d="M150 345 Q180 335 210 345 Q240 330 270 345 Q300 335 330 345 Q360 340 370 360 Q250 375 130 360 Q140 340 150 345 Z" fill="#f7f3e8" stroke="#b0a896" stroke-width="3"/>
      <!-- ручки -->
      <path d="M150 330 Q90 380 110 440 Q150 450 170 430 Q180 370 190 345 Z" fill="url(#skinDark)"/>
      <path d="M350 330 Q410 380 390 440 Q350 450 330 430 Q320 370 310 345 Z" fill="url(#skinDark)"/>
      ${baseFace}
      <!-- корона -->
      <g stroke="#6a4f1a" stroke-width="3" stroke-linejoin="round">
        <path d="M140 150 L170 80 L205 140 L250 70 L295 140 L330 80 L360 150 L350 180 L150 180 Z" fill="url(#gold)"/>
        <circle cx="170" cy="90" r="8" fill="#d94a4a"/>
        <circle cx="250" cy="82" r="9" fill="#3eb3ff"/>
        <circle cx="330" cy="90" r="8" fill="#78d94a"/>
      </g>
      <!-- скипетр -->
      <rect x="418" y="230" width="10" height="260" fill="url(#gold)" stroke="#6a4f1a" stroke-width="2"/>
      <circle cx="423" cy="220" r="24" fill="url(#gold)" stroke="#6a4f1a" stroke-width="3"/>
      <circle cx="423" cy="220" r="10" fill="#8a2be2"/>
      <circle cx="423" cy="220" r="4" fill="#fff" opacity=".8"/>
    `,
  };

  const content = scenes[level] ? scenes[level]() : scenes[1]();
  return `<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${content}</svg>`;
}

// ---- Стейт / расчёт ----
const state = load();
let perClick = 0, perSec = 0;

function recalcRates() {
  let click = 1, idle = 0;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] || 0;
    if (!lv) continue;
    if (u.kind === 'click') click += u.perLevel * lv; else idle += u.perLevel * lv;
  }
  perClick = click;
  perSec = Math.round(idle * 10) / 10;
}

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const gameEl = $('#game');
const coinAmountEl = $('#coinAmount');
const rateNoteEl = $('#rateNote');
const levelLabelEl = $('#levelLabel');
const levelProgressEl = $('#levelProgress');
const levelProgressTextEl = $('#levelProgressText');
const goblinNameEl = $('#goblinName');
const upgradesEl = $('#upgrades');
const stageEl = $('#stage');
const goblinWrapEl = $('#goblinWrap');
const goblinEl = $('#goblin');
const floatersEl = $('#floaters');
const particlesEl = $('#particles');
const toastEl = $('#toast');
const settingsBtn = $('#settingsBtn');
const settingsModal = $('#settingsModal');
const settingsClose = $('#settingsClose');
const sfxToggle = $('#sfxToggle');
const musicToggle = $('#musicToggle');
const resetBtn = $('#resetBtn');
const introOverlay = $('#introOverlay');
const introGoBtn = $('#introGo');

let introOpen = true;
function fmtRate(v) {
  if (v === 0) return '0';
  if (v < 10) return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return fmt(v);
}

let currentGoblinLevel = 0;
function setGoblinLevel(lv) {
  if (lv === currentGoblinLevel) return;
  currentGoblinLevel = lv;
  goblinEl.innerHTML = goblinSvg(lv);
}

function renderUpgrades() {
  upgradesEl.innerHTML = '';
  for (const u of UPGRADES) {
    const el = document.createElement('button');
    el.className = 'upgrade';
    el.type = 'button';
    el.dataset.id = u.id;
    const effectText = u.kind === 'click'
      ? `+${u.perLevel} к клику`
      : `+${u.perLevel} в секунду`;
    el.innerHTML = `
      <div class="up-main">
        <div class="up-title">${u.title}</div>
        <div class="up-desc">${u.desc}</div>
        <div class="up-effect">${effectText}</div>
      </div>
      <div class="up-side">
        <div class="up-icon">${u.icon}</div>
        <div class="up-level" data-level>Ур. 0</div>
      </div>
      <div class="up-cost"><span data-cost>0</span></div>
    `;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); tryBuy(u.id); });
    upgradesEl.appendChild(el);
  }
  updateUpgradesState();
}

function updateUpgradesState() {
  const curLv = getCurrentLevel();
  for (const el of upgradesEl.children) {
    const u = UPGRADES.find(x => x.id === el.dataset.id);
    if (!u) continue;
    const lvl = state.levels[u.id] || 0;
    const cost = upgradeCost(u, lvl);
    const locked = curLv < u.unlockLevel;
    el.classList.toggle('locked', locked);
    el.dataset.unlock = locked ? `Откроется на ур. ${u.unlockLevel}` : '';

    el.querySelector('[data-cost]').textContent = fmt(cost);
    el.querySelector('[data-level]').textContent = `Ур. ${lvl}`;

    const p = Math.min(1, state.coins / cost);
    el.style.setProperty('--p', p.toFixed(3));
    el.classList.toggle('affordable', !locked && state.coins >= cost);
  }
}

function tryBuy(id) {
  const u = UPGRADES.find(x => x.id === id);
  if (!u) return;
  const curLv = getCurrentLevel();
  if (curLv < u.unlockLevel) { Sound.fail(); return; }
  const lvl = state.levels[u.id] || 0;
  const cost = upgradeCost(u, lvl);
  if (state.coins < cost) { Sound.fail(); flashToast('Не хватает монет'); return; }
  state.coins -= cost;
  state.levels[u.id] = lvl + 1;
  recalcRates();
  Sound.purchase();
  flashToast(`${u.title} → Ур. ${lvl + 1}`);
  save();
  refreshHud();
  updateUpgradesState();
}

function getCurrentLevel() { return levelForXp(state.totalCoins) + 1; }

let lastDisplayedLevel = 0;
function refreshHud() {
  coinAmountEl.textContent = fmt(state.coins);
  rateNoteEl.textContent = `${fmtRate(perSec)} / сек`;

  const lp = levelProgress(state.totalCoins);
  const lv = lp.idx + 1;
  const meta = LEVELS[lp.idx];
  goblinNameEl.textContent = meta.title;
  levelLabelEl.textContent = `Уровень ${lv}`;
  gameEl.dataset.biome = meta.biome;

  if (lp.idx >= LEVELS.length - 1) {
    levelProgressEl.style.width = '100%';
    levelProgressTextEl.textContent = 'МАКС';
  } else {
    levelProgressEl.style.width = (lp.pct * 100).toFixed(1) + '%';
    levelProgressTextEl.textContent = `${fmt(state.totalCoins - lp.cur)} / ${fmt(lp.next - lp.cur)}`;
  }

  if (lastDisplayedLevel && lv > lastDisplayedLevel) triggerLevelUp(lv);
  lastDisplayedLevel = lv;
  setGoblinLevel(lv);
}

function triggerLevelUp(lv) {
  Sound.levelUp();
  flashToast(`Новый уровень! ${LEVELS[lv - 1].title}`);
  gameEl.classList.remove('levelup');
  void gameEl.offsetWidth;
  gameEl.classList.add('levelup');
  if (window.YSDK) window.YSDK.showFullscreen();
}

// ---- Клик ----
function doClick(clientX, clientY, burstCount) {
  Sound.ensure(); Sound.resume();
  if (state.music) Sound.startMusic();

  const gain = perClick;
  state.coins += gain;
  state.totalCoins += gain;
  Sound.coin();
  bouncedGoblin();
  spawnCoinsAt(clientX, clientY, gain, burstCount);
  save();
  refreshHud();
  updateUpgradesState();
}

function bouncedGoblin() {
  goblinWrapEl.classList.remove('clicked');
  void goblinWrapEl.offsetWidth;
  goblinWrapEl.classList.add('clicked');
  setTimeout(() => goblinWrapEl.classList.remove('clicked'), 340);
}

function spawnCoinsAt(clientX, clientY, gain, burst) {
  // Координаты в пространстве #game
  const gameRect = gameEl.getBoundingClientRect();
  const cx = clientX - gameRect.left;
  const cy = clientY - gameRect.top;

  const f = document.createElement('div');
  f.className = 'floater';
  f.textContent = `+${fmt(gain)}`;
  f.style.left = cx + 'px'; f.style.top = cy + 'px';
  floatersEl.appendChild(f);
  setTimeout(() => f.remove(), 950);

  const count = burst ?? (5 + Math.min(10, Math.floor(Math.log2(Math.max(2, gain)))));
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'coin-particle';
    const dir = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 90;
    const dx = Math.cos(dir) * dist;
    const dy = Math.sin(dir) * dist + 50;
    const rot = (Math.random() * 720 - 360) + 'deg';
    p.style.left = cx + 'px'; p.style.top = cy + 'px';
    p.style.setProperty('--dx', dx.toFixed(1) + 'px');
    p.style.setProperty('--dy', dy.toFixed(1) + 'px');
    p.style.setProperty('--rot', rot);
    particlesEl.appendChild(p);
    setTimeout(() => p.remove(), 820);
  }
}

// Глобальный обработчик: любой клик по экрану, кроме элементов меню.
function isInteractive(target) {
  if (!target) return false;
  return !!target.closest('.upgrade, .icon-btn, .coin-pill, .modal, .toggle, .btn, #upgrades, .intro-backdrop, .intro-card');
}

function onScreenClick(ev) {
  if (introOpen) return;
  if (isInteractive(ev.target)) return;
  if (!settingsModal.hidden) return;
  doClick(ev.clientX, ev.clientY, null);
}

function onSpaceClick() {
  if (introOpen || !settingsModal.hidden) return;
  const x = 120 + Math.random() * (window.innerWidth - 240);
  const y = 120 + Math.random() * (window.innerHeight - 240);
  doClick(x, y, 10 + Math.floor(Math.random() * 6));
}

function hideIntro() {
  if (!introOpen) return;
  introOpen = false;
  introOverlay.classList.add('hidden');
  Sound.ensure(); Sound.resume();
  if (state.music) Sound.startMusic();
  setTimeout(() => { introOverlay.style.display = 'none'; }, 600);
}

// ---- Тост ----
let toastTimer = 0;
function flashToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

// ---- Idle цикл ----
let lastTick = performance.now();
function tick(now) {
  const dt = Math.min(1, (now - lastTick) / 1000);
  lastTick = now;
  if (perSec > 0) {
    const gain = perSec * dt;
    state.coins += gain;
    state.totalCoins += gain;
  }
  refreshHud();
  updateUpgradesState();
  requestAnimationFrame(tick);
}
setInterval(save, 5000);

// ---- Настройки ----
function openSettings() { settingsModal.hidden = false; }
function closeSettings() { settingsModal.hidden = true; }

function applySettings() {
  Sound.setSfx(state.sfx);
  Sound.setMusic(state.music);
  sfxToggle.checked = state.sfx;
  musicToggle.checked = state.music;
}

function resetProgress() {
  if (!confirm('Сбросить весь прогресс?')) return;
  const keepSettings = { sfx: state.sfx, music: state.music };
  const def = makeDefaultState();
  Object.assign(state, def, keepSettings);
  recalcRates();
  save();
  lastDisplayedLevel = 1;
  refreshHud();
  renderUpgrades();
  flashToast('Прогресс сброшен');
}

// ---- Init ----
function init() {
  recalcRates();
  renderUpgrades();
  lastDisplayedLevel = getCurrentLevel();
  refreshHud();
  setGoblinLevel(getCurrentLevel());
  applySettings();

  // Настройки
  settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  settingsClose.addEventListener('click', (e) => { e.stopPropagation(); closeSettings(); });
  settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });
  sfxToggle.addEventListener('change', () => { state.sfx = sfxToggle.checked; Sound.setSfx(state.sfx); save(); });
  musicToggle.addEventListener('change', () => {
    state.music = musicToggle.checked;
    Sound.ensure(); Sound.resume();
    Sound.setMusic(state.music);
    save();
  });
  resetBtn.addEventListener('click', (e) => { e.stopPropagation(); resetProgress(); });

  // Приветственный оверлей
  introGoBtn.addEventListener('click', (e) => { e.stopPropagation(); hideIntro(); });

  // Клики по всему экрану
  window.addEventListener('click', onScreenClick);
  // Тач: дублируем, чтобы анимации ловили точку касания
  window.addEventListener('touchstart', (ev) => {
    if (introOpen) return;
    if (isInteractive(ev.target)) return;
    if (!settingsModal.hidden) return;
    const t = ev.touches[0]; if (!t) return;
    doClick(t.clientX, t.clientY, null);
    ev.preventDefault();
  }, { passive: false });

  // Пробел / Enter / Escape
  window.addEventListener('keydown', (ev) => {
    if (introOpen && (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'NumpadEnter')) {
      ev.preventDefault();
      hideIntro();
      return;
    }
    if (ev.code === 'Space' && !ev.repeat) {
      ev.preventDefault();
      onSpaceClick();
    } else if (ev.code === 'Escape') {
      closeSettings();
    }
  });

  // Yandex SDK
  if (window.YSDK) window.YSDK.init().then(() => window.YSDK.gameReady()).catch(() => {});

  requestAnimationFrame(tick);
}
document.addEventListener('DOMContentLoaded', init);
})();
