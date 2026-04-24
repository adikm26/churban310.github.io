// Обёртка над Yandex Games SDK. Работает и вне платформы — при отсутствии
// YaGames все вызовы молча игнорируются, игра функционирует локально.
(function () {
  const state = {
    ysdk: null,
    player: null,
    ready: false,
    adsLastShown: 0,
  };

  async function init() {
    if (typeof YaGames === 'undefined') {
      console.info('[YSDK] YaGames недоступен, работаем в локальном режиме.');
      return;
    }
    try {
      state.ysdk = await YaGames.init();
      state.ready = true;
      console.info('[YSDK] SDK инициализирован.');
      try {
        await state.ysdk.features.LoadingAPI?.ready();
      } catch (_) {}
      try {
        state.player = await state.ysdk.getPlayer({ scopes: false });
      } catch (_) {}
    } catch (e) {
      console.warn('[YSDK] init error:', e);
    }
  }

  // Полноэкранная реклама между уровнями. По правилам Яндекс.Игр — не чаще
  // одного раза в 60–180 секунд. По умолчанию — раз в 180 секунд.
  async function showFullscreen(minIntervalMs = 180000) {
    if (!state.ready) return false;
    const now = Date.now();
    if (now - state.adsLastShown < minIntervalMs) return false;
    try {
      await state.ysdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => { try { state.ysdk.features.GameplayAPI?.stop(); } catch (_) {} },
          onClose: (wasShown) => {
            if (wasShown) state.adsLastShown = Date.now();
            try { state.ysdk.features.GameplayAPI?.start(); } catch (_) {}
          },
          onError: () => {},
        },
      });
      return true;
    } catch (e) {
      console.warn('[YSDK] showFullscreenAdv error:', e);
      return false;
    }
  }

  // Rewarded video — показывает игроку ролик и возвращает награду.
  // Возвращает промис, который резолвится в true, если награда была выдана.
  function showRewardedVideo() {
    return new Promise((resolve) => {
      if (!state.ready) { resolve(false); return; }
      let rewarded = false;
      try {
        state.ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => { try { state.ysdk.features.GameplayAPI?.stop(); } catch (_) {} },
            onRewarded: () => { rewarded = true; },
            onClose: () => {
              try { state.ysdk.features.GameplayAPI?.start(); } catch (_) {}
              resolve(rewarded);
            },
            onError: (err) => { console.warn('[YSDK] rewarded error:', err); resolve(false); },
          },
        });
      } catch (e) {
        console.warn('[YSDK] showRewardedVideo error:', e);
        resolve(false);
      }
    });
  }

  // Оповещения платформы о жизненном цикле геймплея.
  async function gameReady() {
    if (!state.ready) return;
    try {
      state.ysdk.features.LoadingAPI?.ready();
      state.ysdk.features.GameplayAPI?.start();
    } catch (_) {}
  }
  function gameStop() {
    if (!state.ready) return;
    try { state.ysdk.features.GameplayAPI?.stop(); } catch (_) {}
  }
  function gameStart() {
    if (!state.ready) return;
    try { state.ysdk.features.GameplayAPI?.start(); } catch (_) {}
  }

  window.YSDK = { init, showFullscreen, showRewardedVideo, gameReady, gameStop, gameStart };
})();
