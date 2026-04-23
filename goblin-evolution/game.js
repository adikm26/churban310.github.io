// ============================================================
//  Эволюция Гоблина — основной код игры.
//  Весь рендер — это HTML + SVG + CSS. Никаких тяжёлых библиотек.
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

// ---- Уровни эволюции ----
// points -> level. Порог роста по очкам (очки = накопленные монеты суммарно, не уменьшаются).
const LEVELS = [
  { level: 1, xp: 0,       title: 'Малыш гоблин' },
  { level: 2, xp: 500,     title: 'Подросток' },
  { level: 3, xp: 5000,    title: 'Юный воин' },
  { level: 4, xp: 50000,   title: 'Взрослый гоблин' },
  { level: 5, xp: 500000,  title: 'Король гоблинов' },
];

function levelForXp(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
  return idx; // 0..4
}
function levelProgress(xp) {
  const idx = levelForXp(xp);
  if (idx >= LEVELS.length - 1) return { idx, pct: 1, cur: xp, next: xp };
  const cur = LEVELS[idx].xp;
  const next = LEVELS[idx + 1].xp;
  return { idx, pct: (xp - cur) / (next - cur), cur, next };
}

// ---- Апгрейды ----
// kind: 'click' (+N к каждому клику) или 'idle' (+N в секунду)
// cost(n) -> стоимость следующего (n-го) апа
// effect(n) -> бонус от n-го уровня апгрейда
const UPGRADES = [
  {
    id: 'pickaxe', icon: '⛏️', title: 'Кирка', desc: 'Прочная кирка увеличивает добычу за клик.',
    kind: 'click', unlockLevel: 1,
    costBase: 10, costGrowth: 1.15,
    perLevel: 1,
  },
  {
    id: 'cunning', icon: '🗿', title: 'Гоблинская хитрость', desc: 'Автоматический сбор монет — они падают сами.',
    kind: 'idle', unlockLevel: 1,
    costBase: 25, costGrowth: 1.18,
    perLevel: 0.5,
  },
  {
    id: 'torch', icon: '🔥', title: 'Факел в пещере', desc: 'Свет помогает находить больше самоцветов за клик.',
    kind: 'click', unlockLevel: 2,
    costBase: 150, costGrowth: 1.17,
    perLevel: 3,
  },
  {
    id: 'bat', icon: '🦇', title: 'Ручная летучая мышь', desc: 'Приносит монетки из тёмных уголков пещеры.',
    kind: 'idle', unlockLevel: 2,
    costBase: 400, costGrowth: 1.2,
    perLevel: 2,
  },
  {
    id: 'dagger', icon: '🗡️', title: 'Кинжал удачи', desc: 'Клинок, от которого монеты сами разлетаются.',
    kind: 'click', unlockLevel: 3,
    costBase: 2000, costGrowth: 1.18,
    perLevel: 12,
  },
  {
    id: 'mine', icon: '⚒️', title: 'Золотая шахта', desc: 'Мини-шахта с нанятыми кузенами-шахтёрами.',
    kind: 'idle', unlockLevel: 3,
    costBase: 6500, costGrowth: 1.2,
    perLevel: 10,
  },
  {
    id: 'totem', icon: '🗿', title: 'Тотем шамана', desc: 'Ритуальная магия усиливает удары по сундукам.',
    kind: 'click', unlockLevel: 4,
    costBase: 40000, costGrowth: 1.19,
    perLevel: 60,
  },
  {
    id: 'dragon', icon: '🐉', title: 'Прирученный дракон', desc: 'Сидит на горе золота и отдаёт часть каждую секунду.',
    kind: 'idle', unlockLevel: 4,
    costBase: 120000, costGrowth: 1.2,
    perLevel: 80,
  },
  {
    id: 'artifact', icon: '🔮', title: 'Древний артефакт', desc: 'Щелчок артефакта — и монеты льются рекой.',
    kind: 'click', unlockLevel: 5,
    costBase: 900000, costGrowth: 1.2,
    perLevel: 500,
  },
  {
    id: 'throne', icon: '👑', title: 'Трон короля гоблинов', desc: 'Пассивный доход, достойный венценосной особы.',
    kind: 'idle', unlockLevel: 5,
    costBase: 2500000, costGrowth: 1.2,
    perLevel: 700,
  },
];

