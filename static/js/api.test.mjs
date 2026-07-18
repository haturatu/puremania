import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from './api.js';

const client = () => new ApiClient({ ui: { showToast() {} } });

test('request serializes JSON payloads and validates success envelopes', async t => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, '/endpoint');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(options.body, JSON.stringify({ value: 1 }));
        return new Response(JSON.stringify({ success: true, data: { id: 2 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    });

    const result = await client().postJson('/endpoint', { value: 1 }, { validateSuccess: true });
    assert.equal(result.data.id, 2);
});

test('request exposes API errors with the server message', async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify({ message: 'invalid input' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
    ));

    await assert.rejects(client().request('/endpoint'), /invalid input/);
});
