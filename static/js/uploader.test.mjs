import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AdaptiveUploadController, Uploader } from './uploader.js';

function mockFile(contents) {
    const bytes = new TextEncoder().encode(contents);
    return {
        size: bytes.length,
        slice(start, end) { return new Blob([bytes.slice(start, end)]); }
    };
}

test('file fingerprints work without Web Crypto', async () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const file = mockFile('vimusic archive contents');
    const fingerprintInput = new Uint8Array(file.size * 2 + 8);
    const contents = new TextEncoder().encode('vimusic archive contents');
    fingerprintInput.set(contents);
    fingerprintInput.set(contents, contents.length);
    new DataView(fingerprintInput.buffer).setFloat64(fingerprintInput.length - 8, file.size);
    const expected = createHash('sha256').update(fingerprintInput).digest('hex');
    try {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
        const uploader = Object.create(Uploader.prototype);
        assert.equal(await uploader.fileFingerprint(file), expected);
        assert.equal(await uploader.fileRangeFingerprint(file, 0, file.size), createHash('sha256').update(contents).digest('hex'));
    } finally {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    }
});

test('server concurrency capacity of one is not raised to the client minimum', () => {
    const controller = new AdaptiveUploadController();
    controller.target = 2;
    controller.record({ bytes: 1, elapsed: 1, capacity: 1, active: 1 });
    controller.lastDecisionAt = performance.now() - 2000;

    assert.equal(controller.adjust(), 1);
    assert.equal(controller.serverCap, 1);
    assert.equal(controller.serverActive, 1);
});

test('AIMD increases through marginal throughput gains', () => {
    const controller = new AdaptiveUploadController();
    controller.record({ bytes: 100, elapsed: 1000 });
    controller.lastDecisionAt = performance.now() - 2000;
    assert.equal(controller.adjust(), 3);

    controller.record({ bytes: 104, elapsed: 1000 });
    controller.lastDecisionAt = performance.now() - 2000;
    assert.equal(controller.adjust(), 4);
});

test('AIMD applies multiplicative decrease on congestion', () => {
    const controller = new AdaptiveUploadController();
    controller.target = 10;
    controller.congested = true;
    controller.lastDecisionAt = performance.now() - 2000;

    assert.equal(controller.adjust(), 7);
});

test('native resume picker cancellation clears the pending request', async () => {
    const uploader = Object.create(Uploader.prototype);
    uploader.store = { get: async key => ({ key, destination: '/', relativePath: 'file.txt' }) };
    uploader.showUploadDialog = async selector => {
        assert.equal(selector, '.resume-upload-input-files');
        return 'cancelled';
    };

    await uploader.requestResumeMany(['resume-key']);

    assert.equal(uploader.resumeRequest, null);
});

test('input fallback retains the pending resume request until change or cancel', async () => {
    const uploader = Object.create(Uploader.prototype);
    uploader.store = { get: async key => ({ key, destination: '/', relativePath: 'folder/file.txt' }) };
    uploader.showDirectoryDialog = async selector => {
        assert.equal(selector, '.resume-upload-input-folders');
        return 'fallback';
    };

    await uploader.requestResumeMany(['resume-key']);

    assert.deepEqual([...uploader.resumeRequest.keys], ['resume-key']);
});