function upgradeCost(up, n) {
  return Math.floor(up.costBase * Math.pow(up.costGrowth, n));
}

// ---- Сейв ----
const SAVE_KEY = 'goblinEvolution.save.v1';
function makeDefaultState() {
  const levels = {};
  for (const u of UPGRADES) levels[u.id] = 0;
  return {
    coins: 0,
    totalCoins: 0,   // для уровня (очки)
    levels,
    muted: false,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return makeDefaultState();
    const data = JSON.parse(raw);
    const def = makeDefaultState();
    return { ...def, ...data, levels: { ...def.levels, ...(data.levels || {}) } };
  } catch (_) {
    return makeDefaultState();
  }
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) {}
}

// ---- Звук (синтез через Web Audio) ----
const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let ambientStarted = false;
  let ambientNodes = [];

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
  }
  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.55;
  }

  function envTone({ freq = 660, dur = 0.18, type = 'sine', gain = 0.3, freqEnd = null, delay = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function coin() {
    ensure(); if (!ctx) return; resume();
    envTone({ freq: 1200, freqEnd: 1800, dur: 0.09, type: 'triangle', gain: 0.22 });
    envTone({ freq: 1500, freqEnd: 2400, dur: 0.08, type: 'sine', gain: 0.15, delay: 0.04 });
  }
  function purchase() {
    ensure(); if (!ctx) return; resume();
    envTone({ freq: 520, freqEnd: 880, dur: 0.16, type: 'square', gain: 0.18 });
    envTone({ freq: 880, freqEnd: 1320, dur: 0.14, type: 'triangle', gain: 0.14, delay: 0.1 });
  }
  function fail() {
    ensure(); if (!ctx) return; resume();
    envTone({ freq: 320, freqEnd: 180, dur: 0.18, type: 'sawtooth', gain: 0.12 });
  }
  function levelUp() {
    ensure(); if (!ctx) return; resume();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => envTone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.22, delay: i * 0.1 }));
    envTone({ freq: 1318.5, dur: 0.5, type: 'sine', gain: 0.18, delay: 0.55 });
  }

  function startAmbient() {
    ensure(); if (!ctx || ambientStarted) return; ambientStarted = true;
    // Лёгкая подушка из двух нот с медленной модуляцией.
    const g = ctx.createGain(); g.gain.value = 0.05; g.connect(master);
    const freqs = [196, 261.63]; // G3, C4
    for (const f of freqs) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
      lfo.frequency.value = 0.08 + Math.random() * 0.12; lfoG.gain.value = 2.5;
      lfo.connect(lfoG).connect(o.frequency);
      o.connect(g); o.start(); lfo.start();
      ambientNodes.push(o, lfo);
    }
  }

  return { coin, purchase, fail, levelUp, setMuted, ensure, resume, startAmbient };
})();

// ---- Стейт ----
const state = load();
let perClick = 0;
let perSec = 0;

function recalcRates() {
  let click = 1, idle = 0;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] || 0;
    if (!lv) continue;
    if (u.kind === 'click') click += u.perLevel * lv;
    else idle += u.perLevel * lv;
  }
  perClick = click;
  perSec = Math.round(idle * 10) / 10;
}

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const gameEl = $('#game');
const coinAmountEl = $('#coinAmount');
const perClickEl = $('#perClick');
const perSecEl = $('#perSec');
const levelLabelEl = $('#levelLabel');
const levelProgressEl = $('#levelProgress');
const levelProgressTextEl = $('#levelProgressText');
const soundToggleEl = $('#soundToggle');
const upgradesEl = $('#upgrades');
const stageEl = $('#stage');
const goblinWrapEl = $('#goblinWrap');
const goblinEl = $('#goblin');
const goblinLevelEl = $('#goblinLevel');
const floatersEl = $('#floaters');
const particlesEl = $('#particles');
const toastEl = $('#toast');

