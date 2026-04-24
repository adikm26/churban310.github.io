/* Симулятор Вандала — рогатка, камни, ценности.
   Физика: Matter.js. Рендер: 2D canvas, полностью программный (без внешних картинок).
   Работает офлайн и в Яндекс.Играх. */
(function () {
  'use strict';

  // =====================================================================
  // 0. Короткие алиасы
  // =====================================================================
  const M = Matter;
  const { Engine, World, Bodies, Body, Events, Constraint, Composite, Vector, Common } = M;

  // =====================================================================
  // 1. Константы мира
  // =====================================================================
  const VW = 1920;          // виртуальная ширина
  const VH = 1080;          // виртуальная высота
  const GROUND_Y = 1020;    // уровень земли
  const SLING_X = 260;      // положение рогатки (верх пращи)
  const SLING_Y = 820;
  const REST_X = SLING_X;
  const REST_Y = SLING_Y - 40;
  const DRAG_MAX = 260;     // макс. радиус натяжения
  const LAUNCH_K = 0.30;    // коэффициент силы выстрела

  // Категории коллизий
  const CAT = {
    GROUND: 0x0001,
    ROCK:   0x0002,
    BLOCK:  0x0004,
    VALUE:  0x0008,
  };

  // =====================================================================
  // 2. DOM
  // =====================================================================
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d', { alpha: true });

  const ui = {
    levelNum: $('levelNum'),
    levelName: $('levelName'),
    scoreValue: $('scoreValue'),
    coinsValue: $('coinsValue'),
    goal3: $('goal3'),
    rocksList: $('rocksList'),
    floaters: $('floaters'),
    toast: $('toast'),

    menuMain: $('menuMain'),
    menuLevels: $('menuLevels'),
    menuPause: $('menuPause'),
    menuWin: $('menuWin'),
    menuLose: $('menuLose'),
    levelsGrid: $('levelsGrid'),

    btnPlay: $('btnPlay'),
    btnLevels: $('btnLevels'),
    btnLevelsBack: $('btnLevelsBack'),
    btnResume: $('btnResume'),
    btnRestart: $('btnRestart'),
    btnToLevels: $('btnToLevels'),
    btnToMenu: $('btnToMenu'),
    btnPause: $('btnPause'),
    btnSound: $('btnSound'),
    btnNext: $('btnNext'),
    btnWinRetry: $('btnWinRetry'),
    btnWinLevels: $('btnWinLevels'),
    btnReward: $('btnReward'),
    btnLoseRetry: $('btnLoseRetry'),
    btnLoseLevels: $('btnLoseLevels'),

    winStars: $('winStars'),
    winScore: $('winScore'),
    winCoins: $('winCoins'),
    loseScore: $('loseScore'),
  };

  // =====================================================================
  // 3. Сохранение прогресса
  // =====================================================================
  const STORAGE_KEY = 'vandalSlingshot.v1';
  const save = {
    coins: 0,
    best: {},     // {1: {stars: 2, score: 1200}, ...}
    unlocked: 1,
    sound: true,
  };
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') Object.assign(save, obj);
      if (!save.best) save.best = {};
    } catch (_) {}
  }
  function writeSave() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (_) {}
  }

  // =====================================================================
  // 4. Определение «ценностей» и блоков.
  //    hp — запас прочности, points — очки за уничтожение, draw — рендер.
  // =====================================================================
  const ENTITY = {
    // ——— Ценности (цели уровня)
    vase: {
      kind: 'value', w: 54, h: 80, hp: 22, points: 50, density: 0.0018, restitution: 0.05, friction: 0.6,
      draw(b, e) { drawVase(b, e); },
    },
    painting: {
      kind: 'value', w: 130, h: 82, hp: 35, points: 100, density: 0.002, restitution: 0.1, friction: 0.5,
      draw(b, e) { drawPainting(b, e); },
    },
    oldTv: {
      kind: 'value', w: 110, h: 90, hp: 55, points: 200, density: 0.0035, restitution: 0.08, friction: 0.6,
      draw(b, e) { drawOldTv(b, e); },
    },
    chandelier: {
      kind: 'value', w: 110, h: 80, hp: 40, points: 300, density: 0.002, restitution: 0.1, friction: 0.3,
      draw(b, e) { drawChandelier(b, e); },
    },
    tv: {
      kind: 'value', w: 160, h: 100, hp: 90, points: 500, density: 0.004, restitution: 0.06, friction: 0.7,
      draw(b, e) { drawPremiumTv(b, e); },
    },
    diamond: {
      kind: 'value', w: 56, h: 52, hp: 160, points: 1000, density: 0.008, restitution: 0.2, friction: 0.4,
      draw(b, e) { drawDiamond(b, e); },
    },

    // ——— Блоки конструкции (дают мало очков, но нужны для строений)
    wood:  { kind: 'block', w: 90,  h: 22, hp: 35,  points: 10, density: 0.0018, restitution: 0.05, friction: 0.6, draw: (b,e)=>drawBlock(b,e,'wood')  },
    woodL: { kind: 'block', w: 140, h: 22, hp: 45,  points: 15, density: 0.002,  restitution: 0.05, friction: 0.6, draw: (b,e)=>drawBlock(b,e,'wood')  },
    woodXL:{ kind: 'block', w: 220, h: 24, hp: 60,  points: 20, density: 0.002,  restitution: 0.05, friction: 0.6, draw: (b,e)=>drawBlock(b,e,'wood')  },
    woodV: { kind: 'block', w: 22,  h: 90, hp: 35,  points: 10, density: 0.0018, restitution: 0.05, friction: 0.6, draw: (b,e)=>drawBlock(b,e,'wood')  },
    stone: { kind: 'block', w: 70,  h: 22, hp: 90,  points: 20, density: 0.0042, restitution: 0.02, friction: 0.8, draw: (b,e)=>drawBlock(b,e,'stone') },
    stoneL:{ kind: 'block', w: 140, h: 22, hp: 110, points: 25, density: 0.0045, restitution: 0.02, friction: 0.8, draw: (b,e)=>drawBlock(b,e,'stone') },
    stoneXL:{kind: 'block', w: 220, h: 24, hp: 140, points: 30, density: 0.0045, restitution: 0.02, friction: 0.8, draw: (b,e)=>drawBlock(b,e,'stone') },
    stoneV:{ kind: 'block', w: 22,  h: 90, hp: 90,  points: 20, density: 0.0042, restitution: 0.02, friction: 0.8, draw: (b,e)=>drawBlock(b,e,'stone') },
    glass: { kind: 'block', w: 90,  h: 22, hp: 14,  points: 5,  density: 0.0012, restitution: 0.1,  friction: 0.3, draw: (b,e)=>drawBlock(b,e,'glass') },
    glassL:{ kind: 'block', w: 220, h: 22, hp: 18,  points: 8,  density: 0.0012, restitution: 0.1,  friction: 0.3, draw: (b,e)=>drawBlock(b,e,'glass') },
    glassV:{ kind: 'block', w: 22,  h: 90, hp: 14,  points: 5,  density: 0.0012, restitution: 0.1,  friction: 0.3, draw: (b,e)=>drawBlock(b,e,'glass') },
  };

  // =====================================================================
  // 5. Типы камней
  // =====================================================================
  const ROCKS = {
    stone: { r: 24, density: 0.022, restitution: 0.28, friction: 0.35, dmg: 1.0, color1: '#cfc6b6', color2: '#4a4033' },
    big:   { r: 36, density: 0.028, restitution: 0.20, friction: 0.45, dmg: 1.55, color1: '#a79f90', color2: '#302418' },
    bomb:  { r: 28, density: 0.018, restitution: 0.22, friction: 0.40, dmg: 1.0, color1: '#4d4842', color2: '#0a0604' },
  };

  // =====================================================================
  // 6. Определение уровней
  //    Каждый уровень: name, rocks[], entities[], goals (для 2/3 звёзд)
  // =====================================================================
  // Утилитарные константы для выстраивания стоек:
  //  - вертикальная стойка woodV/stoneV: h=90 → центр y = GROUND_Y-45 (низ=1020)
  //  - горизонтальная полка (22 выс.) на стойках ставится центром y = GROUND_Y-101 (низ=919=верх стойки)
  //  - ценность h (напр. 80) на полке ставится центром y = GROUND_Y - (101+11+h/2)
  const LEVELS = [
    // ---------- 1. Кабинет коллекционера ----------
    {
      name: 'Кабинет коллекционера',
      rocks: ['stone', 'stone', 'stone'],
      star2: 250, star3: 450,
      entities: [
        // Левая стопка с вазой: две плашки + ваза
        { type: 'woodL', x: 1200, y: GROUND_Y - 11 },
        { type: 'woodL', x: 1200, y: GROUND_Y - 33 },
        { type: 'vase',  x: 1200, y: GROUND_Y - 84 },
        // Правая — картина на двух стенках, с полкой-мостиком
        { type: 'woodV', x: 1460, y: GROUND_Y - 45 },
        { type: 'woodV', x: 1600, y: GROUND_Y - 45 },
        { type: 'woodL', x: 1530, y: GROUND_Y - 101 },   // мостик 140 = спан стоек
        { type: 'painting', x: 1530, y: GROUND_Y - 153 },
      ],
    },
    // ---------- 2. Гостиная 80-х ----------
    {
      name: 'Гостиная 80-х',
      rocks: ['stone', 'stone', 'big', 'stone'],
      star2: 600, star3: 1100,
      entities: [
        // Левая тумба с вазой — стойки 100 апарт, полка 140 с напуском
        { type: 'woodV', x: 1080, y: GROUND_Y - 45 },
        { type: 'woodV', x: 1180, y: GROUND_Y - 45 },
        { type: 'woodL', x: 1130, y: GROUND_Y - 101 },
        { type: 'vase',  x: 1130, y: GROUND_Y - 152 },

        // Центральная тумба под ламповый ТВ — стойки 140, полка 140
        { type: 'stoneV', x: 1360, y: GROUND_Y - 45 },
        { type: 'stoneV', x: 1500, y: GROUND_Y - 45 },
        { type: 'stoneL', x: 1430, y: GROUND_Y - 101 },
        { type: 'oldTv',  x: 1430, y: GROUND_Y - 157 },

        // Правая тумба с картиной
        { type: 'woodV', x: 1640, y: GROUND_Y - 45 },
        { type: 'woodV', x: 1780, y: GROUND_Y - 45 },
        { type: 'woodL', x: 1710, y: GROUND_Y - 101 },
        { type: 'painting', x: 1710, y: GROUND_Y - 153 },
      ],
    },
    // ---------- 3. Галерея со свисающей люстрой ----------
    {
      name: 'Галерея с люстрой',
      rocks: ['stone', 'big', 'stone', 'big'],
      star2: 1100, star3: 1800,
      entities: [
        // Свисающая с потолка люстра
        { type: 'chandelier', x: 1400, y: 420, hanging: true, anchor: { x: 1400, y: 140 } },

        // Слева: двухэтажная этажерка с двумя вазами
        { type: 'stoneV', x: 990,  y: GROUND_Y - 45 },
        { type: 'stoneV', x: 1130, y: GROUND_Y - 45 },
        { type: 'stoneL', x: 1060, y: GROUND_Y - 101 },
        { type: 'vase',   x: 1030, y: GROUND_Y - 152 },
        { type: 'vase',   x: 1090, y: GROUND_Y - 152 },

        // Справа: высокая двухэтажная стена с картиной наверху (спан 140)
        { type: 'stoneV', x: 1660, y: GROUND_Y - 45 },
        { type: 'stoneV', x: 1800, y: GROUND_Y - 45 },
        { type: 'stoneL', x: 1730, y: GROUND_Y - 101 },

        { type: 'stoneV', x: 1660, y: GROUND_Y - 157 },
        { type: 'stoneV', x: 1800, y: GROUND_Y - 157 },
        { type: 'stoneL', x: 1730, y: GROUND_Y - 213 },

        { type: 'painting', x: 1730, y: GROUND_Y - 265 },
      ],
    },
    // ---------- 4. Шоурум премиум-техники ----------
    {
      name: 'Шоурум премиум-техники',
      rocks: ['stone', 'big', 'big', 'bomb', 'stone'],
      star2: 2200, star3: 3500,
      entities: [
        // Левая — этажерка с двумя вазами и картиной
        { type: 'woodV', x: 930,  y: GROUND_Y - 45 },
        { type: 'woodV', x: 1070, y: GROUND_Y - 45 },
        { type: 'woodL', x: 1000, y: GROUND_Y - 101 },
        { type: 'vase',  x: 970,  y: GROUND_Y - 152 },
        { type: 'vase',  x: 1030, y: GROUND_Y - 152 },
        // Второй этаж
        { type: 'woodV', x: 930,  y: GROUND_Y - 157 },
        { type: 'woodV', x: 1070, y: GROUND_Y - 157 },
        { type: 'woodL', x: 1000, y: GROUND_Y - 213 },
        { type: 'painting', x: 1000, y: GROUND_Y - 265 },

        // Центр — стеклянная витрина с премиум ТВ
        { type: 'stoneV', x: 1240, y: GROUND_Y - 45 },
        { type: 'stoneV', x: 1460, y: GROUND_Y - 45 },
        { type: 'stoneXL', x: 1350, y: GROUND_Y - 102 },   // мощная полка на 220
        // Стеклянные боковые щитки по краям витрины (рядом с TV)
        { type: 'glassV', x: 1260, y: GROUND_Y - 159 },    // бок слева
        { type: 'glassV', x: 1440, y: GROUND_Y - 159 },    // бок справа
        { type: 'tv',     x: 1350, y: GROUND_Y - 164 },
        // Стеклянный козырёк сверху
        { type: 'glassL', x: 1350, y: GROUND_Y - 215 },

        // Справа — комод со старым ТВ
        { type: 'woodV', x: 1650, y: GROUND_Y - 45 },
        { type: 'woodV', x: 1790, y: GROUND_Y - 45 },
        { type: 'woodL', x: 1720, y: GROUND_Y - 101 },
        { type: 'oldTv', x: 1720, y: GROUND_Y - 157 },
        { type: 'vase',  x: 1670, y: GROUND_Y - 208 },
      ],
    },
    // ---------- 5. Хранилище с алмазом ----------
    {
      name: 'Хранилище с алмазом',
      rocks: ['stone', 'big', 'big', 'bomb', 'bomb', 'stone'],
      star2: 4500, star3: 6500,
      entities: [
        // Вводная: маленькая пирамидка с вазой и картиной над ней
        { type: 'woodL', x: 900, y: GROUND_Y - 11 },
        { type: 'woodL', x: 900, y: GROUND_Y - 33 },
        { type: 'vase',  x: 900, y: GROUND_Y - 84 },

        // Каменный бункер с алмазом под двойной крышей
        { type: 'stoneV', x: 1250, y: GROUND_Y - 45 },
        { type: 'stoneV', x: 1470, y: GROUND_Y - 45 },
        { type: 'stoneXL', x: 1360, y: GROUND_Y - 102 },   // 220w, точно на стойки 220 апарт
        // Алмаз — стоит на полу бункера между стойками
        { type: 'diamond', x: 1360, y: GROUND_Y - 26 },
        // Второй этаж бункера
        { type: 'stoneV', x: 1250, y: GROUND_Y - 158 },
        { type: 'stoneV', x: 1470, y: GROUND_Y - 158 },
        { type: 'stoneXL', x: 1360, y: GROUND_Y - 215 },
        // Наверху — премиум-ТВ
        { type: 'tv',     x: 1360, y: GROUND_Y - 277 },

        // Подвесная люстра рядом над правой этажеркой
        { type: 'chandelier', x: 1700, y: 420, hanging: true, anchor: { x: 1700, y: 140 } },

        // Справа — этажерка со старым ТВ и вазой сверху
        { type: 'stoneV', x: 1650, y: GROUND_Y - 45 },
        { type: 'stoneV', x: 1790, y: GROUND_Y - 45 },
        { type: 'stoneL', x: 1720, y: GROUND_Y - 101 },
        { type: 'oldTv',  x: 1720, y: GROUND_Y - 157 },
        { type: 'vase',   x: 1680, y: GROUND_Y - 208 },
      ],
    },
  ];

  // =====================================================================
  // 7. Состояние игры
  // =====================================================================
  const gameState = {
    engine: null,
    world: null,
    entities: [],        // {body, type, kind, hp, maxHp, points, dead}
    currentRockIndex: 0,
    rockBody: null,      // активный камень (physics body) или null
    rockType: null,      // 'stone' | 'big' | 'bomb'
    launched: false,
    dragging: false,
    dragPos: null,       // {x, y} в виртуальных координатах
    aimStart: null,
    levelIndex: 0,
    score: 0,
    finished: false,
    paused: false,
    lastTime: 0,
    particles: [],
    settleTimer: 0,
    targetCount: 0,
    bonusRocks: 0,
    startedAt: 0,
  };

  // =====================================================================
  // 8. Инициализация и ресет физики
  // =====================================================================
  function createEngine() {
    const engine = Engine.create({ enableSleeping: true });
    engine.world.gravity.y = 1.2;
    engine.positionIterations = 8;
    engine.velocityIterations = 7;
    engine.constraintIterations = 4;
    gameState.engine = engine;
    gameState.world = engine.world;
    Events.on(engine, 'collisionStart', onCollisions);
  }

  function clearWorld() {
    if (!gameState.world) return;
    Composite.clear(gameState.world, false, true);
    gameState.entities = [];
    gameState.particles.length = 0;
    gameState.rockBody = null;
    gameState.launched = false;
    gameState.dragging = false;
  }

  function buildStatic() {
    const w = gameState.world;
    // Земля
    const ground = Bodies.rectangle(VW / 2, GROUND_Y + 60, VW + 400, 120, {
      isStatic: true, friction: 0.9, restitution: 0.05,
      collisionFilter: { category: CAT.GROUND, mask: CAT.ROCK | CAT.BLOCK | CAT.VALUE },
      plugin: { kind: 'ground' },
    });
    // Невидимые стены, чтобы объекты не улетали по горизонтали за пределы слишком далеко
    const leftWall  = Bodies.rectangle(-200, VH / 2, 400, VH * 2, { isStatic: true, collisionFilter: { category: CAT.GROUND, mask: CAT.ROCK | CAT.BLOCK | CAT.VALUE } });
    const rightWall = Bodies.rectangle(VW + 200, VH / 2, 400, VH * 2, { isStatic: true, collisionFilter: { category: CAT.GROUND, mask: CAT.ROCK | CAT.BLOCK | CAT.VALUE } });
    Composite.add(w, [ground, leftWall, rightWall]);
  }

  function buildLevel(level) {
    const anchors = []; // для люстр
    level.entities.forEach((ent) => {
      const def = ENTITY[ent.type];
      if (!def) return;
      const isValue = def.kind === 'value';
      const category = isValue ? CAT.VALUE : CAT.BLOCK;
      const body = Bodies.rectangle(ent.x, ent.y, def.w, def.h, {
        density: def.density,
        restitution: def.restitution,
        friction: def.friction,
        frictionAir: 0.002,
        slop: 0.01,
        chamfer: { radius: 2 },
        collisionFilter: { category, mask: CAT.ROCK | CAT.BLOCK | CAT.VALUE | CAT.GROUND },
      });
      const e = {
        body, type: ent.type, def,
        kind: def.kind,
        hp: def.hp, maxHp: def.hp,
        points: def.points,
        dead: false,
        shake: 0,
      };
      body.plugin = { entity: e };
      gameState.entities.push(e);
      Composite.add(gameState.world, body);
      if (ent.hanging && ent.anchor) {
        anchors.push({ body, anchor: ent.anchor });
        e.hangAnchor = ent.anchor;
      }
    });

    // Подвесные люстры: два шарнира для покачивания
    anchors.forEach(({ body, anchor }) => {
      const offY = -36;
      const leftX = -18, rightX = 18;
      const lenL = Math.hypot((anchor.x - 18) - (body.position.x + leftX),  anchor.y - (body.position.y + offY));
      const lenR = Math.hypot((anchor.x + 18) - (body.position.x + rightX), anchor.y - (body.position.y + offY));
      const c1 = Constraint.create({
        pointA: { x: anchor.x - 18, y: anchor.y }, bodyB: body, pointB: { x: leftX, y: offY },
        stiffness: 0.8, damping: 0.15, length: lenL,
      });
      const c2 = Constraint.create({
        pointA: { x: anchor.x + 18, y: anchor.y }, bodyB: body, pointB: { x: rightX, y: offY },
        stiffness: 0.8, damping: 0.15, length: lenR,
      });
      Composite.add(gameState.world, [c1, c2]);
    });
  }

  // =====================================================================
  // 9. Камни и рогатка
  // =====================================================================
  function currentRockType() {
    const level = LEVELS[gameState.levelIndex];
    const queue = level.rocks;
    const idx = gameState.currentRockIndex;
    if (gameState.bonusRocks > 0 && idx >= queue.length) {
      return 'stone';
    }
    return queue[idx] || null;
  }

  function spawnRock() {
    const type = currentRockType();
    if (!type) { gameState.rockBody = null; return false; }
    const def = ROCKS[type];
    const body = Bodies.circle(REST_X, REST_Y, def.r, {
      density: def.density,
      restitution: def.restitution,
      friction: def.friction,
      frictionAir: 0.001,
      isStatic: true, // покоится до выстрела
      collisionFilter: { category: CAT.ROCK, mask: CAT.BLOCK | CAT.VALUE | CAT.GROUND },
      plugin: { kind: 'rock', rockType: type },
    });
    Composite.add(gameState.world, body);
    gameState.rockBody = body;
    gameState.rockType = type;
    gameState.launched = false;
    gameState.settleTimer = 0;
    updateRocksUi();
    return true;
  }

  function launchRock(fromX, fromY) {
    if (!gameState.rockBody) return;
    const dx = REST_X - fromX;
    const dy = REST_Y - fromY;
    const vx = dx * LAUNCH_K;
    const vy = dy * LAUNCH_K;
    // Создаём новое динамическое тело на месте выстрела —
    // переход static→dynamic в Matter.js у «свежих» тел даёт NaN-скорость,
    // поэтому просто удаляем старое и создаём новое с нужной скоростью.
    const type = gameState.rockType;
    const def = ROCKS[type];
    Composite.remove(gameState.world, gameState.rockBody);
    const body = Bodies.circle(fromX, fromY, def.r, {
      density: def.density,
      restitution: def.restitution,
      friction: def.friction,
      frictionAir: 0.001,
      collisionFilter: { category: CAT.ROCK, mask: CAT.BLOCK | CAT.VALUE | CAT.GROUND },
      plugin: { kind: 'rock', rockType: type },
    });
    Composite.add(gameState.world, body);
    gameState.rockBody = body;
    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.2);
    gameState.launched = true;
    gameState.currentRockIndex++;
  }

  // Тап по активному камню в полёте: бомба — взрыв; остальные — ускорение по траектории.
  function onRockTap() {
    if (!gameState.rockBody || !gameState.launched) return;
    if (gameState.rockType === 'bomb') {
      detonate(gameState.rockBody.position.x, gameState.rockBody.position.y, 180, 280);
      Composite.remove(gameState.world, gameState.rockBody);
      gameState.rockBody = null;
    } else {
      const v = gameState.rockBody.velocity;
      const k = 1.35;
      Body.setVelocity(gameState.rockBody, { x: v.x * k, y: v.y * k });
      spawnSmoke(gameState.rockBody.position.x, gameState.rockBody.position.y, 8);
    }
  }

  // =====================================================================
  // 10. Взрыв
  // =====================================================================
  function detonate(x, y, radius, maxDmg) {
    spawnExplosion(x, y, radius);
    // Импульс и урон по всем близким сущностям
    gameState.entities.forEach((e) => {
      if (e.dead) return;
      const dx = e.body.position.x - x;
      const dy = e.body.position.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) return;
      const k = 1 - d / radius;
      const dmg = maxDmg * k;
      applyDamage(e, dmg);
      const m = e.body.mass || 1;
      const force = 0.22 * k;
      const nx = dx / (d || 1), ny = dy / (d || 1);
      Body.applyForce(e.body, e.body.position, { x: nx * force * m, y: ny * force * m - 0.02 * m });
    });
    shake(18);
  }

  // =====================================================================
  // 11. Коллизии и урон
  // =====================================================================
  function onCollisions(evt) {
    // Период «усадки» — не наносим урон, пока мир устаканивается
    const grace = performance.now() - gameState.startedAt < 1000;
    const pairs = evt.pairs;
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const a = p.bodyA, b = p.bodyB;
      const va = a.velocity, vb = b.velocity;
      const rvx = va.x - vb.x, rvy = va.y - vb.y;
      const speed = Math.hypot(rvx, rvy);
      if (speed < 2.5) continue;
      // Учитываем и массу (тяжёлые блоки пробивают лучше)
      const mA = a.mass || 1, mB = b.mass || 1;
      const effective = speed * Math.min(2.2, Math.sqrt(Math.max(mA, mB)));
      if (effective < 7) continue;
      if (grace && effective < 16) continue;

      const eA = a.plugin && a.plugin.entity;
      const eB = b.plugin && b.plugin.entity;
      const isRockA = a.plugin && a.plugin.kind === 'rock';
      const isRockB = b.plugin && b.plugin.kind === 'rock';
      const rockPlugin = isRockA ? a.plugin : (isRockB ? b.plugin : null);
      const rockMult = rockPlugin ? ROCKS[rockPlugin.rockType].dmg : 1.0;

      // Бомба детонирует при любом ощутимом контакте
      if (isRockA && a.plugin.rockType === 'bomb' && effective > 5 && a === gameState.rockBody) {
        detonate(a.position.x, a.position.y, 180, 280);
        Composite.remove(gameState.world, a);
        gameState.rockBody = null;
        continue;
      }
      if (isRockB && b.plugin.rockType === 'bomb' && effective > 5 && b === gameState.rockBody) {
        detonate(b.position.x, b.position.y, 180, 280);
        Composite.remove(gameState.world, b);
        gameState.rockBody = null;
        continue;
      }

      const damage = (effective - 6) * 3.2 * rockMult;
      if (eA) applyDamage(eA, damage);
      if (eB) applyDamage(eB, damage);

      // Частицы удара
      const pt = p.collision && p.collision.supports && p.collision.supports[0];
      if (pt) spawnHitParticles(pt.x, pt.y, 6, effective);
    }
  }

  function applyDamage(e, dmg) {
    if (!e || e.dead || dmg <= 0) return;
    e.hp -= dmg;
    e.shake = Math.min(1, e.shake + dmg * 0.02);
    if (e.hp <= 0) {
      e.dead = true;
      destroyEntity(e);
    }
  }

  function destroyEntity(e) {
    Composite.remove(gameState.world, e.body);
    gameState.score += e.points;
    updateScoreUi();
    // Очки-флоатер в экранных координатах
    const sp = worldToScreen(e.body.position.x, e.body.position.y);
    floaterAt(sp.x, sp.y, `+${e.points}`, e.points >= 500 ? 'huge' : (e.points >= 200 ? 'big' : ''));
    // Осколки
    spawnShatter(e.body.position.x, e.body.position.y, e.def.w, e.def.h, pickShatterColor(e.type));
    if (e.kind === 'value') {
      gameState.targetCount--;
      if (gameState.targetCount <= 0) {
        completeLevel(true);
      }
    }
  }

  function pickShatterColor(type) {
    switch (type) {
      case 'vase': return ['#d67a2b', '#9c4d11', '#f2b36e'];
      case 'painting': return ['#f4d58b', '#b36a2b', '#5a3110'];
      case 'oldTv': return ['#bcbcbc', '#6b6b6b', '#f6e7b6'];
      case 'chandelier': return ['#ffe9a6', '#ffd15c', '#fff7d0'];
      case 'tv': return ['#2a2f39', '#8aa9d8', '#dfe8f6'];
      case 'diamond': return ['#b9ecff', '#7fd6ff', '#e6faff'];
      case 'wood': case 'woodL': case 'woodV': return ['#7a4a20', '#b3753a', '#e5b377'];
      case 'stone': case 'stoneL': case 'stoneV': return ['#8e8e8e', '#5a5a5a', '#c1c1c1'];
      case 'glass': case 'glassV': return ['#cfe9f4', '#88bed3', '#ecf7fb'];
      default: return ['#aaa', '#666', '#ddd'];
    }
  }

  // =====================================================================
  // 12. Частицы и эффекты
  // =====================================================================
  function spawnHitParticles(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      gameState.particles.push({
        x, y, vx: (Math.random() - 0.5) * (2 + speed * 0.1),
        vy: (Math.random() - 1) * (1 + speed * 0.05),
        life: 0.5 + Math.random() * 0.4, ttl: 0.5 + Math.random() * 0.4,
        size: 3 + Math.random() * 3, color: '#fff5c6', grav: 0.3,
      });
    }
  }
  function spawnSmoke(x, y, n) {
    for (let i = 0; i < n; i++) {
      gameState.particles.push({
        x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2 - 1,
        life: 0.6, ttl: 0.6, size: 8 + Math.random() * 8, color: '#efe0c8', grav: -0.1, alpha: 0.5,
      });
    }
  }
  function spawnExplosion(x, y, radius) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 8;
      gameState.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, ttl: 0.5 + Math.random() * 0.4,
        size: 4 + Math.random() * 6, color: Math.random() < 0.6 ? '#ffd66a' : '#ff7a1a', grav: 0.2,
      });
    }
    // Кольцо ударной волны
    gameState.particles.push({ x, y, ring: true, r: 6, maxR: radius, life: 0.3, ttl: 0.3 });
  }
  function spawnShatter(x, y, w, h, palette) {
    const n = Math.min(26, 8 + Math.floor((w + h) / 12));
    for (let i = 0; i < n; i++) {
      const color = palette[Math.floor(Math.random() * palette.length)];
      gameState.particles.push({
        x: x + (Math.random() - 0.5) * w * 0.8,
        y: y + (Math.random() - 0.5) * h * 0.8,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 1) * 6,
        life: 0.8 + Math.random() * 0.5, ttl: 0.8 + Math.random() * 0.5,
        size: 3 + Math.random() * 5, color, grav: 0.45, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  let shakeAmp = 0;
  function shake(amp) { shakeAmp = Math.max(shakeAmp, amp); }
  function updateParticles(dt) {
    const arr = gameState.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      if (p.ring) { p.r += (p.maxR - 6) * (dt / p.ttl); continue; }
      p.vx *= 0.99; p.vy += (p.grav || 0.3) * dt * 60;
      p.x += p.vx; p.y += p.vy;
      if (p.rot != null) p.rot += (p.vr || 0);
    }
    if (shakeAmp > 0) shakeAmp = Math.max(0, shakeAmp - dt * 40);
  }

  // =====================================================================
  // 13. Отрисовка сущностей
  // =====================================================================
  function hpFrac(e) { return Math.max(0, Math.min(1, e.hp / e.maxHp)); }
  function drawCracks(ctx, w, h, frac) {
    if (frac > 0.66) return;
    const dmg = 1 - frac;
    ctx.save();
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * dmg})`;
    ctx.lineWidth = 1.2;
    const n = Math.floor(2 + dmg * 6);
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      const x = -w / 2 + Math.random() * w;
      const y = -h / 2 + Math.random() * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * w * 0.35, y + (Math.random() - 0.5) * h * 0.35);
      ctx.lineTo(x + (Math.random() - 0.5) * w * 0.55, y + (Math.random() - 0.5) * h * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVase(b, e) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    // Тело вазы: орнамент в виде амфоры
    const grad = ctx.createLinearGradient(-w/2, 0, w/2, 0);
    grad.addColorStop(0, '#a3531a'); grad.addColorStop(0.5, '#e08a35'); grad.addColorStop(1, '#8a3f11');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-w*0.35, -h*0.45);
    ctx.bezierCurveTo(-w*0.55,  h*0.05, -w*0.55, h*0.3, -w*0.28, h*0.5);
    ctx.lineTo(w*0.28, h*0.5);
    ctx.bezierCurveTo(w*0.55, h*0.3, w*0.55, 0.05, w*0.35, -h*0.45);
    ctx.closePath();
    ctx.fill();
    // Горло
    ctx.fillStyle = '#5a2a0c';
    ctx.fillRect(-w*0.2, -h*0.5, w*0.4, h*0.12);
    // Полоса-орнамент
    ctx.fillStyle = '#f2c890';
    ctx.fillRect(-w*0.4, -h*0.05, w*0.8, 4);
    ctx.fillRect(-w*0.4, h*0.18, w*0.8, 3);
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawPainting(b, e) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    // Рама
    ctx.fillStyle = '#caa05a';
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.fillStyle = '#7a4f18';
    ctx.fillRect(-w/2 + 6, -h/2 + 6, w - 12, h - 12);
    // Полотно — закат над полем
    const g = ctx.createLinearGradient(0, -h/2 + 8, 0, h/2 - 8);
    g.addColorStop(0, '#f9c77a'); g.addColorStop(0.55, '#e8744a'); g.addColorStop(1, '#6d3a1a');
    ctx.fillStyle = g;
    ctx.fillRect(-w/2 + 12, -h/2 + 12, w - 24, h - 24);
    // Солнце
    ctx.fillStyle = '#fff1b7';
    ctx.beginPath(); ctx.arc(0, -h*0.05, Math.min(w, h) * 0.12, 0, Math.PI * 2); ctx.fill();
    // Рамочная подпись
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-w*0.2, h/2 - 14, w*0.4, 4);
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawOldTv(b, e) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    // Корпус
    const g = ctx.createLinearGradient(-w/2, -h/2, w/2, h/2);
    g.addColorStop(0, '#e4d6b4'); g.addColorStop(1, '#8d7a52');
    ctx.fillStyle = g;
    roundRect(ctx, -w/2, -h/2, w, h, 8); ctx.fill();
    // Экран
    ctx.fillStyle = '#1d2024';
    roundRect(ctx, -w*0.38, -h*0.36, w*0.66, h*0.6, 6); ctx.fill();
    // Отражение
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(-w*0.35, -h*0.3); ctx.lineTo(-w*0.1, -h*0.3); ctx.lineTo(-w*0.3, h*0.15); ctx.lineTo(-w*0.35, h*0.1); ctx.closePath(); ctx.fill();
    // Крутилки
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(w*0.36, -h*0.15, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(w*0.36, h*0.05, 5, 0, Math.PI*2); ctx.fill();
    // Антенны
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w*0.1, -h*0.5); ctx.lineTo(-w*0.3, -h*0.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w*0.05, -h*0.5); ctx.lineTo(w*0.25, -h*0.9); ctx.stroke();
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawChandelier(b, e) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    // Основа
    ctx.fillStyle = '#b08a2b';
    roundRect(ctx, -w*0.4, -h*0.1, w*0.8, h*0.2, 10); ctx.fill();
    // Свечи-подвесы
    const candles = 5;
    ctx.fillStyle = '#efe4b0';
    for (let i = 0; i < candles; i++) {
      const cx = -w*0.35 + (w*0.7 / (candles - 1)) * i;
      ctx.fillRect(cx - 3, h*0.05, 6, h*0.25);
      // Огонёк
      ctx.fillStyle = '#ffd07a';
      ctx.beginPath(); ctx.arc(cx, h*0.05 - 2, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff5c0';
      ctx.beginPath(); ctx.arc(cx, h*0.05 - 3, 2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#efe4b0';
    }
    // Хрусталики
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 7; i++) {
      const cx = -w*0.35 + (w*0.7 / 6) * i;
      ctx.beginPath(); ctx.moveTo(cx, h*0.1); ctx.lineTo(cx - 4, h*0.25); ctx.lineTo(cx + 4, h*0.25); ctx.closePath(); ctx.fill();
    }
    // Верёвка сверху
    ctx.strokeStyle = '#5a3b0e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -h*0.1); ctx.lineTo(0, -h*0.5); ctx.stroke();
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawPremiumTv(b, e) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    // Рамка
    const g = ctx.createLinearGradient(0, -h/2, 0, h/2);
    g.addColorStop(0, '#2a2f39'); g.addColorStop(1, '#12151c');
    ctx.fillStyle = g;
    roundRect(ctx, -w/2, -h/2, w, h, 6); ctx.fill();
    // Экран
    const sx = -w/2 + 6, sy = -h/2 + 6, sw = w - 12, sh = h - 12;
    const sg = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
    sg.addColorStop(0, '#0b2a55'); sg.addColorStop(0.5, '#17a2d6'); sg.addColorStop(1, '#0b2a55');
    ctx.fillStyle = sg;
    roundRect(ctx, sx, sy, sw, sh, 3); ctx.fill();
    // «Картинка» на экране — абстрактные полосы
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx + 6, sy + 6, sw * 0.3, 3);
    ctx.fillRect(sx + 6, sy + 14, sw * 0.5, 3);
    ctx.fillStyle = '#ffcf4e';
    ctx.fillRect(sx + sw * 0.55, sy + sh * 0.3, sw * 0.25, sh * 0.15);
    ctx.globalAlpha = 1;
    // Логотип снизу
    ctx.fillStyle = '#aab'; ctx.fillRect(-6, h/2 - 5, 12, 2);
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawDiamond(b, e) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    // Алмаз огранки «роза»
    const grad = ctx.createLinearGradient(-w/2, -h/2, w/2, h/2);
    grad.addColorStop(0, '#e6faff'); grad.addColorStop(0.5, '#7fd6ff'); grad.addColorStop(1, '#2b7bb3');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -h/2);
    ctx.lineTo(w/2, -h*0.15);
    ctx.lineTo(w*0.3, h/2);
    ctx.lineTo(-w*0.3, h/2);
    ctx.lineTo(-w/2, -h*0.15);
    ctx.closePath();
    ctx.fill();
    // Грани
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -h/2); ctx.lineTo(-w*0.15, -h*0.15); ctx.lineTo(w*0.15, -h*0.15); ctx.closePath();
    ctx.moveTo(-w/2, -h*0.15); ctx.lineTo(-w*0.15, -h*0.15);
    ctx.moveTo(w/2, -h*0.15); ctx.lineTo(w*0.15, -h*0.15);
    ctx.moveTo(-w*0.15, -h*0.15); ctx.lineTo(-w*0.3, h/2);
    ctx.moveTo(w*0.15, -h*0.15); ctx.lineTo(w*0.3, h/2);
    ctx.stroke();
    // Блик
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(-w*0.18, -h*0.25, w*0.1, h*0.06, 0.3, 0, Math.PI*2); ctx.fill();
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawBlock(b, e, material) {
    const { x, y } = b.position; const a = b.angle;
    const w = e.def.w, h = e.def.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    let c1, c2, stroke;
    if (material === 'wood') { c1 = '#c18844'; c2 = '#6b3d14'; stroke = '#3a1f05'; }
    else if (material === 'stone') { c1 = '#a6a39a'; c2 = '#4e4a42'; stroke = '#2a2824'; }
    else { c1 = 'rgba(200,230,240,0.55)'; c2 = 'rgba(120,180,200,0.55)'; stroke = 'rgba(40,70,100,0.9)'; }
    const g = ctx.createLinearGradient(-w/2, -h/2, w/2, h/2);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(ctx, -w/2, -h/2, w, h, material === 'glass' ? 2 : 4); ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke();
    if (material === 'wood') {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      const lines = Math.max(2, Math.round(w / 24));
      for (let i = 1; i < lines; i++) {
        ctx.beginPath();
        const xx = -w/2 + (w / lines) * i;
        ctx.moveTo(xx, -h/2 + 2); ctx.lineTo(xx, h/2 - 2); ctx.stroke();
      }
    } else if (material === 'stone') {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(-w/2 + 2, -h/2 + 2, w - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(-w/2 + 2, h/2 - 4, w - 4, 2);
    } else { // glass
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-w/2 + 3, -h/2 + 3, w - 6, 3);
    }
    drawCracks(ctx, w, h, hpFrac(e));
    ctx.restore();
  }

  function drawRockBody(body, type) {
    const def = ROCKS[type];
    const { x, y } = body.position; const a = body.angle;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const grad = ctx.createRadialGradient(-def.r * 0.3, -def.r * 0.3, def.r * 0.2, 0, 0, def.r);
    grad.addColorStop(0, def.color1); grad.addColorStop(1, def.color2);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, def.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    if (type === 'bomb') {
      // Фитиль с искрой
      ctx.strokeStyle = '#c77'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -def.r); ctx.quadraticCurveTo(12, -def.r - 14, 20, -def.r - 4); ctx.stroke();
      ctx.fillStyle = '#ffbe3c';
      ctx.beginPath(); ctx.arc(20 + Math.sin(performance.now()/80)*2, -def.r - 4, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff2b8';
      ctx.beginPath(); ctx.arc(20, -def.r - 4, 2, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // =====================================================================
  // 14. Рогатка + прицел
  // =====================================================================
  function drawSlingshot() {
    // Задняя стойка (z-back)
    ctx.save();
    ctx.lineCap = 'round';

    // Жгут сзади
    if (gameState.rockBody && !gameState.launched) {
      const pos = gameState.rockBody.position;
      ctx.strokeStyle = '#3a1b0a';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(SLING_X + 20, SLING_Y + 4);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    // Рогатка (Y-образная)
    ctx.fillStyle = '#5a3516';
    ctx.strokeStyle = '#2a1706';
    ctx.lineWidth = 2;
    // Основание
    ctx.beginPath();
    ctx.moveTo(SLING_X - 20, GROUND_Y);
    ctx.lineTo(SLING_X - 14, SLING_Y + 6);
    ctx.lineTo(SLING_X + 14, SLING_Y + 6);
    ctx.lineTo(SLING_X + 20, GROUND_Y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Левая ветка
    ctx.beginPath();
    ctx.moveTo(SLING_X - 14, SLING_Y + 6);
    ctx.quadraticCurveTo(SLING_X - 42, SLING_Y - 10, SLING_X - 24, SLING_Y - 6);
    ctx.lineTo(SLING_X - 8, SLING_Y + 10); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Правая ветка
    ctx.beginPath();
    ctx.moveTo(SLING_X + 14, SLING_Y + 6);
    ctx.quadraticCurveTo(SLING_X + 42, SLING_Y - 10, SLING_X + 24, SLING_Y - 6);
    ctx.lineTo(SLING_X + 8, SLING_Y + 10); ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Передний жгут
    if (gameState.rockBody && !gameState.launched) {
      const pos = gameState.rockBody.position;
      ctx.strokeStyle = '#5a2e12';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(SLING_X - 20, SLING_Y + 4);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    ctx.restore();

    // Прогноз траектории
    if (gameState.dragging && gameState.rockBody) {
      const pos = gameState.rockBody.position;
      const vx = (REST_X - pos.x) * LAUNCH_K;
      const vy = (REST_Y - pos.y) * LAUNCH_K;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      let px = pos.x, py = pos.y, pvx = vx, pvy = vy;
      const step = 0.06;
      const g = gameState.engine.world.gravity.y * gameState.engine.timing.timeScale * 60 * step;
      for (let i = 0; i < 22; i++) {
        px += pvx * step * 60;
        py += pvy * step * 60;
        pvy += g;
        if (py > GROUND_Y - 4 || px > VW + 100) break;
        const r = 5 - (i * 0.15);
        ctx.beginPath(); ctx.arc(px, py, Math.max(1.5, r), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // =====================================================================
  // 15. Отрисовка кадра
  // =====================================================================
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let viewScale = 1, viewOffX = 0, viewOffY = 0;

  function resizeCanvas() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);

    const sx = cw / VW, sy = ch / VH;
    viewScale = Math.min(sx, sy);
    viewOffX = (cw - VW * viewScale) / 2;
    viewOffY = (ch - VH * viewScale) / 2;
  }
  window.addEventListener('resize', resizeCanvas);

  function worldToScreen(x, y) {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + viewOffX + x * viewScale, y: rect.top + viewOffY + y * viewScale };
  }
  function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return { x: (sx - rect.left - viewOffX) / viewScale, y: (sy - rect.top - viewOffY) / viewScale };
  }

  function renderFrame() {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Масштаб к виртуальному миру + DPR
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(viewOffX, viewOffY);
    ctx.scale(viewScale, viewScale);
    // Тряска
    if (shakeAmp > 0.01) {
      ctx.translate((Math.random() - 0.5) * shakeAmp, (Math.random() - 0.5) * shakeAmp);
    }

    // Дальний фон — холмы-силуэт
    drawBackdrop();

    // Земля
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 60);
    g.addColorStop(0, '#8c5a28'); g.addColorStop(1, '#4f2f12');
    ctx.fillStyle = g;
    ctx.fillRect(-40, GROUND_Y, VW + 80, 100);
    // Трава
    ctx.fillStyle = '#4e7a1c';
    ctx.fillRect(-40, GROUND_Y - 6, VW + 80, 8);
    ctx.fillStyle = '#6ca227';
    for (let i = 0; i < VW; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, GROUND_Y - 6);
      ctx.lineTo(i + 6, GROUND_Y - 14);
      ctx.lineTo(i + 12, GROUND_Y - 6);
      ctx.closePath();
      ctx.fill();
    }

    // Рогатка (задние части)
    drawSlingshot();

    // Подвесные верёвки — рисуем до ценности, чтобы люстра «висела» на них
    ctx.save();
    ctx.strokeStyle = '#2b1b08';
    ctx.lineWidth = 3;
    for (const e of gameState.entities) {
      if (e.dead || !e.hangAnchor) continue;
      const anchor = e.hangAnchor;
      const cos = Math.cos(e.body.angle), sin = Math.sin(e.body.angle);
      const leftPt  = { x: e.body.position.x + cos * -18 - sin * -36, y: e.body.position.y + sin * -18 + cos * -36 };
      const rightPt = { x: e.body.position.x + cos *  18 - sin * -36, y: e.body.position.y + sin *  18 + cos * -36 };
      ctx.beginPath(); ctx.moveTo(anchor.x - 18, anchor.y); ctx.lineTo(leftPt.x, leftPt.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(anchor.x + 18, anchor.y); ctx.lineTo(rightPt.x, rightPt.y); ctx.stroke();
      // Крепление-болт на потолке
      ctx.fillStyle = '#666';
      ctx.fillRect(anchor.x - 24, anchor.y - 6, 48, 6);
    }
    ctx.restore();

    // Сущности
    for (const e of gameState.entities) {
      if (e.dead) continue;
      e.def.draw(e.body, e);
    }

    // Камень
    if (gameState.rockBody) drawRockBody(gameState.rockBody, gameState.rockType);

    // Частицы
    drawParticles();
  }

  function drawBackdrop() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    // Дальние облака
    for (let i = 0; i < 5; i++) {
      const cx = ((performance.now() / 60) + i * 420) % (VW + 400) - 200;
      ctx.beginPath();
      ctx.ellipse(cx, 170 + i * 12, 120, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Далёкие холмы
    ctx.fillStyle = 'rgba(90, 110, 80, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= VW; x += 60) {
      ctx.lineTo(x, GROUND_Y - 120 - Math.sin(x * 0.01) * 50);
    }
    ctx.lineTo(VW, GROUND_Y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(60, 90, 60, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= VW; x += 80) {
      ctx.lineTo(x, GROUND_Y - 60 - Math.cos(x * 0.006) * 30);
    }
    ctx.lineTo(VW, GROUND_Y); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of gameState.particles) {
      if (p.ring) {
        ctx.strokeStyle = `rgba(255, 200, 80, ${p.life / p.ttl * 0.8})`;
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      ctx.globalAlpha = (p.alpha != null ? p.alpha : 1) * (p.life / p.ttl);
      ctx.fillStyle = p.color;
      if (p.rot != null) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // =====================================================================
  // 16. Игровой цикл (RAF + фиксированный шаг физики)
  // =====================================================================
  const FIXED_STEP = 1000 / 60;
  function tick(now) {
    if (!gameState.lastTime) gameState.lastTime = now;
    const dtMs = Math.min(33, now - gameState.lastTime);
    gameState.lastTime = now;

    if (!gameState.paused) {
      // Matter рекомендует фиксированный шаг ≤ 16.667 мс — используем один
      Engine.update(gameState.engine, FIXED_STEP);
      updateParticles(dtMs / 1000);
      updateGameLogic(dtMs / 1000);
    }

    renderFrame();
    requestAnimationFrame(tick);
  }

  function updateGameLogic(dt) {
    if (!gameState.rockBody) return;
    if (gameState.launched) {
      const v = gameState.rockBody.velocity;
      const speed = Math.hypot(v.x, v.y);
      const b = gameState.rockBody;
      // Условие завершения броска: остановился или вылетел за пределы
      if (speed < 0.35) gameState.settleTimer += dt;
      else gameState.settleTimer = 0;

      const outOfBounds = b.position.x > VW + 200 || b.position.x < -200 || b.position.y > VH + 200;
      if (outOfBounds || gameState.settleTimer > 1.0) {
        Composite.remove(gameState.world, b);
        gameState.rockBody = null;
        onRockDone();
      }
    }
  }

  function onRockDone() {
    if (gameState.finished) return;
    // Дождаться, пока валяющиеся сущности тоже успокоятся — короткая пауза
    setTimeout(() => {
      if (gameState.finished) return;
      if (gameState.targetCount <= 0) return; // победа уже обработана
      const type = currentRockType();
      if (!type) {
        // Камни кончились
        completeLevel(false);
      } else {
        spawnRock();
      }
    }, 650);
  }

  // =====================================================================
  // 17. Ввод: указатель (мышь/тач) для рогатки
  // =====================================================================
  function pointerDown(ev) {
    if (!gameState.rockBody) return;
    const p = screenToWorld(ev.clientX, ev.clientY);
    const rb = gameState.rockBody;
    const dist = Math.hypot(p.x - rb.position.x, p.y - rb.position.y);
    if (!gameState.launched) {
      // Область чувствительности — вокруг камня и вся область натяжения
      const areaDist = Math.hypot(p.x - REST_X, p.y - REST_Y);
      if (dist < 120 || areaDist < 260) {
        gameState.dragging = true;
        gameState.dragPos = p;
        updateDragPosition(p.x, p.y);
        ev.preventDefault();
      }
    } else {
      // Камень в полёте — тап = активация способности
      if (dist < 120) { onRockTap(); ev.preventDefault(); }
    }
  }

  function updateDragPosition(x, y) {
    if (!gameState.rockBody) return;
    const dx = x - REST_X, dy = y - REST_Y;
    const d = Math.hypot(dx, dy);
    let targetX = x, targetY = y;
    if (d > DRAG_MAX) {
      targetX = REST_X + dx * (DRAG_MAX / d);
      targetY = REST_Y + dy * (DRAG_MAX / d);
    }
    // Не даём «стрелять» вперёд-вниз — камень не может уйти правее рогатки
    if (targetX > REST_X + 20) targetX = REST_X + 20;
    Body.setPosition(gameState.rockBody, { x: targetX, y: targetY });
    gameState.dragPos = { x: targetX, y: targetY };
  }

  function pointerMove(ev) {
    if (!gameState.dragging) return;
    ev.preventDefault();
    const p = screenToWorld(ev.clientX, ev.clientY);
    updateDragPosition(p.x, p.y);
  }

  function pointerUp(ev) {
    if (!gameState.dragging) return;
    ev.preventDefault();
    gameState.dragging = false;
    const p = gameState.dragPos || { x: REST_X, y: REST_Y };
    const pulled = Math.hypot(p.x - REST_X, p.y - REST_Y);
    if (pulled < 25) {
      Body.setPosition(gameState.rockBody, { x: REST_X, y: REST_Y });
      return;
    }
    launchRock(p.x, p.y);
  }

  // События движения и отпускания — на уровне окна, чтобы работать,
  // даже если курсор ушёл за пределы canvas во время натяжения.
  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);
  // Подстраховка на мышь (некоторые платформы не шлют pointer events)
  canvas.addEventListener('mousedown', pointerDown);
  window.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  // Тачи — предотвращаем прокрутку
  canvas.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  // =====================================================================
  // 18. UI: обновление HUD
  // =====================================================================
  function updateScoreUi() { ui.scoreValue.textContent = gameState.score.toLocaleString('ru-RU'); }
  function updateCoinsUi() { ui.coinsValue.textContent = save.coins.toLocaleString('ru-RU'); }
  function updateRocksUi() {
    const level = LEVELS[gameState.levelIndex];
    ui.rocksList.innerHTML = '';
    const total = level.rocks.length + gameState.bonusRocks;
    for (let i = 0; i < total; i++) {
      const type = i < level.rocks.length ? level.rocks[i] : 'stone';
      const chip = document.createElement('div');
      const cls = type === 'big' ? 'rock-chip big' : (type === 'bomb' ? 'rock-chip bomb' : 'rock-chip');
      chip.className = cls;
      if (i < gameState.currentRockIndex) chip.classList.add('used');
      else if (i === gameState.currentRockIndex) chip.classList.add('current');
      ui.rocksList.appendChild(chip);
    }
  }
  function setLevelHud(i) {
    const level = LEVELS[i];
    ui.levelNum.textContent = (i + 1);
    ui.levelName.textContent = level.name;
    ui.goal3.textContent = level.star3.toLocaleString('ru-RU');
  }

  function floaterAt(sx, sy, text, extra) {
    const el = document.createElement('div');
    el.className = 'floater' + (extra ? ' ' + extra : '');
    el.textContent = text;
    const rect = ui.floaters.getBoundingClientRect();
    el.style.left = (sx - rect.left) + 'px';
    el.style.top  = (sy - rect.top) + 'px';
    ui.floaters.appendChild(el);
    setTimeout(() => { el.remove(); }, 1200);
  }

  function toast(msg, ms = 1800) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(ui.toast._t);
    ui.toast._t = setTimeout(() => ui.toast.classList.remove('show'), ms);
  }

  // =====================================================================
  // 19. Управление уровнями (старт/перезапуск/победа/поражение)
  // =====================================================================
  function loadLevel(idx) {
    gameState.levelIndex = idx;
    gameState.currentRockIndex = 0;
    gameState.score = 0;
    gameState.finished = false;
    gameState.paused = false;
    gameState.bonusRocks = 0;

    clearWorld();
    if (!gameState.engine) createEngine();
    buildStatic();
    const level = LEVELS[idx];
    buildLevel(level);
    gameState.targetCount = gameState.entities.filter(e => e.kind === 'value').length;
    gameState.startedAt = performance.now();
    setLevelHud(idx);
    updateScoreUi();
    updateRocksUi();
    spawnRock();
    hide(ui.menuMain); hide(ui.menuLevels); hide(ui.menuPause); hide(ui.menuWin); hide(ui.menuLose);
    if (window.YSDK) YSDK.gameStart && YSDK.gameStart();
  }

  function completeLevel(success) {
    if (gameState.finished) return;
    gameState.finished = true;
    const level = LEVELS[gameState.levelIndex];

    if (success) {
      let stars = 1;
      if (gameState.score >= level.star2) stars = 2;
      if (gameState.score >= level.star3) stars = 3;
      const prev = save.best[gameState.levelIndex] || { stars: 0, score: 0 };
      if (stars > prev.stars || gameState.score > prev.score) {
        save.best[gameState.levelIndex] = { stars: Math.max(stars, prev.stars), score: Math.max(gameState.score, prev.score) };
      }
      const coinsEarned = Math.max(5, Math.floor(gameState.score / 50) + stars * 10);
      save.coins += coinsEarned;
      if (gameState.levelIndex + 1 < LEVELS.length) {
        save.unlocked = Math.max(save.unlocked, gameState.levelIndex + 2);
      }
      writeSave();
      updateCoinsUi();
      showWin(stars, coinsEarned);
      if (window.YSDK) YSDK.showFullscreen();
    } else {
      showLose();
      if (window.YSDK) YSDK.showFullscreen();
    }
    if (window.YSDK) YSDK.gameStop && YSDK.gameStop();
  }

  function showWin(stars, coins) {
    ui.winScore.textContent = gameState.score.toLocaleString('ru-RU');
    ui.winCoins.textContent = coins.toLocaleString('ru-RU');
    const spans = ui.winStars.querySelectorAll('span');
    spans.forEach((s, i) => s.classList.toggle('on', i < stars));
    show(ui.menuWin);
  }
  function showLose() {
    ui.loseScore.textContent = gameState.score.toLocaleString('ru-RU');
    show(ui.menuLose);
    // Кнопка награды — только если рекламный SDK активен
    ui.btnReward.disabled = !(window.YSDK);
  }

  function hide(el) { el.classList.remove('show'); }
  function show(el) { el.classList.add('show'); }

  // =====================================================================
  // 20. Меню уровней
  // =====================================================================
  function renderLevelsGrid() {
    ui.levelsGrid.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const best = save.best[i] || { stars: 0, score: 0 };
      const locked = (i + 1) > save.unlocked;
      const card = document.createElement('div');
      card.className = 'level-card' + (locked ? ' locked' : '');
      card.innerHTML = `
        <div class="lv-num">${i + 1}</div>
        <div class="lv-name">${lv.name}</div>
        <div class="lv-stars">${[0,1,2].map(n => n < best.stars ? '<b>★</b>' : '★').join('')}</div>
        <div class="lv-best">${best.score ? ('Лучшее: ' + best.score.toLocaleString('ru-RU')) : '—'}</div>
      `;
      card.addEventListener('click', () => { if (!locked) loadLevel(i); });
      ui.levelsGrid.appendChild(card);
    });
  }

  // =====================================================================
  // 21. Связка кнопок
  // =====================================================================
  function bindUi() {
    ui.btnPlay.addEventListener('click', () => loadLevel(Math.min(save.unlocked - 1, LEVELS.length - 1)));
    ui.btnLevels.addEventListener('click', () => { renderLevelsGrid(); hide(ui.menuMain); show(ui.menuLevels); });
    ui.btnLevelsBack.addEventListener('click', () => { hide(ui.menuLevels); show(ui.menuMain); });

    ui.btnPause.addEventListener('click', () => { gameState.paused = true; show(ui.menuPause); });
    ui.btnResume.addEventListener('click', () => { gameState.paused = false; hide(ui.menuPause); });
    ui.btnRestart.addEventListener('click', () => loadLevel(gameState.levelIndex));
    ui.btnToLevels.addEventListener('click', () => { renderLevelsGrid(); hide(ui.menuPause); show(ui.menuLevels); gameState.paused = false; clearWorld(); });
    ui.btnToMenu.addEventListener('click', () => { hide(ui.menuPause); show(ui.menuMain); gameState.paused = false; clearWorld(); });

    ui.btnNext.addEventListener('click', () => {
      hide(ui.menuWin);
      const next = gameState.levelIndex + 1;
      if (next < LEVELS.length) loadLevel(next);
      else { toast('Все уровни пройдены!'); renderLevelsGrid(); show(ui.menuLevels); }
    });
    ui.btnWinRetry.addEventListener('click', () => { hide(ui.menuWin); loadLevel(gameState.levelIndex); });
    ui.btnWinLevels.addEventListener('click', () => { hide(ui.menuWin); renderLevelsGrid(); show(ui.menuLevels); });

    ui.btnLoseRetry.addEventListener('click', () => { hide(ui.menuLose); loadLevel(gameState.levelIndex); });
    ui.btnLoseLevels.addEventListener('click', () => { hide(ui.menuLose); renderLevelsGrid(); show(ui.menuLevels); });
    ui.btnReward.addEventListener('click', async () => {
      ui.btnReward.disabled = true;
      const ok = await (window.YSDK ? YSDK.showRewardedVideo() : Promise.resolve(false));
      if (ok) {
        toast('Бонусный камень!');
        hide(ui.menuLose);
        gameState.finished = false;
        gameState.bonusRocks += 1;
        updateRocksUi();
        spawnRock();
      } else {
        toast('Реклама недоступна');
        ui.btnReward.disabled = false;
      }
    });

    ui.btnSound.addEventListener('click', () => {
      save.sound = !save.sound;
      ui.btnSound.classList.toggle('muted', !save.sound);
      writeSave();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') {
        if (ui.menuPause.classList.contains('show')) {
          gameState.paused = false; hide(ui.menuPause);
        } else if (!ui.menuMain.classList.contains('show') && !ui.menuWin.classList.contains('show') && !ui.menuLose.classList.contains('show') && !ui.menuLevels.classList.contains('show')) {
          gameState.paused = true; show(ui.menuPause);
        }
      }
      if (e.key === 'r') loadLevel(gameState.levelIndex);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !ui.menuMain.classList.contains('show')) {
        gameState.paused = true; show(ui.menuPause);
      }
    });
  }

  // =====================================================================
  // 22. Старт
  // =====================================================================
  // Отладочный доступ из консоли
  window.__gs = gameState;
  window.__VW = VW; window.__VH = VH; window.__REST = { x: REST_X, y: REST_Y };

  function boot() {
    loadSave();
    updateCoinsUi();
    ui.btnSound.classList.toggle('muted', !save.sound);
    bindUi();
    resizeCanvas();
    createEngine();
    buildStatic();
    // Отрисовать хоть что-то за меню
    renderLevelsGrid();
    requestAnimationFrame(tick);
    if (window.YSDK && YSDK.init) YSDK.init().then(() => YSDK.gameReady && YSDK.gameReady());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
