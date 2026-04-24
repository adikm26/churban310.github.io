// Yandex Games SDK wrapper. Works offline — all calls silently ignored.
(function () {
  const state = {
    ysdk: null,
    player: null,
    ready: false,
    adsLastShown: 0,
  };

  async function init() {
    if (typeof YaGames === 'undefined') {
      console.info('[YSDK] YaGames unavailable, running locally.');
      return;
    }
    try {
      state.ysdk = await YaGames.init();
      state.ready = true;
      console.info('[YSDK] SDK initialized.');
      try { await state.ysdk.features.LoadingAPI?.ready(); } catch (_) {}
      try { state.player = await state.ysdk.getPlayer({ scopes: false }); } catch (_) {}
    } catch (e) {
      console.warn('[YSDK] init error:', e);
    }
  }

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
