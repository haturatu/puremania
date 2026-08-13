import assert from 'node:assert/strict';
import test from 'node:test';
import { OriginUploadLock } from './upload-lock.js';

test('holds an exclusive origin lock for the complete upload task', async () => {
    const calls = [];
    const lockManager = {
        request: async (name, options, callback) => {
            calls.push({ name, options });
            return callback({ name });
        }
    };
    const uploadLock = new OriginUploadLock(lockManager);

    const outcome = await uploadLock.run(async () => 'uploaded');

    assert.deepEqual(calls, [{
        name: 'puremania-upload',
        options: { mode: 'exclusive', ifAvailable: true }
    }]);
    assert.deepEqual(outcome, { acquired: true, result: 'uploaded' });
});

test('does not start another upload when a sibling tab owns the lock', async () => {
    let taskStarted = false;
    const uploadLock = new OriginUploadLock({
        request: async (_name, _options, callback) => callback(null)
    });

    const outcome = await uploadLock.run(async () => { taskStarted = true; });

    assert.equal(taskStarted, false);
    assert.deepEqual(outcome, { acquired: false, result: undefined });
});

test('falls back to the existing uploader when Web Locks is unavailable', async () => {
    const uploadLock = new OriginUploadLock(null);
    const outcome = await uploadLock.run(async () => 42);

    assert.deepEqual(outcome, { acquired: true, result: 42 });
});
