function bindRoutes(app) {
    app.router.onChange(async (path, { navigationType = 'initial' } = {}) => {
        if (path === '/system/uploads') {
            app.aria2cPageHandler.exitAria2cMode(false);
            app.uploadPageHandler.enter();
            return;
        }

        if (path === '/system/aria2c') {
            app.uploadPageHandler.exit();
            if (!app.config.Aria2cEnabled) {
                app.ui.showToast('Info', 'Aria2c feature is not enabled.', 'info');
                app.router.navigate('/');
                return;
            }
            if (app.searchHandler.isInSearchMode) app.searchHandler.exitSearchMode(true);
            app.aria2cPageHandler.enterAria2cMode();
            return;
        }

        app.uploadPageHandler.exit();
        app.aria2cPageHandler.exitAria2cMode(false);
        await app.navigateToPath(path, { restoreScroll: navigationType === 'pop' });
    });
}

export async function initializeApp(app) {
    app.ui.bindStore();
    app.progressManager.init();
    app.imageViewer.init();
    app.searchHandler.init();
    app.editor.init?.();
    app.mediaPlayer.init?.();

    app.config = await app.api.getConfig();
    if (!app.config) throw new Error('Failed to load the application configuration.');

    app.realtimeEvents.start();

    app.ui.updateAria2cVisibility(app.config.Aria2cEnabled);
    app.events.bindEvents();
    app.aria2cPageHandler.init();

    const [specificDirs, storageResult] = await Promise.all([
        app.api.getSpecificDirs(),
        app.api.getStorageInfo()
    ]);
    app.ui.updateSpecificDirs(specificDirs);
    app.updateStorageInfo(storageResult);
    bindRoutes(app);
}
