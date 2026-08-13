import assert from 'node:assert/strict';
import test from 'node:test';
import { UploadMetadataStorage } from './upload-storage.js';

test('requests persistence and records the browser storage estimate once', async () => {
    const calls = [];
    const policy = new UploadMetadataStorage({
        persisted: async () => { calls.push('persisted'); return false; },
        persist: async () => { calls.push('persist'); return true; },
        estimate: async () => { calls.push('estimate'); return { usage: 1024, quota: 4096 }; }
    });

    const [first, second] = await Promise.all([policy.prepare(), policy.prepare()]);

    assert.deepEqual(calls, ['persisted', 'persist', 'estimate']);
    assert.equal(first, second);
    assert.deepEqual(first, { supported: true, persisted: true, usage: 1024, quota: 4096 });
});

test('does not request persistence again when storage is already durable', async () => {
    let persistCalls = 0;
    const policy = new UploadMetadataStorage({
        persisted: async () => true,
        persist: async () => { persistCalls += 1; return true; },
        estimate: async () => ({})
    });

    const result = await policy.prepare();

    assert.equal(result.persisted, true);
    assert.equal(persistCalls, 0);
});

test('keeps uploads available without the Storage API', async () => {
    const policy = new UploadMetadataStorage(null);

    assert.deepEqual(await policy.prepare(), {
        supported: false,
        persisted: false,
        usage: null,
        quota: null
    });
});

test('treats persistence failures as optional', async t => {
    t.mock.method(console, 'warn', () => {});
    const policy = new UploadMetadataStorage({
        persisted: async () => { throw new Error('blocked'); },
        estimate: async () => { throw new Error('blocked'); }
    });

    const result = await policy.prepare();

    assert.deepEqual(result, { supported: true, persisted: false, usage: null, quota: null });
});