// ---- Goblin SVG по уровням ----
// Все уровни — один SVG с viewBox 0 0 260 300. Части шлема/оружия/одежды
// показываются в зависимости от уровня персонажа через data-level на родителе.
function goblinSvg() {
  return `
  <svg viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <radialGradient id="skin" cx="40%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#b6d36a"/>
        <stop offset="55%" stop-color="#6ea03b"/>
        <stop offset="100%" stop-color="#3d6a1f"/>
      </radialGradient>
      <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#a16a3d"/>
        <stop offset="100%" stop-color="#6b4121"/>
      </linearGradient>
      <linearGradient id="armor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9aa5b1"/>
        <stop offset="100%" stop-color="#4a5260"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffe16a"/>
        <stop offset="100%" stop-color="#b87d00"/>
      </linearGradient>
    </defs>

    <!-- тело (делается меньше на низких уровнях через scale родителя) -->
    <g class="g-body">
      <!-- ноги -->
      <ellipse cx="108" cy="268" rx="18" ry="14" fill="#3d6a1f"/>
      <ellipse cx="152" cy="268" rx="18" ry="14" fill="#3d6a1f"/>
      <!-- торс -->
      <path d="M80 210 Q130 170 180 210 L175 262 Q130 280 85 262 Z" fill="url(#skin)"/>
      <!-- повязка / одежда (уровень 2+) -->
      <g class="g-cloth">
        <path d="M82 228 Q130 242 178 228 L176 258 Q130 272 84 258 Z" fill="url(#cloth)"/>
      </g>
      <!-- броня (уровень 4+) -->
      <g class="g-armor">
        <path d="M90 206 Q130 186 170 206 L168 240 Q130 252 92 240 Z" fill="url(#armor)"/>
        <circle cx="130" cy="218" r="5" fill="#d8dde5"/>
      </g>

      <!-- руки -->
      <g class="g-arm-left">
        <path d="M82 210 Q60 230 60 255 Q72 262 86 255 Q90 232 98 220 Z" fill="url(#skin)"/>
      </g>
      <g class="g-arm-right">
        <path d="M178 210 Q200 230 200 255 Q188 262 174 255 Q170 232 162 220 Z" fill="url(#skin)"/>
      </g>

      <!-- голова -->
      <g class="g-head">
        <!-- уши -->
        <path d="M66 150 L40 130 L58 160 Z" fill="url(#skin)"/>
        <path d="M194 150 L220 130 L202 160 Z" fill="url(#skin)"/>
        <!-- лицо -->
        <ellipse cx="130" cy="150" rx="60" ry="55" fill="url(#skin)"/>
        <!-- клыки -->
        <path d="M118 178 L122 192 L126 178 Z" fill="#fff"/>
        <path d="M134 178 L138 192 L142 178 Z" fill="#fff"/>
        <!-- нос -->
        <ellipse cx="130" cy="160" rx="8" ry="12" fill="#5e8c2a"/>
        <!-- глаза -->
        <g class="g-eyes">
          <ellipse cx="112" cy="140" rx="9" ry="10" fill="#fff"/>
          <ellipse cx="148" cy="140" rx="9" ry="10" fill="#fff"/>
          <ellipse cx="114" cy="142" rx="4" ry="5" fill="#111"/>
          <ellipse cx="150" cy="142" rx="4" ry="5" fill="#111"/>
          <ellipse cx="115" cy="140" rx="1.5" ry="1.8" fill="#fff"/>
          <ellipse cx="151" cy="140" rx="1.5" ry="1.8" fill="#fff"/>
        </g>
        <!-- улыбка -->
        <path class="g-mouth" d="M108 170 Q130 182 152 170" stroke="#3a5218" stroke-width="3" fill="none" stroke-linecap="round"/>

        <!-- шапка/корона -->
        <g class="g-hat">
          <!-- колпак (3 lvl) -->
          <path class="g-cap" d="M86 108 Q130 60 174 108 Z" fill="#6a2b2b"/>
          <circle class="g-cap-ball" cx="130" cy="62" r="8" fill="#f2d28a"/>
          <!-- шлем (4 lvl) -->
          <path class="g-helm" d="M78 112 Q130 72 182 112 L182 130 Q130 118 78 130 Z" fill="url(#armor)"/>
          <!-- корона (5 lvl) -->
          <g class="g-crown">
            <path d="M86 108 L100 80 L114 105 L128 72 L142 105 L156 78 L170 108 Z" fill="url(#gold)" stroke="#7a5100" stroke-width="2"/>
            <circle cx="100" cy="80" r="4" fill="#ff5e5e"/>
            <circle cx="128" cy="72" r="4" fill="#5ec6ff"/>
            <circle cx="156" cy="78" r="4" fill="#78ff72"/>
          </g>
        </g>
      </g>

      <!-- оружие в правой руке -->
      <g class="g-weapon">
        <!-- палка (lvl 2) -->
        <g class="g-stick">
          <rect x="196" y="210" width="6" height="60" rx="2" fill="#7a4a22"/>
        </g>
        <!-- кинжал (lvl 3) -->
        <g class="g-knife">
          <rect x="196" y="208" width="6" height="22" rx="1" fill="#7a4a22"/>
          <path d="M194 208 L204 208 L199 176 Z" fill="url(#armor)" stroke="#2b2f3a"/>
        </g>
        <!-- топор (lvl 4) -->
        <g class="g-axe">
          <rect x="196" y="208" width="6" height="70" rx="2" fill="#4a2f14"/>
          <path d="M180 198 Q175 180 199 170 Q223 180 218 198 Q208 210 199 208 Q190 210 180 198 Z" fill="url(#armor)" stroke="#2b2f3a"/>
        </g>
        <!-- скипетр (lvl 5) -->
        <g class="g-scepter">
          <rect x="198" y="210" width="5" height="70" rx="2" fill="url(#gold)" stroke="#7a5100" stroke-width="1"/>
          <circle cx="200" cy="200" r="14" fill="url(#gold)" stroke="#7a5100" stroke-width="2"/>
          <circle cx="200" cy="200" r="5" fill="#8a2be2"/>
        </g>
      </g>

      <!-- мешок с золотом в левой руке (lvl 5) -->
      <g class="g-bag">
        <ellipse cx="58" cy="248" rx="22" ry="18" fill="url(#cloth)" stroke="#3a2a10" stroke-width="2"/>
        <circle cx="50" cy="240" r="5" fill="url(#gold)"/>
        <circle cx="64" cy="244" r="4" fill="url(#gold)"/>
        <circle cx="58" cy="252" r="3" fill="url(#gold)"/>
        <text x="56" y="255" font-size="10" font-weight="900" fill="#3a2a10">$</text>
      </g>

    </g>
  </svg>`;
}

