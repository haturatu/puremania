import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createRequestSignal,
    isManualRequestAbort,
    isRequestTimeout,
    requestErrorMessage
} from './request-signal.js';

test('combines manual cancellation and a native timeout with AbortSignal.any', () => {
    const manual = new AbortController().signal;
    const timeout = { kind: 'timeout' };
    const combined = { kind: 'combined' };
    const calls = [];
    const AbortSignalClass = {
        timeout: milliseconds => { calls.push(['timeout', milliseconds]); return timeout; },
        any: signals => { calls.push(['any', signals]); return combined; }
    };

    const request = createRequestSignal(manual, { timeoutMs: 10_000, AbortSignalClass });

    assert.equal(request.signal, combined);
    assert.deepEqual(calls, [['timeout', 10_000], ['any', [manual, timeout]]]);
});

test('fallback composition propagates manual cancellation', () => {
    const manual = new AbortController();
    const request = createRequestSignal(manual.signal, {
        timeoutMs: 60_000,
        AbortSignalClass: {},
        AbortControllerClass: AbortController
    });

    manual.abort(new DOMException('Stopped', 'AbortError'));

    assert.equal(request.signal.aborted, true);
    assert.equal(request.signal.reason.name, 'AbortError');
    request.cleanup();
});

test('cleanup cancels a fallback timeout after a completed request', async () => {
    const request = createRequestSignal(null, {
        timeoutMs: 1,
        AbortSignalClass: {},
        AbortControllerClass: AbortController
    });
    request.cleanup();
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(request.signal.aborted, false);
});

test('keeps manual abort and timeout semantics distinct', () => {
    const manual = new DOMException('Stopped', 'AbortError');
    const timeout = new DOMException('Expired', 'TimeoutError');

    assert.equal(isManualRequestAbort(manual), true);
    assert.equal(isRequestTimeout(manual), false);
    assert.equal(isManualRequestAbort(timeout), false);
    assert.equal(isRequestTimeout(timeout), true);
    assert.equal(requestErrorMessage(timeout, 'Directory request'), 'Directory request timed out. Try again.');
});
