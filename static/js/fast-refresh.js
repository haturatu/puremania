(() => {
  const script = document.currentScript;
  if (!script || script.dataset.enabled !== 'true') return;

  const buildID = script.dataset.buildId;
  const stateKey = 'puremania:fast-refresh-state';
  let refreshPending = false;

  const saveViewState = () => {
    const main = document.querySelector('.main-content');
    sessionStorage.setItem(stateKey, JSON.stringify({
      path: location.pathname,
      windowX: window.scrollX,
      windowY: window.scrollY,
      mainX: main?.scrollLeft ?? 0,
      mainY: main?.scrollTop ?? 0,
    }));
  };

  const restoreViewState = () => {
    let state;
    try { state = JSON.parse(sessionStorage.getItem(stateKey) || 'null'); } catch (_) { return; }
    if (!state || state.path !== location.pathname) return;
    sessionStorage.removeItem(stateKey);
    const restore = () => {
      const main = document.querySelector('.main-content');
      window.scrollTo(state.windowX, state.windowY);
      if (main) main.scrollTo(state.mainX, state.mainY);
    };
    requestAnimationFrame(() => { restore(); setTimeout(restore, 250); });
  };

  const uploadIsActive = () => Boolean(window.__puremaniaApp?.uploader?.activeUploadSession);
  const refresh = () => {
    if (!refreshPending || document.visibilityState !== 'visible') return;
    if (uploadIsActive()) return;
    saveViewState();
    location.reload();
  };

  const check = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const response = await fetch('/static/build-info.json', { cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json();
      if (next.version && next.version !== buildID) {
        refreshPending = true;
        refresh();
      }
    } catch (_) {
      // A rebuild may briefly replace the manifest; the next interval retries.
    }
  };

  restoreViewState();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void check(); refresh(); } });
  window.addEventListener('puremania:upload-jobs-changed', refresh);
  window.setInterval(() => void check(), 2000);
})();