// Управление видимостью частей по уровню.
function applyGoblinLevel(level /* 1..5 */) {
  const svg = goblinEl.querySelector('svg');
  if (!svg) return;
  const show = (sel, on) => {
    const el = svg.querySelector(sel);
    if (el) el.style.display = on ? '' : 'none';
  };
  // Размер гоблина по уровню.
  const scales = { 1: 0.72, 2: 0.84, 3: 0.94, 4: 1.04, 5: 1.12 };
  goblinEl.style.transform = `scale(${scales[level] || 1})`;

  show('.g-cloth',   level >= 2);
  show('.g-armor',   level >= 4);
  show('.g-cap',     level === 3);
  show('.g-cap-ball',level === 3);
  show('.g-helm',    level === 4);
  show('.g-crown',   level === 5);
  show('.g-stick',   level === 2);
  show('.g-knife',   level === 3);
  show('.g-axe',     level === 4);
  show('.g-scepter', level === 5);
  show('.g-bag',     level === 5);

  // Цвет кожи чуть темнее с ростом уровня.
  const skinShift = ['#6ea03b', '#6ea03b', '#6e9b33', '#5d892c', '#567f20'][level - 1] || '#6ea03b';
  const grad = svg.querySelector('#skin');
  if (grad) {
    const stops = grad.querySelectorAll('stop');
    if (stops[1]) stops[1].setAttribute('stop-color', skinShift);
  }
}

