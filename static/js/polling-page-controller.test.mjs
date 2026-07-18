import assert from 'node:assert/strict';
import test from 'node:test';
import { PollingPageController } from './polling-page-controller.js';

test('prevents overlapping polls and renders current page data', async () => {
    let resolveFetch;
    let calls = 0;
    const rendered = [];
    const polling = new PollingPageController({
        interval: 60000,
        isCurrentPage: () => true,
        fetchData: () => {
            calls += 1;
            return new Promise(resolve => { resolveFetch = resolve; });
        },
        render: data => rendered.push(data)
    });

    polling.start();
    await polling.refresh();
    assert.equal(calls, 1);
    resolveFetch(['job']);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rendered, [['job']]);
    polling.stop();
});

test('aborts an in-flight request when stopped', async () => {
    let signal;
    const polling = new PollingPageController({
        interval: 60000,
        isCurrentPage: () => true,
        fetchData: requestSignal => {
            signal = requestSignal;
            return new Promise(() => {});
        },
        render: () => {}
    });

    polling.start();
    polling.stop();
    assert.equal(signal.aborted, true);
});
