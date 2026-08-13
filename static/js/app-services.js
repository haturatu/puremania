import { ApiClient } from './api.js';
import { Aria2cPageHandler } from './aria2c-page.js';
import { EventHandler } from './events.js';
import { FileEditor } from './file-editor.js';
import { ImageViewer } from './gallery.js';
import { MediaPlayer } from './media-player.js';
import { ProgressManager } from './progress.js';
import { RealtimeEvents } from './realtime-events.js';
import { Router } from './router.js';
import { SearchHandler } from './search.js';
import { UIManager } from './ui.js';
import { UploadPageHandler } from './upload-page.js';
import { Uploader } from './uploader.js';

export function createAppServices(app) {
    const attach = (name, service) => {
        app[name] = service;
        return service;
    };

    attach('router', new Router(app.store));
    attach('api', new ApiClient(app));
    attach('uploader', new Uploader(app));
    attach('events', new EventHandler(app));
    attach('ui', new UIManager(app));
    attach('progressManager', new ProgressManager());
    attach('realtimeEvents', new RealtimeEvents(app));
    attach('editor', new FileEditor(app));
    attach('mediaPlayer', new MediaPlayer(app));
    attach('imageViewer', new ImageViewer(app));
    attach('searchHandler', new SearchHandler(app));
    attach('aria2cPageHandler', new Aria2cPageHandler(app));
    attach('uploadPageHandler', new UploadPageHandler(app));
}
