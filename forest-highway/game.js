/* =========================================================
   Лесная Магистраль — Crossy Road-подобная игра.
   Перепрыгиваешь зайчонком тропы, по которым бегают
   волки, медведи и лисы. Собираешь монеты и открываешь
   скины. Графика генерируется на офсрин-канвасах,
   звуки — через Web Audio API, без внешних ресурсов.
   ========================================================= */
(() => {
  'use strict';

  // ---------- Константы ----------
  const TILE_BASE = 72;           // базовый размер клетки, px (до scale)
  const COLS = 9;                 // ширина поля в клетках
  const HOP_MS = 120;             // длительность прыжка
  const CAMERA_LERP = 0.12;       // плавность камеры
  const MAX_BEHIND_ROWS = 9;      // сколько клеток игрок может отстать от камеры (можно возвращаться вниз)
  const COIN_CHANCE = 0.22;       // шанс монеты на безопасной клетке
  const SPAWN_PAD_ROWS = 18;      // буфер вперёд
  const DESPAWN_BEHIND = 10;      // столько рядов сохраняем позади

  // ---------- Состояние ----------
  const S = {
    canvas: null, ctx: null,
    dpr: 1, tile: TILE_BASE,
    width: 0, height: 0,          // css размер
    vw: 0, vh: 0,                 // device размер
    rows: new Map(),              // rowIndex -> row
    player: null,
    camera: 0,                    // row-координата камеры (плавная)
    targetCamera: 0,
    running: false,
    paused: false,
    over: false,
    score: 0, best: 0, coins: 0,
    ownedSkins: new Set(),
    selectedSkin: 'white',
    soundOn: true, musicOn: true,
    lastFrame: 0,
    menuOpen: 'main',             // main|skins|pause|over|none
    previousMenu: null,           // откуда был открыт menuSkins (для кнопки «Назад»)
    topRow: 0,                    // самая "высокая" сгенерированная строка (минимальный rowIndex, т.к. дальше = меньше)
    bottomRow: 0,                 // самая нижняя сгенерированная строка
    frontestRow: 0,               // лучший (меньший) rowIndex куда прыгал игрок — для счёта
  };

  // ---------- Хранилище ----------
  const STORAGE_KEY = 'forest-highway.v1';
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.coins === 'number') S.coins = d.coins;
      if (typeof d.best === 'number') S.best = d.best;
      if (Array.isArray(d.owned)) d.owned.forEach((k) => S.ownedSkins.add(k));
      if (typeof d.selected === 'string' && SKINS[d.selected]) S.selectedSkin = d.selected;
      if (typeof d.soundOn === 'boolean') S.soundOn = d.soundOn;
      if (typeof d.musicOn === 'boolean') S.musicOn = d.musicOn;
    } catch (_) {}
    S.ownedSkins.add('white'); // базовый всегда доступен
  }
  function saveSave() {
    try {
      const d = {
        coins: S.coins, best: S.best,
        owned: Array.from(S.ownedSkins), selected: S.selectedSkin,
        soundOn: S.soundOn, musicOn: S.musicOn,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch (_) {}
  }

  // ---------- Скины зайца ----------
  const SKINS = {
    white: {
      name: 'Беляк', cost: 0,
      body: '#f3f6ef', belly: '#ffffff', ear: '#ffd9e0',
      nose: '#ff8c9e', accent: null,
    },
    brown: {
      name: 'Русак', cost: 10,
      body: '#a37149', belly: '#e9cdaa', ear: '#c08e63',
      nose: '#4a2310', accent: null,
    },
    grey: {
      name: 'Серый капюшон', cost: 25,
      body: '#7a8490', belly: '#c8d1da', ear: '#5f6672',
      nose: '#2a2e35', accent: null,
    },
    ninja: {
      name: 'Ушастый ниндзя', cost: 50,
      body: '#2a2e35', belly: '#44495a', ear: '#1b1e25',
      nose: '#ff4b4b', accent: '#ff4b4b',
    },
    gold: {
      name: 'Золотой', cost: 120,
      body: '#f5cb4b', belly: '#fff0a6', ear: '#d69a1e',
      nose: '#7a4a07', accent: '#fff7d1',
    },
    cosmic: {
      name: 'Космический', cost: 280,
      body: '#6640c9', belly: '#b89cff', ear: '#3c1f8c',
      nose: '#ffd0ff', accent: '#8be0ff',
    },
  };
  const SKIN_ORDER = ['white', 'brown', 'grey', 'ninja', 'gold', 'cosmic'];

  // ---------- Офсрин-спрайты ----------
  // Все спрайты рендерим один раз в hidden-canvas, чтобы не дёргать пути каждый кадр.
  const SPRITES = {
    bunny: {},   // по ключу скина
    wolf: null, bear: null, fox: null, coin: null,
    bush: null, tree: null, stone: null, log: null, flower: null,
  };

  function newOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.round(w); c.height = Math.round(h);
    return c;
  }

  // Кролик (вид сверху) — голова сверху, тело снизу, уши торчат вверх.
  function drawBunny(ctx, w, h, skin) {
    const cx = w / 2, cy = h / 2;
    const c = SKINS[skin] || SKINS.white;
    ctx.save();
    ctx.translate(cx, cy);
    // Тень под зайцем
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.38, w * 0.34, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    // Хвостик-пом-помом (раньше тела — чтобы аккуратно выглядывал)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, h * 0.32, w * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(w * 0.03, h * 0.29, w * 0.045, 0, Math.PI * 2);
    ctx.fill();
    // Уши (длинные, почти вертикальные)
    const earW = w * 0.11, earH = h * 0.34;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * w * 0.14, -h * 0.28);
      ctx.rotate(side * 0.06);
      // Внешняя часть
      const earGrad = ctx.createLinearGradient(0, -earH, 0, earH);
      earGrad.addColorStop(0, lighten(c.body, 0.14));
      earGrad.addColorStop(1, c.body);
      ctx.fillStyle = earGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, earW, earH, 0, 0, Math.PI * 2);
      ctx.fill();
      // Внутренняя розовая вкладка
      ctx.fillStyle = c.ear;
      ctx.beginPath();
      ctx.ellipse(0, h * 0.02, earW * 0.55, earH * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Тело — яйцевидная форма
    const bodyGrad = ctx.createRadialGradient(-w * 0.08, -h * 0.05, w * 0.04, 0, 0, w * 0.44);
    bodyGrad.addColorStop(0, lighten(c.body, 0.26));
    bodyGrad.addColorStop(1, c.body);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.12, w * 0.36, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    // Брюшко
    ctx.fillStyle = c.belly;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.18, w * 0.20, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Голова — круглая, ближе к телу
    const headGrad = ctx.createRadialGradient(-w * 0.05, -h * 0.18, w * 0.04, 0, -h * 0.08, w * 0.32);
    headGrad.addColorStop(0, lighten(c.body, 0.3));
    headGrad.addColorStop(1, c.body);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.06, w * 0.25, h * 0.23, 0, 0, Math.PI * 2);
    ctx.fill();
    // Щёчки — круглые светлые пятна
    ctx.fillStyle = 'rgba(255,182,193,0.55)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * w * 0.16, -h * 0.04, w * 0.05, h * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Глаза — аккуратные большие с бликом
    const eyeOffsetX = w * 0.085, eyeY = -h * 0.12;
    const eyeRx = w * 0.036, eyeRy = h * 0.045;
    ctx.fillStyle = '#1a1a1f';
    for (const dx of [-eyeOffsetX, eyeOffsetX]) {
      ctx.beginPath();
      ctx.ellipse(dx, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (const dx of [-eyeOffsetX, eyeOffsetX]) {
      ctx.beginPath();
      ctx.arc(dx + w * 0.014, eyeY - h * 0.014, w * 0.014, 0, Math.PI * 2);
      ctx.fill();
    }
    // Нос-сердечко
    ctx.fillStyle = c.nose;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.005);
    ctx.quadraticCurveTo(-w * 0.035, -h * 0.035, 0, -h * 0.05);
    ctx.quadraticCurveTo(w * 0.035, -h * 0.035, 0, -h * 0.005);
    ctx.fill();
    // Ротик — маленькая «y»-линия
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, w * 0.012);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.005);
    ctx.lineTo(0, h * 0.015);
    ctx.moveTo(0, h * 0.015);
    ctx.lineTo(-w * 0.025, h * 0.03);
    ctx.moveTo(0, h * 0.015);
    ctx.lineTo(w * 0.025, h * 0.03);
    ctx.stroke();
    // Усы — короче и тоньше (меньше шума)
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(1, w * 0.008);
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(side * w * 0.05, h * 0.005 + i * h * 0.02);
        ctx.lineTo(side * w * 0.17, h * 0.005 + i * h * 0.035);
        ctx.stroke();
      }
    }
    // Лапки спереди
    ctx.fillStyle = c.belly;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * w * 0.14, h * 0.36, w * 0.07, h * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Акцент (шарф/платок)
    if (c.accent) {
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, h * 0.06);
      ctx.quadraticCurveTo(0, h * 0.18, w * 0.22, h * 0.06);
      ctx.quadraticCurveTo(0, h * 0.26, -w * 0.22, h * 0.06);
      ctx.fill();
    }
    ctx.restore();
  }

  // Волк (вид сверху, морда вперёд)
  function drawWolf(ctx, w, h) {
    const body = '#5e6672', bellyCol = '#9ba3ae', dark = '#33373f';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.32, w * 0.38, h * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    // Хвост
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-w * 0.42, h * 0.05, w * 0.14, h * 0.07, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ccc';
    ctx.beginPath();
    ctx.ellipse(-w * 0.48, h * 0.04, w * 0.05, h * 0.05, -0.35, 0, Math.PI * 2);
    ctx.fill();
    // Туловище
    const g = ctx.createLinearGradient(0, -h * 0.2, 0, h * 0.25);
    g.addColorStop(0, lighten(body, 0.12)); g.addColorStop(1, body);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-w * 0.05, 0, w * 0.30, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Живот
    ctx.fillStyle = bellyCol;
    ctx.beginPath();
    ctx.ellipse(-w * 0.05, h * 0.04, w * 0.18, h * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Лапы
    ctx.fillStyle = dark;
    for (const [dx, dy] of [[-0.22, -0.16], [0.08, -0.18], [-0.22, 0.18], [0.08, 0.20]]) {
      ctx.beginPath();
      ctx.ellipse(dx * w, dy * h, w * 0.06, h * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Голова
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(w * 0.22, 0, w * 0.20, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Морда
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(w * 0.37, 0, w * 0.10, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Нос
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath();
    ctx.ellipse(w * 0.44, 0, w * 0.028, h * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
    // Уши
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(w * 0.10, -h * 0.12); ctx.lineTo(w * 0.18, -h * 0.28); ctx.lineTo(w * 0.22, -h * 0.12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.10,  h * 0.12); ctx.lineTo(w * 0.18,  h * 0.28); ctx.lineTo(w * 0.22,  h * 0.12); ctx.closePath(); ctx.fill();
    // Глаза — жёлтые
    ctx.fillStyle = '#ffd14a';
    ctx.beginPath(); ctx.ellipse(w * 0.26, -h * 0.06, w * 0.022, h * 0.025, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w * 0.26,  h * 0.06, w * 0.022, h * 0.025, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillRect(w * 0.258, -h * 0.075, w * 0.005, h * 0.03);
    ctx.fillRect(w * 0.258,  h * 0.045, w * 0.005, h * 0.03);
    ctx.restore();
  }

  // Медведь — массивный, крупный.
  function drawBear(ctx, w, h) {
    const body = '#6b4326', belly = '#a97a50', dark = '#3a2311';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.34, w * 0.42, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Туловище
    const g = ctx.createRadialGradient(-w * 0.1, -h * 0.08, w * 0.1, 0, 0, w * 0.42);
    g.addColorStop(0, lighten(body, 0.18)); g.addColorStop(1, body);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-w * 0.05, 0, w * 0.38, h * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();
    // Живот
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(-w * 0.03, h * 0.03, w * 0.22, h * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();
    // Лапы
    ctx.fillStyle = dark;
    for (const [dx, dy] of [[-0.30, -0.22], [0.08, -0.24], [-0.30, 0.24], [0.08, 0.26]]) {
      ctx.beginPath();
      ctx.ellipse(dx * w, dy * h, w * 0.08, h * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Когти
    ctx.fillStyle = '#f2e8c9';
    for (const [dx, dy] of [[0.14, -0.25], [0.14, 0.27]]) {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(dx * w + i * w * 0.018, dy * h, w * 0.01, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Голова — большая
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(w * 0.30, 0, w * 0.22, h * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();
    // Уши (круглые)
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(w * 0.20, -h * 0.18, w * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.20,  h * 0.18, w * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(w * 0.20, -h * 0.18, w * 0.035, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.20,  h * 0.18, w * 0.035, 0, Math.PI * 2); ctx.fill();
    // Морда
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(w * 0.44, 0, w * 0.11, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Нос
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath();
    ctx.ellipse(w * 0.52, 0, w * 0.035, h * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    // Глаза
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath(); ctx.arc(w * 0.32, -h * 0.05, w * 0.02, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.32,  h * 0.05, w * 0.02, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Лиса — меньше, рыжая.
  function drawFox(ctx, w, h) {
    const body = '#d26a2e', belly = '#ffd8af', dark = '#3b1a08';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.32, w * 0.34, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Пушистый хвост
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-w * 0.38, -h * 0.02, w * 0.18, h * 0.08, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-w * 0.48, -h * 0.06, w * 0.06, h * 0.05, -0.25, 0, Math.PI * 2);
    ctx.fill();
    // Туловище
    const g = ctx.createLinearGradient(0, -h * 0.2, 0, h * 0.2);
    g.addColorStop(0, lighten(body, 0.15)); g.addColorStop(1, body);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-w * 0.05, 0, w * 0.26, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Живот
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(-w * 0.05, h * 0.04, w * 0.14, h * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    // Лапы
    ctx.fillStyle = dark;
    for (const [dx, dy] of [[-0.20, -0.14], [0.06, -0.16], [-0.20, 0.16], [0.06, 0.18]]) {
      ctx.beginPath();
      ctx.ellipse(dx * w, dy * h, w * 0.045, h * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Голова — треугольная
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, -h * 0.14);
    ctx.quadraticCurveTo(w * 0.50, 0, w * 0.08, h * 0.14);
    ctx.quadraticCurveTo(w * 0.0, 0, w * 0.08, -h * 0.14);
    ctx.fill();
    // Белая маска
    ctx.fillStyle = '#fff2e2';
    ctx.beginPath();
    ctx.moveTo(w * 0.16, -h * 0.07);
    ctx.quadraticCurveTo(w * 0.44, 0, w * 0.16, h * 0.07);
    ctx.quadraticCurveTo(w * 0.22, 0, w * 0.16, -h * 0.07);
    ctx.fill();
    // Уши (острые, треугольные)
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(w * 0.08, -h * 0.14); ctx.lineTo(w * 0.14, -h * 0.32); ctx.lineTo(w * 0.22, -h * 0.10); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.08,  h * 0.14); ctx.lineTo(w * 0.14,  h * 0.32); ctx.lineTo(w * 0.22,  h * 0.10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(w * 0.12, -h * 0.16); ctx.lineTo(w * 0.16, -h * 0.28); ctx.lineTo(w * 0.20, -h * 0.14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.12,  h * 0.16); ctx.lineTo(w * 0.16,  h * 0.28); ctx.lineTo(w * 0.20,  h * 0.14); ctx.closePath(); ctx.fill();
    // Нос
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath();
    ctx.ellipse(w * 0.46, 0, w * 0.028, h * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
    // Глаза
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath(); ctx.arc(w * 0.22, -h * 0.05, w * 0.018, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.22,  h * 0.05, w * 0.018, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCoin(ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, h * 0.24, w * 0.28, h * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(-w * 0.12, -h * 0.14, w * 0.03, 0, 0, w * 0.35);
    g.addColorStop(0, '#fff3b4');
    g.addColorStop(0.45, '#ffd156');
    g.addColorStop(1, '#a87300');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, w * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a5300'; ctx.lineWidth = Math.max(1, w * 0.015);
    ctx.beginPath(); ctx.arc(0, 0, w * 0.32, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(-w * 0.08, -h * 0.14, w * 0.08, h * 0.04, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8f6100';
    ctx.font = `bold ${Math.round(w * 0.3)}px Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('◎', 0, h * 0.02);
    ctx.restore();
  }

  function drawBush(ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, h * 0.30, w * 0.32, h * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    // Листва из нескольких кругов
    const cols = ['#3a7a3a', '#56a44a', '#79c86a'];
    const blobs = [
      [-w * 0.15, h * 0.05, w * 0.22, 0],
      [ w * 0.12, h * 0.08, w * 0.20, 1],
      [-w * 0.02,-h * 0.10, w * 0.22, 2],
      [ w * 0.18,-h * 0.05, w * 0.15, 1],
      [-w * 0.20,-h * 0.02, w * 0.14, 0],
    ];
    for (const [x, y, r, ci] of blobs) {
      ctx.fillStyle = cols[ci];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Ягодки
    ctx.fillStyle = '#c24141';
    ctx.beginPath(); ctx.arc(-w * 0.05, -h * 0.04, w * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( w * 0.10,  h * 0.04, w * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawTree(ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    // Длинная тень под деревом (вид сверху)
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(w * 0.06, h * 0.30, w * 0.38, h * 0.10, 0, 0, Math.PI * 2); ctx.fill();
    // Ствол
    ctx.fillStyle = '#5a3316';
    ctx.beginPath(); ctx.arc(0, h * 0.18, w * 0.07, 0, Math.PI * 2); ctx.fill();
    // Крона: основной тёмный круг + боковые "шишки" для пушистости.
    const cloudRadii = [
      [ 0.00, -0.08, 0.42],
      [-0.22, -0.02, 0.24],
      [ 0.22, -0.02, 0.24],
      [-0.14, -0.24, 0.22],
      [ 0.14, -0.24, 0.22],
      [ 0.00,  0.14, 0.26],
    ];
    // Тёмный контур
    ctx.fillStyle = '#1f4723';
    for (const [dx, dy, r] of cloudRadii) {
      ctx.beginPath();
      ctx.arc(dx * w, dy * h, r * w, 0, Math.PI * 2);
      ctx.fill();
    }
    // Средний тон (немного меньше)
    ctx.fillStyle = '#2f6e34';
    for (const [dx, dy, r] of cloudRadii) {
      ctx.beginPath();
      ctx.arc(dx * w + w * 0.015, dy * h - h * 0.02, r * w * 0.82, 0, Math.PI * 2);
      ctx.fill();
    }
    // Яркие блики (смещены вверх-лево)
    ctx.fillStyle = '#62ab52';
    for (const [dx, dy, r] of cloudRadii) {
      ctx.beginPath();
      ctx.arc(dx * w - w * 0.04, dy * h - h * 0.08, r * w * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Маленькие светлые штрихи
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (const [dx, dy, r] of cloudRadii) {
      ctx.beginPath();
      ctx.ellipse(dx * w - w * 0.07, dy * h - h * 0.12, r * w * 0.22, r * w * 0.08, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStone(ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, h * 0.28, w * 0.34, h * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(-w * 0.1, -h * 0.1, w * 0.04, 0, 0, w * 0.36);
    g.addColorStop(0, '#b6b6b6'); g.addColorStop(1, '#5b5b5f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.32, h * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.ellipse(-w * 0.08, -h * 0.08, w * 0.1, h * 0.05, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(1, w * 0.01);
    ctx.beginPath(); ctx.moveTo(-w * 0.12, h * 0.05); ctx.quadraticCurveTo(0, h * 0.1, w * 0.14, h * 0.02); ctx.stroke();
    ctx.restore();
  }

  function drawLog(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, h * 0.30, w * 0.42, h * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(0, -h * 0.25, 0, h * 0.25);
    g.addColorStop(0, '#8a5a34'); g.addColorStop(1, '#4e2f17');
    ctx.fillStyle = g;
    ctx.fillRect(-w * 0.42, -h * 0.18, w * 0.84, h * 0.36);
    // Торцы
    ctx.fillStyle = '#c4965d';
    ctx.beginPath(); ctx.ellipse(-w * 0.42, 0, w * 0.08, h * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( w * 0.42, 0, w * 0.08, h * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    // Кольца
    ctx.strokeStyle = '#7a4a1d'; ctx.lineWidth = Math.max(1, w * 0.012);
    for (const side of [-1, 1]) {
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(side * w * 0.42, 0, w * 0.08 - i * w * 0.015, h * 0.18 - i * h * 0.035, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Полоски коры
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(1, w * 0.01);
    for (let i = 0; i < 5; i++) {
      const x = -w * 0.35 + i * w * 0.18;
      ctx.beginPath(); ctx.moveTo(x, -h * 0.18); ctx.lineTo(x + w * 0.02, h * 0.18); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlower(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    const cols = ['#f4d352', '#f98a8a', '#d689ff', '#fff3a3'];
    const col = cols[(Math.random() * cols.length) | 0];
    // Лепестки
    ctx.fillStyle = col;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * w * 0.14, Math.sin(a) * w * 0.14, w * 0.11, h * 0.07, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // Центр
    ctx.fillStyle = '#fff1a8';
    ctx.beginPath(); ctx.arc(0, 0, w * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b47a0c';
    ctx.beginPath(); ctx.arc(0, 0, w * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------- Утилиты ----------
  function roundedEllipse(ctx, cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(x, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function lighten(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const L = (c) => Math.round(c + (255 - c) * amt);
    return `rgb(${L(r)}, ${L(g)}, ${L(b)})`;
  }

  // ---------- Подготовка спрайтов ----------
  function buildSprites() {
    const S0 = 256;
    for (const key of SKIN_ORDER) {
      const c = newOffscreen(S0, S0);
      drawBunny(c.getContext('2d'), S0, S0, key);
      SPRITES.bunny[key] = c;
    }
    const mkSized = (w, h, fn) => { const c = newOffscreen(w, h); fn(c.getContext('2d'), w, h); return c; };
    SPRITES.wolf   = mkSized(320, 220, drawWolf);
    SPRITES.bear   = mkSized(480, 280, drawBear);   // крупный, длинный (на "две полосы")
    SPRITES.fox    = mkSized(260, 180, drawFox);
    SPRITES.coin   = mkSized(160, 160, drawCoin);
    SPRITES.bush   = mkSized(240, 240, drawBush);
    SPRITES.tree   = mkSized(280, 280, drawTree);
    SPRITES.stone  = mkSized(220, 220, drawStone);
    SPRITES.log    = mkSized(320, 180, drawLog);
    SPRITES.flower = mkSized(160, 160, drawFlower);
  }

  // ---------- Аудио ----------
  const Audio = (() => {
    let ctx = null, master = null, musicGain = null, musicTimer = null, musicStep = 0;
    function ensure() {
      if (ctx) return ctx;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
        musicGain = ctx.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
      } catch (e) { ctx = null; }
      return ctx;
    }
    function resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
    function beep({ freq = 440, dur = 0.12, type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
      if (!S.soundOn) return;
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator(); const g = c.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    function jump() { beep({ freq: 520, dur: 0.10, type: 'triangle', vol: 0.2, slide: 180 }); }
    function coin() {
      beep({ freq: 880, dur: 0.10, type: 'square', vol: 0.18 });
      beep({ freq: 1320, dur: 0.14, type: 'square', vol: 0.18, delay: 0.06 });
    }
    function death() {
      beep({ freq: 180, dur: 0.32, type: 'sawtooth', vol: 0.35, slide: -120 });
      beep({ freq: 90,  dur: 0.5,  type: 'sawtooth', vol: 0.25, slide: -50, delay: 0.1 });
    }
    function newSkin() {
      beep({ freq: 660, dur: 0.12, type: 'square', vol: 0.2 });
      beep({ freq: 990, dur: 0.14, type: 'square', vol: 0.2, delay: 0.08 });
      beep({ freq: 1320, dur: 0.2, type: 'square', vol: 0.22, delay: 0.18 });
    }
    // Простая спокойная фоновая музыка — арпеджио по мягким аккордам.
    const CHORDS = [
      [262, 330, 392, 523],   // C
      [220, 277, 330, 440],   // Am
      [196, 247, 294, 392],   // G
      [175, 220, 262, 349],   // F
    ];
    function musicStart() {
      if (!S.musicOn) return;
      const c = ensure(); if (!c) return;
      if (musicTimer) return;
      musicStep = 0;
      const tempo = 260; // ms per note
      const play = () => {
        if (!S.musicOn) { musicStop(); return; }
        const chord = CHORDS[Math.floor(musicStep / 8) % CHORDS.length];
        const note = chord[musicStep % chord.length];
        const t0 = c.currentTime;
        const osc = c.createOscillator(); const g = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        osc.connect(g); g.connect(musicGain);
        osc.start(t0); osc.stop(t0 + 0.26);
        // Добавим тихий бас в сильную долю
        if (musicStep % 4 === 0) {
          const b = c.createOscillator(); const bg = c.createGain();
          b.type = 'triangle';
          b.frequency.setValueAtTime(chord[0] / 2, t0);
          bg.gain.setValueAtTime(0.0001, t0);
          bg.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
          bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
          b.connect(bg); bg.connect(musicGain);
          b.start(t0); b.stop(t0 + 0.52);
        }
        musicStep++;
      };
      play();
      musicTimer = setInterval(play, tempo);
    }
    function musicStop() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    }
    return { resume, jump, coin, death, newSkin, musicStart, musicStop };
  })();

  // ---------- Игровое поле ----------
  // rowIndex: ноль — стартовая клетка. ИГРОК двигается к меньшим индексам (вверх).
  // Поэтому камера смотрит на меньшие rowIndex.
  // Для удобства рендера используем y-координату экрана: screenY = (row - camera) * tile + baseline.

  const ROW_TYPES = {
    grass: { safe: true, weight: 62 },
    coin:  { safe: true, weight: 6 },    // ряд с несколькими монетами подряд
    road:  { safe: false, weight: 32 },  // единая тропа — любое животное может бежать
  };

  // Типы животных, которые рандомно выбегают на любой тропе.
  // speed — в клетках/сек (абсолютное значение), size — длина в клетках, height — вертикал.
  const PREDATORS = [
    { kind: 'wolf', weight: 40, speed: [0.80, 1.10], size: 1.0, height: 0.85 },
    { kind: 'fox',  weight: 28, speed: [1.30, 1.70], size: 0.8, height: 0.70 },
    { kind: 'bear', weight: 16, speed: [0.45, 0.65], size: 2.0, height: 1.00 },
  ];
  function pickPredator() {
    const total = PREDATORS.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of PREDATORS) { r -= p.weight; if (r <= 0) return p; }
    return PREDATORS[0];
  }

  function pickRowType(prev, streakUnsafe) {
    // Не даём слишком длинные серии опасных (не более 2 подряд) и подряд одинаковых.
    const entries = Object.entries(ROW_TYPES);
    const filtered = entries.filter(([k, v]) => {
      if (streakUnsafe >= 2 && !v.safe) return false;
      if (prev && prev.type === k && Math.random() < 0.6) return false;
      return true;
    });
    const total = filtered.reduce((s, [, v]) => s + v.weight, 0);
    let r = Math.random() * total;
    for (const [k, v] of filtered) { r -= v.weight; if (r <= 0) return k; }
    return 'grass';
  }

  function createRow(rowIndex) {
    // Ближайшие стартовые ряды — безопасная трава.
    const tooClose = rowIndex > -2;
    const prev = S.rows.get(rowIndex + 1) || null;
    let streakUnsafe = 0;
    for (let i = 1; i <= 4; i++) {
      const r = S.rows.get(rowIndex + i);
      if (!r || r.safe) break;
      streakUnsafe++;
    }
    const type = tooClose ? 'grass' : pickRowType(prev, streakUnsafe);
    const row = { index: rowIndex, type, safe: ROW_TYPES[type].safe, obstacles: [], coins: [], enemies: [], dir: 0, speed: 0 };

    if (type === 'grass') {
      // Рассыпаем декор и препятствия (дерево/камень блокируют клетку; цветы — только декор)
      for (let x = 0; x < COLS; x++) {
        if (tooClose && x === (COLS >> 1)) continue; // старт свободный
        const r = Math.random();
        if (!tooClose && r < 0.12) row.obstacles.push({ x, kind: 'tree' });
        else if (!tooClose && r < 0.17) row.obstacles.push({ x, kind: 'stone' });
        else if (!tooClose && r < 0.22) row.obstacles.push({ x, kind: 'bush' });
        else if (r < 0.38) row.decor = row.decor || []; // будем рисовать цветы/мелочь через декор
      }
      // мелкий декор (цветы) — только для рисования
      row.decor = [];
      for (let x = 0; x < COLS; x++) {
        if (row.obstacles.find((o) => o.x === x)) continue;
        if (Math.random() < 0.25) row.decor.push({ x, kind: 'flower', ox: (Math.random() - 0.5) * 0.6, oy: (Math.random() - 0.5) * 0.6 });
      }
      // Иногда монета в траве
      if (!tooClose && Math.random() < 0.15) {
        const candidates = [];
        for (let x = 0; x < COLS; x++) if (!row.obstacles.find((o) => o.x === x)) candidates.push(x);
        if (candidates.length) row.coins.push({ x: candidates[(Math.random() * candidates.length) | 0], collected: false });
      }
    } else if (type === 'coin') {
      // Ряд монет по диагонали/шашечкой (реже и реже внутри)
      const offset = (Math.random() * 2) | 0;
      for (let x = 0; x < COLS; x++) {
        if (((x + offset) % 2 === 0) && Math.random() < 0.55) row.coins.push({ x, collected: false });
      }
    } else if (type === 'road') {
      // Единая тропа: направление случайное, животное пикается на каждом спауне.
      row.dir = Math.random() < 0.5 ? -1 : 1;
      // Стартовый трафик — плющий (4–6с); с ростом счёта постепенно сжимается.
      const difficulty = Math.min(2.2, (S.score || 0) * 0.025);
      row.spawnEvery = Math.max(1.8, (4.0 + Math.random() * 2.0) - difficulty);
      // Небольшой рандом на стартовое смещение, чтобы соседние тропы не плевались «в унисон».
      row.spawnTimer = Math.random() * row.spawnEvery;
      // Редкая монета на тропе.
      if (Math.random() < 0.08) row.coins.push({ x: (Math.random() * COLS) | 0, collected: false });
    }
    return row;
  }

  function ensureRows() {
    // Вперёд
    const frontTarget = Math.floor(S.camera) - SPAWN_PAD_ROWS;
    while (S.topRow > frontTarget) {
      S.topRow -= 1;
      S.rows.set(S.topRow, createRow(S.topRow));
    }
    // Назад
    const backTarget = Math.floor(S.camera) + SPAWN_PAD_ROWS;
    while (S.bottomRow < backTarget) {
      S.bottomRow += 1;
      S.rows.set(S.bottomRow, createRow(S.bottomRow));
    }
    // Удаляем слишком старые
    for (const [idx] of S.rows) {
      if (idx > backTarget + DESPAWN_BEHIND) S.rows.delete(idx);
      if (idx < frontTarget - DESPAWN_BEHIND) S.rows.delete(idx);
    }
  }

  // ---------- Игрок ----------
  function newPlayer() {
    return {
      row: 0, col: COLS >> 1,
      // Для анимации прыжка
      hop: null,            // { fromR, fromC, toR, toC, t (0..1) }
      renderRow: 0, renderCol: COLS >> 1, bounce: 0,
    };
  }

  function startHop(dr, dc) {
    if (!S.running || S.paused || S.over) return;
    if (S.player.hop) return;
    const p = S.player;
    const toR = p.row + dr, toC = p.col + dc;
    if (toC < 0 || toC >= COLS) return;
    // Запрещаем входить в клетку с препятствием (только трава)
    const dstRow = S.rows.get(toR);
    if (dstRow && dstRow.safe && dstRow.obstacles && dstRow.obstacles.find((o) => o.x === toC)) return;
    p.hop = { fromR: p.row, fromC: p.col, toR, toC, t: 0, facing: dr < 0 ? 'up' : dr > 0 ? 'down' : dc < 0 ? 'left' : 'right' };
    Audio.jump();
  }

  function finishHop() {
    const p = S.player;
    const h = p.hop;
    p.row = h.toR; p.col = h.toC;
    p.hop = null;
    // Сбор монет в клетке
    const row = S.rows.get(p.row);
    if (row && row.coins) {
      for (const c of row.coins) {
        if (!c.collected && c.x === p.col) {
          c.collected = true;
          S.coins += 1;
          S.sessionCoins = (S.sessionCoins || 0) + 1;
          Audio.coin();
          saveSave();
          updateHUD();
          spawnFloater(p.col, p.row, '+1', 'coin');
        }
      }
    }
    // Счёт: +1 за каждое продвижение "вперёд" (меньший row)
    if (p.row < S.frontestRow) {
      const gained = S.frontestRow - p.row;
      S.score += gained;
      S.frontestRow = p.row;
      if (S.score > S.best) S.best = S.score;
      spawnFloater(p.col, p.row, '+' + gained, 'score');
      updateHUD();
    }
  }

  function spawnFloater(col, row, text, cls) {
    const floaters = document.getElementById('floaters');
    const el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    const { sx, sy } = worldToScreen(col + 0.5, row + 0.5);
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    floaters.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // ---------- Камера и размеры ----------
  function worldToScreen(col, row) {
    // Возвращает CSS-координаты в пикселях экрана (для DOM-слоёв).
    const fieldW = COLS * S.tile;
    const offsetX = Math.round((S.width - fieldW) / 2);
    const sx = offsetX + col * S.tile;
    const sy = (row - S.camera) * S.tile + S.height * 0.62;
    return { sx, sy };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    S.width = w; S.height = h;
    S.vw = Math.round(w * dpr); S.vh = Math.round(h * dpr);
    S.canvas.width = S.vw; S.canvas.height = S.vh;
    S.canvas.style.width = w + 'px'; S.canvas.style.height = h + 'px';
    // Размер клетки: стараемся занять как можно больше ширины экрана,
    // чтобы «шторки» по бокам были узкие.
    const tByW = w / (COLS + 0.3);
    const tByH = h / 8.5;
    S.tile = Math.max(48, Math.min(128, Math.floor(Math.min(tByW, tByH))));
  }

  // ---------- Обновление мира ----------
  function updateRow(row, dt) {
    if (row.safe) return;
    // Спавним новых врагов с фиксированным интервалом в секундах.
    row.spawnTimer -= dt;
    if (row.spawnTimer <= 0) {
      const pred = pickPredator();
      // Анти-overlap: проверяем, что в зоне спауна нет другого зверя ближе полосы безопасности.
      const safetyGap = pred.size + 1.3;
      const blocked = row.enemies.some((e) => {
        if (row.dir > 0) return e.x < safetyGap; // последний слева ещё не отошёл
        return e.x + e.size > COLS - safetyGap;   // последний справа ещё не отошёл
      });
      if (blocked) {
        // подождём ещё чуть и попробуем позже — зверь не вылезает в спину другому.
        row.spawnTimer = 0.4;
      } else {
        const spd = pred.speed[0] + Math.random() * (pred.speed[1] - pred.speed[0]);
        const start = row.dir > 0 ? -pred.size - 0.5 : COLS + 0.5;
        row.enemies.push({
          x: start,
          kind: pred.kind,
          size: pred.size,
          height: pred.height,
          speed: spd * row.dir, // знаковая скорость в клетках/сек
        });
        // Динамический трафик: чем выше счёт, тем короче интервал (мин. 1.8с).
        const difficulty = Math.min(2.2, (S.score || 0) * 0.025);
        row.spawnEvery = Math.max(1.8, (4.0 + Math.random() * 2.0) - difficulty);
        row.spawnTimer = row.spawnEvery;
      }
    }
    // Двигаем каждого зверя по его собственной скорости.
    for (const e of row.enemies) { e.x += e.speed * dt; }
    // Убираем ушедших за край.
    row.enemies = row.enemies.filter((e) => (e.speed > 0 ? e.x < COLS + 3 : e.x > -e.size - 3));
  }

  function checkCollision() {
    const p = S.player;
    const pr = p.row, pc = p.col;
    // Если в прыжке — используем текущую позицию + проверим и дальнюю клетку (если в момент приземления там враг)
    const row = S.rows.get(p.hop ? p.hop.toR : pr);
    if (!row || row.safe) return false;
    const col = p.hop ? p.hop.toC : pc;
    for (const e of row.enemies) {
      const left = e.x, right = e.x + (e.size || 1);
      // Центр клетки игрока в мировых координатах
      const pxLeft = col + 0.1, pxRight = col + 0.9;
      if (right > pxLeft && left < pxRight) return { row, e };
    }
    return false;
  }

  function gameOver(cause) {
    if (S.over) return;
    S.over = true; S.running = false;
    Audio.death();
    if (S.score > S.best) S.best = S.score;
    saveSave();
    document.getElementById('overScore').textContent = S.score;
    document.getElementById('overBest').textContent = S.best;
    document.getElementById('overCoins').textContent = S.sessionCoins || 0;
    const causeText = {
      wolf: 'Волк догнал тебя на тропе.',
      fox:  'Быстрая лиса мелькнула — и всё...',
      bear: 'Медведь оказался сильнее.',
      fall: 'Ты слишком далеко отстал — орёл унёс тебя.',
    }[cause] || 'Хищник оказался быстрее.';
    document.getElementById('overCause').textContent = causeText;
    showOverlay('menuOver');
  }

  // ---------- Рендер ----------
  function render() {
    const ctx = S.ctx;
    const w = S.vw, h = S.vh, t = S.tile * S.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Горизонтальная центровка — чтобы поле было по центру экрана.
    const fieldW = COLS * t;
    const offsetX = Math.round((w - fieldW) / 2);
    // Мягкие боковые "края" — тёмные градиенты, куда заходят бегущие звери
    // и пропадают, не создавая визуального мусора.
    ctx.translate(offsetX, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, fieldW, h);
    ctx.clip();

    const cam = S.camera;
    const baseline = h * 0.62;

    // Рисуем ряды сверху вниз (по возрастанию rowIndex — т.к. большие rowIndex ниже на экране)
    const topRowOn = Math.ceil(cam - (baseline / t));
    const botRowOn = Math.ceil(cam + ((h - baseline) / t) + 1);

    for (let r = topRowOn; r <= botRowOn; r++) {
      const row = S.rows.get(r);
      if (!row) continue;
      const y = (r - cam) * t + baseline;
      drawRow(ctx, row, y, t, fieldW);
    }

    // Игрок и враги — во втором проходе, поверх "полотна"
    for (let r = topRowOn; r <= botRowOn; r++) {
      const row = S.rows.get(r);
      if (!row) continue;
      const y = (r - cam) * t + baseline;
      // Монеты — рисуем всегда (они плавают над грунтом)
      if (row.coins) {
        for (const c of row.coins) {
          if (c.collected) continue;
          const cx = c.x * t + t / 2;
          const bob = Math.sin(performance.now() * 0.004 + c.x) * t * 0.06;
          ctx.drawImage(SPRITES.coin, cx - t * 0.35, y - t * 0.35 + bob, t * 0.7, t * 0.7);
        }
      }
      // Враги
      if (row.enemies) {
        for (const e of row.enemies) {
          drawEnemy(ctx, e, row, y, t);
        }
      }
    }

    // Игрок (в своем ряду)
    drawPlayer(ctx, t, baseline);

    // Фронт-опасность (орёл-преследователь, рисуем у верхнего края если игрок отстаёт)
    const behind = S.player ? (S.player.row - Math.floor(S.camera)) : -99;
    if (behind >= MAX_BEHIND_ROWS - 1.5) {
      const y0 = (Math.floor(S.camera) + MAX_BEHIND_ROWS - cam) * t + baseline;
      const grad = ctx.createLinearGradient(0, y0 + t * 0.2, 0, y0 + t * 1.8);
      grad.addColorStop(0, 'rgba(255,80,80,0.4)');
      grad.addColorStop(1, 'rgba(255,80,80,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y0, fieldW, t * 1.6);
    }

    ctx.restore(); // снимаем clip
    // Декоративные края поля — ели/деревья вдоль краёв, чтобы не было пустоты
    drawSideDecor(ctx, w, h, t, offsetX, fieldW, cam);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawSideDecor(ctx, w, h, t, offsetX, fieldW, cam) {
    // Рисуем лёгкую лесную заливку по бокам + редкие деревья, чтобы «шторки»
    // не были тёмными и не закрывали дорогу. Позиции детерминированные.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const leftW = offsetX;
    const rightX = offsetX + fieldW;
    const rightW = w - rightX;
    if (leftW < 2 && rightW < 2) return;
    // Заливка боковин мягким лесным градиентом — имитация опушки, чтобы не было
    // чёрных «шторок», но при этом край визуально отделялся от поля.
    if (leftW > 2) {
      const g = ctx.createLinearGradient(0, 0, leftW, 0);
      g.addColorStop(0, '#2f4a2d');
      g.addColorStop(1, '#55743a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, leftW, h);
    }
    if (rightW > 2) {
      const g = ctx.createLinearGradient(rightX, 0, rightX + rightW, 0);
      g.addColorStop(0, '#55743a');
      g.addColorStop(1, '#2f4a2d');
      ctx.fillStyle = g;
      ctx.fillRect(rightX, 0, rightW, h);
    }
    // Деревьев минимум — только пара штук на каждой стороне ряда, самые ближние к полю.
    const rowH = t * 2.0;
    const startRow = Math.floor(cam) - 12;
    const endRow = Math.floor(cam) + 14;
    for (let r = startRow; r <= endRow; r++) {
      const y = (r - cam) * t + h * 0.62;
      if (leftW > t * 0.6) {
        const seed = ((r * 73) ^ 0x1311) & 0xffff;
        const rnd = (seed % 1000) / 1000;
        const tx = leftW - t * 0.5 - rnd * t * 0.4;
        const ty = y + ((seed % 100) / 100 - 0.5) * rowH * 0.3;
        const size = t * (0.55 + rnd * 0.2);
        ctx.drawImage(SPRITES.tree, tx - size / 2, ty - size * 0.7, size, size * 1.1);
      }
      if (rightW > t * 0.6) {
        const seed = ((r * 97) ^ 0x2111) & 0xffff;
        const rnd = (seed % 1000) / 1000;
        const tx = rightX + t * 0.5 + rnd * t * 0.4;
        const ty = y + ((seed % 100) / 100 - 0.5) * rowH * 0.3;
        const size = t * (0.55 + rnd * 0.2);
        ctx.drawImage(SPRITES.tree, tx - size / 2, ty - size * 0.7, size, size * 1.1);
      }
    }
  }

  function drawRow(ctx, row, y, t, fieldW) {
    const yTop = y - t / 2;
    if (row.type === 'grass' || row.type === 'coin') {
      // Тёмная/светлая полоса травы
      const shade = (row.index % 2 === 0) ? 0 : 1;
      const g = ctx.createLinearGradient(0, yTop, 0, yTop + t);
      if (shade) { g.addColorStop(0, '#2e7a3a'); g.addColorStop(1, '#266a31'); }
      else       { g.addColorStop(0, '#347f3e'); g.addColorStop(1, '#2b7035'); }
      ctx.fillStyle = g;
      ctx.fillRect(0, yTop, fieldW, t);
      // Декор — цветы
      if (row.decor) {
        for (const d of row.decor) {
          const cx = d.x * t + t / 2 + d.ox * t * 0.4;
          const cy = y + d.oy * t * 0.3;
          ctx.drawImage(SPRITES.flower, cx - t * 0.18, cy - t * 0.18, t * 0.36, t * 0.36);
        }
      }
      // Препятствия
      if (row.obstacles) {
        for (const o of row.obstacles) {
          const cx = o.x * t + t / 2;
          if (o.kind === 'tree') ctx.drawImage(SPRITES.tree, cx - t * 0.55, y - t * 0.85, t * 1.1, t * 1.3);
          else if (o.kind === 'stone') ctx.drawImage(SPRITES.stone, cx - t * 0.42, y - t * 0.35, t * 0.84, t * 0.7);
          else if (o.kind === 'bush') ctx.drawImage(SPRITES.bush, cx - t * 0.45, y - t * 0.5, t * 0.9, t * 0.9);
        }
      }
    } else {
      // Тропа — земляная с колеями
      const g = ctx.createLinearGradient(0, yTop, 0, yTop + t);
      g.addColorStop(0, '#6f4a2a'); g.addColorStop(0.5, '#4d2f15'); g.addColorStop(1, '#6f4a2a');
      ctx.fillStyle = g;
      ctx.fillRect(0, yTop, fieldW, t);
      // Бордюр
      ctx.strokeStyle = 'rgba(0,0,0,0.32)';
      ctx.lineWidth = Math.max(1, t * 0.03);
      ctx.beginPath(); ctx.moveTo(0, yTop + t * 0.05); ctx.lineTo(fieldW, yTop + t * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, yTop + t * 0.95); ctx.lineTo(fieldW, yTop + t * 0.95); ctx.stroke();
      // Следы лап
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      const step = t * 0.6; const offset = (row.index * 17) % step;
      for (let x = -offset; x < fieldW; x += step) {
        ctx.beginPath(); ctx.ellipse(x, yTop + t * 0.35, t * 0.06, t * 0.04, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + t * 0.3, yTop + t * 0.65, t * 0.06, t * 0.04, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Направление движения — тонкие штрихи
      ctx.strokeStyle = 'rgba(255,220,180,0.22)';
      ctx.lineWidth = Math.max(1, t * 0.03);
      const dirSign = row.dir > 0 ? 1 : -1;
      for (let x = 0; x < fieldW + t; x += t * 1.6) {
        const sx = ((x + (performance.now() * 0.04 * dirSign)) % (fieldW + t));
        ctx.beginPath(); ctx.moveTo(sx, yTop + t * 0.48);
        ctx.lineTo(sx + dirSign * t * 0.2, yTop + t * 0.48);
        ctx.stroke();
      }
    }
  }

  function drawEnemy(ctx, e, row, y, t) {
    const cx = (e.x + (e.size || 1) / 2) * t;
    const size = (e.size || 1);
    let spr, w, h;
    if (e.kind === 'wolf') { spr = SPRITES.wolf; w = size * t * 1.05; h = t * 0.85; }
    else if (e.kind === 'fox') { spr = SPRITES.fox; w = size * t * 0.9; h = t * 0.7; }
    else if (e.kind === 'bear') { spr = SPRITES.bear; w = size * t * 1.0; h = t * 1.05; }
    // Разворот по направлению движения
    const facing = row.dir > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(cx, y);
    if (facing < 0) ctx.scale(-1, 1);
    // Без wobble — спрайт едет ровно по горизонтали, не дёргается.
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawPlayer(ctx, t, baseline) {
    const p = S.player;
    if (!p) return;
    // Плавная позиция (с учётом hop)
    let rc, rr;
    if (p.hop) {
      const tt = Math.min(1, p.hop.t);
      rc = p.hop.fromC + (p.hop.toC - p.hop.fromC) * tt;
      rr = p.hop.fromR + (p.hop.toR - p.hop.fromR) * tt;
    } else {
      rc = p.col; rr = p.row;
    }
    p.renderCol = rc; p.renderRow = rr;
    const x = rc * t + t / 2;
    const y = (rr - S.camera) * t + baseline;
    // Прыжок-парабола
    let hopLift = 0;
    if (p.hop) {
      const tt = Math.min(1, p.hop.t);
      hopLift = Math.sin(tt * Math.PI) * t * 0.35;
    }
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + t * 0.3, t * 0.26 * (1 - hopLift / t * 0.4), t * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    const spr = SPRITES.bunny[S.selectedSkin] || SPRITES.bunny.white;
    const size = t * 0.88;
    ctx.drawImage(spr, x - size / 2, y - size / 2 - hopLift, size, size);
  }

  // ---------- Главный цикл ----------
  function frame(now) {
    try { stepFrame(now); } catch (e) { console.error('[forest-highway] frame error:', e); }
    requestAnimationFrame(frame);
  }
  function stepFrame(now) {
    const dt = Math.min(1 / 30, (now - S.lastFrame) / 1000 || 0);
    S.lastFrame = now;

    if (S.running && !S.paused && S.player) {
      // Обновление прыжка
      if (S.player.hop) {
        S.player.hop.t += dt * 1000 / HOP_MS;
        if (S.player.hop.t >= 1) finishHop();
      }
      // Камера: целимся на игрока (или фронт)
      S.targetCamera = Math.min(S.frontestRow - 0, S.player.row) - 1.0;
      S.camera += (S.targetCamera - S.camera) * CAMERA_LERP * (60 * dt);
      // Принудительный скролл вперёд — мягче, медленнее растёт со счётом (легче).
      const pressure = 0.04 + Math.min(0.25, S.score * 0.002);
      S.camera -= pressure * dt;
      ensureRows();

      // Обновление рядов
      for (const [, row] of S.rows) {
        if (!row.safe) updateRow(row, dt);
      }

      // Коллизии
      const hit = checkCollision();
      if (hit) {
        gameOver(hit.e.kind);
      } else {
        // Отставание от камеры
        if (S.player.row - S.camera > MAX_BEHIND_ROWS) gameOver('fall');
      }
    }

    render();
  }

  // ---------- Управление ----------
  function bindInput() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'w', 'W', 'ц', 'Ц'].includes(e.key)) { e.preventDefault(); startHop(-1, 0); }
      else if (['ArrowDown', 's', 'S', 'ы', 'Ы'].includes(e.key)) { e.preventDefault(); startHop(1, 0); }
      else if (['ArrowLeft', 'a', 'A', 'ф', 'Ф'].includes(e.key)) { e.preventDefault(); startHop(0, -1); }
      else if (['ArrowRight', 'd', 'D', 'в', 'В'].includes(e.key)) { e.preventDefault(); startHop(0, 1); }
      else if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); togglePause(); }
    });

    // Тачи: свайпы и тап (тап = прыжок вверх)
    let touchStart = null;
    S.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
    }, { passive: true });
    S.canvas.addEventListener('touchend', (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 24) { startHop(-1, 0); touchStart = null; return; }
      if (Math.abs(dx) > Math.abs(dy)) startHop(0, dx > 0 ? 1 : -1);
      else startHop(dy > 0 ? 1 : -1, 0);
      touchStart = null;
    }, { passive: true });

    // Клик по канвасу вне тача (десктоп) — прыжок в направлении клика
    S.canvas.addEventListener('mousedown', (e) => {
      if (!S.running || S.paused) return;
      const rect = S.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const p = S.player;
      const { sx, sy } = worldToScreen(p.col + 0.5, p.row + 0.5);
      const dx = x - sx, dy = y - sy;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { startHop(-1, 0); return; }
      if (Math.abs(dx) > Math.abs(dy)) startHop(0, dx > 0 ? 1 : -1);
      else startHop(dy > 0 ? 1 : -1, 0);
    });
  }

  // ---------- UI ----------
  const OVERLAYS = ['menuMain', 'menuSkins', 'menuPause', 'menuOver'];
  function showOverlay(id) {
    OVERLAYS.forEach((o) => document.getElementById(o).classList.toggle('show', o === id));
    S.menuOpen = id ? id.replace('menu', '').toLowerCase() : 'none';
    if (id === 'menuSkins') renderSkins();
    try { if (id && id !== 'menuMain') window.YSDK?.gameStop?.(); else if (!id) window.YSDK?.gameStart?.(); } catch (_) {}
  }
  function hideOverlays() {
    OVERLAYS.forEach((o) => document.getElementById(o).classList.remove('show'));
    S.menuOpen = 'none';
  }

  function updateHUD() {
    document.getElementById('coinsValue').textContent = S.coins;
    document.getElementById('scoreValue').textContent = S.score;
    document.getElementById('bestValue').textContent = S.best;
    document.getElementById('btnSound').classList.toggle('muted', !S.soundOn);
    document.getElementById('btnMusic').classList.toggle('muted', !S.musicOn);
  }

  function renderSkins() {
    const grid = document.getElementById('skinsGrid');
    grid.innerHTML = '';
    for (const key of SKIN_ORDER) {
      const s = SKINS[key];
      const owned = S.ownedSkins.has(key);
      const selected = S.selectedSkin === key;
      const card = document.createElement('div');
      card.className = 'skin-card' + (selected ? ' selected' : owned ? ' owned' : ' locked');
      // Превью: офсрин-канвас
      const pv = document.createElement('div'); pv.className = 'skin-preview';
      const sc = newOffscreen(172, 172);
      drawBunny(sc.getContext('2d'), 172, 172, key);
      pv.appendChild(sc);
      const name = document.createElement('div'); name.className = 'skin-name'; name.textContent = s.name;
      const cost = document.createElement('div'); cost.className = 'skin-cost';
      if (owned) cost.textContent = selected ? 'Выбрано' : 'Нажми, чтобы выбрать';
      else cost.innerHTML = '<span class="coin-ico">◎</span> ' + s.cost;
      const badge = document.createElement('div'); badge.className = 'skin-badge';
      badge.textContent = selected ? 'Активен' : owned ? 'Куплен' : 'Купить';
      card.appendChild(pv); card.appendChild(name); card.appendChild(cost); card.appendChild(badge);
      card.addEventListener('click', () => onSkinClick(key));
      grid.appendChild(card);
    }
  }

  function onSkinClick(key) {
    if (!S.ownedSkins.has(key)) {
      const s = SKINS[key];
      if (S.coins < s.cost) { toast('Не хватает ' + (s.cost - S.coins) + ' монет'); return; }
      S.coins -= s.cost;
      S.ownedSkins.add(key);
      Audio.newSkin();
      toast('Скин «' + s.name + '» открыт!');
    }
    S.selectedSkin = key;
    saveSave();
    updateHUD();
    renderSkins();
  }

  function toast(text, ms = 1700) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function startGame() {
    S.rows.clear();
    S.player = newPlayer();
    S.camera = -1;
    S.targetCamera = -1;
    S.topRow = 2; S.bottomRow = -1;
    S.frontestRow = 0;
    S.score = 0; S.sessionCoins = 0;
    S.running = true; S.paused = false; S.over = false;
    for (let r = -SPAWN_PAD_ROWS; r <= SPAWN_PAD_ROWS; r++) {
      if (!S.rows.has(r)) S.rows.set(r, createRow(r));
      if (r < S.topRow) S.topRow = r;
      if (r > S.bottomRow) S.bottomRow = r;
    }
    hideOverlays();
    Audio.resume();
    if (S.musicOn) Audio.musicStart();
    updateHUD();
  }

  function togglePause() {
    if (!S.running || S.over) return;
    S.paused = !S.paused;
    if (S.paused) showOverlay('menuPause'); else hideOverlays();
  }

  function bindUI() {
    document.getElementById('btnPlay').addEventListener('click', () => { Audio.resume(); startGame(); });
    document.getElementById('btnSkins').addEventListener('click', () => { S.previousMenu = S.menuOpen; showOverlay('menuSkins'); });
    document.getElementById('btnSkinsBack').addEventListener('click', () => {
      showOverlay(S.previousMenu === 'over' ? 'menuOver' : 'menuMain');
      S.previousMenu = null;
    });
    document.getElementById('btnResume').addEventListener('click', () => togglePause());
    document.getElementById('btnRestartFromPause').addEventListener('click', () => startGame());
    document.getElementById('btnPauseToMenu').addEventListener('click', () => { S.running = false; Audio.musicStop(); showOverlay('menuMain'); });
    document.getElementById('btnRetry').addEventListener('click', () => startGame());
    document.getElementById('btnOverSkins').addEventListener('click', () => { S.previousMenu = S.menuOpen; showOverlay('menuSkins'); });
    document.getElementById('btnOverMenu').addEventListener('click', () => { Audio.musicStop(); showOverlay('menuMain'); });
    document.getElementById('btnPause').addEventListener('click', () => togglePause());
    document.getElementById('btnSound').addEventListener('click', () => {
      S.soundOn = !S.soundOn; saveSave(); updateHUD();
    });
    document.getElementById('btnMusic').addEventListener('click', () => {
      S.musicOn = !S.musicOn; saveSave(); updateHUD();
      if (S.musicOn) Audio.musicStart(); else Audio.musicStop();
    });
  }

  // Счёт монет за сессию ведётся в finishHop через S.sessionCoins.
  // Баланс (S.coins) — кумулятивный, сохраняется в localStorage.

  // ---------- Start ----------
  function init() {
    loadSave();
    S.canvas = document.getElementById('stage');
    S.ctx = S.canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    buildSprites();
    bindInput();
    bindUI();
    updateHUD();
    S.lastFrame = performance.now();
    requestAnimationFrame(frame);

    // Инициализация SDK (не блокирует игру)
    if (window.YSDK) {
      window.YSDK.init().then(() => window.YSDK.gameReady());
    }

    // При первом любом взаимодействии — позволяем аудиоконтексту заработать.
    const resumeAudio = () => { Audio.resume(); window.removeEventListener('pointerdown', resumeAudio); window.removeEventListener('keydown', resumeAudio); };
    window.addEventListener('pointerdown', resumeAudio, { once: true });
    window.addEventListener('keydown', resumeAudio, { once: true });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