// ---- UI рендер ----
function renderUpgrades() {
  upgradesEl.innerHTML = '';
  const curLv = getCurrentLevel();
  for (const u of UPGRADES) {
    const lvl = state.levels[u.id] || 0;
    const cost = upgradeCost(u, lvl);
    const locked = curLv < u.unlockLevel;

    const el = document.createElement('button');
    el.className = 'upgrade';
    el.type = 'button';
    el.dataset.id = u.id;
    el.dataset.unlock = u.unlockLevel;
    if (locked) el.classList.add('locked');

    const effectText = u.kind === 'click'
      ? `+${u.perLevel} к клику`
      : `+${u.perLevel} в секунду`;

    el.innerHTML = `
      <div class="upgrade-icon">${u.icon}</div>
      <div class="upgrade-main">
        <div class="upgrade-title">${u.title}</div>
        <div class="upgrade-desc">${u.desc}</div>
        <div class="upgrade-effect">${effectText}</div>
      </div>
      <div class="upgrade-right">
        <div class="upgrade-level-badge">Ур. ${lvl}</div>
        <div class="upgrade-cost">${fmt(cost)}</div>
      </div>
    `;

    el.addEventListener('click', () => tryBuy(u.id));
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
    el.dataset.unlock = u.unlockLevel;

    const costEl = el.querySelector('.upgrade-cost');
    const lvlEl  = el.querySelector('.upgrade-level-badge');
    if (costEl) costEl.textContent = fmt(cost);
    if (lvlEl)  lvlEl.textContent = `Ур. ${lvl}`;

    // прогресс-бар в ::before контролируется через --p
    const p = Math.min(1, state.coins / cost);
    el.style.setProperty('--p', p.toFixed(3));

    if (!locked) {
      const canAfford = state.coins >= cost;
      el.classList.toggle('affordable', canAfford);
      el.classList.toggle('unaffordable', !canAfford);
    } else {
      el.classList.remove('affordable', 'unaffordable');
    }
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
  perClickEl.textContent = `+${fmt(perClick)}`;
  perSecEl.textContent = `${fmt(perSec)}`;

  const lp = levelProgress(state.totalCoins);
  const lv = lp.idx + 1;
  gameEl.dataset.level = String(lv);
  levelLabelEl.textContent = `Level ${lv} · ${LEVELS[lp.idx].title}`;
  goblinLevelEl.textContent = `Level ${lv}`;
  if (lp.idx >= LEVELS.length - 1) {
    levelProgressEl.style.width = '100%';
    levelProgressTextEl.textContent = 'МАКС.';
  } else {
    levelProgressEl.style.width = (lp.pct * 100).toFixed(1) + '%';
    levelProgressTextEl.textContent = `${fmt(state.totalCoins - lp.cur)} / ${fmt(lp.next - lp.cur)} XP`;
  }

  if (lastDisplayedLevel && lv > lastDisplayedLevel) {
    triggerLevelUp(lv);
  }
  lastDisplayedLevel = lv;
  applyGoblinLevel(lv);
}

function triggerLevelUp(lv) {
  Sound.levelUp();
  flashToast(`Новый уровень! ${LEVELS[lv - 1].title}`);
  gameEl.classList.remove('levelup');
  // перезапуск CSS-анимации
  void gameEl.offsetWidth;
  gameEl.classList.add('levelup');
  // показываем рекламу раз в левел-ап, но не чаще чем раз в 180 сек.
  if (window.YSDK) window.YSDK.showFullscreen();
}

// ---- Клик по гоблину ----
let lastClickTs = 0;
function onGoblinClick(ev) {
  // Стартуем звук/эмбиент при первом взаимодействии.
  Sound.ensure(); Sound.resume();
  if (!state.muted) Sound.startAmbient();

  const now = performance.now();
  // Без троттла, но дедупликация touch/click одного события.
  if (now - lastClickTs < 10) return;
  lastClickTs = now;

  const gain = perClick;
  state.coins += gain;
  state.totalCoins += gain;

  Sound.coin();
  spawnClickEffects(ev, gain);
  clickGoblinBounce();
  save();
  refreshHud();
  updateUpgradesState();
}

function clickGoblinBounce() {
  goblinWrapEl.classList.remove('clicked');
  void goblinWrapEl.offsetWidth;
  goblinWrapEl.classList.add('clicked');
}

function spawnClickEffects(ev, gain) {
  const rect = stageEl.getBoundingClientRect();
  // Координаты относительно stage
  let cx, cy;
  if (ev && 'clientX' in ev) { cx = ev.clientX - rect.left; cy = ev.clientY - rect.top; }
  else if (ev && ev.touches && ev.touches[0]) { cx = ev.touches[0].clientX - rect.left; cy = ev.touches[0].clientY - rect.top; }
  else { cx = rect.width / 2; cy = rect.height / 2; }

  // +N плавающее число
  const f = document.createElement('div');
  f.className = 'floater';
  f.textContent = `+${fmt(gain)}`;
  f.style.left = cx + 'px';
  f.style.top = cy + 'px';
  floatersEl.appendChild(f);
  setTimeout(() => f.remove(), 950);

  // Монетки из-под курсора
  const count = 5 + Math.min(10, Math.floor(Math.log2(Math.max(2, gain))));
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'coin-particle';
    const angle = (Math.PI * (Math.random())) + Math.PI; // полукруг вверх
    // нет, нам нужен разлёт во все стороны с уклоном вниз через пару мс
    const dir = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 80;
    const dx = Math.cos(dir) * dist;
    const dy = Math.sin(dir) * dist + 50; // уклон вниз
    const rot = (Math.random() * 720 - 360) + 'deg';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.setProperty('--dx', dx.toFixed(1) + 'px');
    p.style.setProperty('--dy', dy.toFixed(1) + 'px');
    p.style.setProperty('--rot', rot);
    particlesEl.appendChild(p);
    setTimeout(() => p.remove(), 750);
  }
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

// Периодическое сохранение.
setInterval(save, 5000);

// ---- Init ----
function init() {
  goblinEl.innerHTML = goblinSvg();
  recalcRates();
  renderUpgrades();
  lastDisplayedLevel = getCurrentLevel();
  refreshHud();
  applyGoblinLevel(getCurrentLevel());

  // Sound toggle
  soundToggleEl.classList.toggle('muted', state.muted);
  Sound.setMuted(state.muted);
  soundToggleEl.addEventListener('click', () => {
    state.muted = !state.muted;
    Sound.ensure(); Sound.resume();
    Sound.setMuted(state.muted);
    if (!state.muted) Sound.startAmbient();
    soundToggleEl.classList.toggle('muted', state.muted);
    save();
  });

  // Клик по гоблину — и по области под ним.
  goblinWrapEl.addEventListener('click', onGoblinClick);
  goblinWrapEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') onGoblinClick(); });
  goblinWrapEl.tabIndex = 0;
  // На тач-устройствах мы слушаем touchstart чтобы ловить точку прикосновения.
  goblinWrapEl.addEventListener('touchstart', (e) => { onGoblinClick(e); e.preventDefault(); }, { passive: false });

  // Запрещаем скролл колесом на апгрейдах внутрь страницы.
  upgradesEl.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  // Yandex Games SDK init.
  if (window.YSDK) {
    window.YSDK.init().then(() => window.YSDK.gameReady()).catch(() => {});
  }

  // Рендерим цикл.
  requestAnimationFrame(tick);
}

document.addEventListener('DOMContentLoaded', init);
})();
