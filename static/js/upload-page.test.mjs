import assert from 'node:assert/strict';
import test from 'node:test';
import { UploadPageHandler } from './upload-page.js';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('reloads authoritative upload state when an SSE connection syncs', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.window = new EventTarget();
    globalThis.document = { querySelector: () => null };
    let reloads = 0;
    const app = {
        eventBus: new EventTarget(),
        store: { getState: () => ({ route: { page: 'uploads' } }) },
        uploader: { listJobs: async () => { reloads += 1; return []; } }
    };
    const page = new UploadPageHandler(app);

    try {
        page.enter();
        await nextTurn();
        assert.equal(reloads, 1);

        app.eventBus.dispatchEvent(new Event('server:sync'));
        await nextTurn();
        assert.equal(reloads, 2);

        page.exit();
        app.eventBus.dispatchEvent(new Event('server:sync'));
        await nextTurn();
        assert.equal(reloads, 2);
    } finally {
        page.exit();
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});
