import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeEvents } from './realtime-events.js';

class FakeEventSource {
    constructor(url) {
        this.url = url;
        this.listeners = new Map();
        this.closed = false;
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    dispatch(type, data) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
}

test('opens one event stream and publishes typed server events', () => {
    const emitted = [];
    const realtime = new RealtimeEvents({ emit: (type, detail) => emitted.push({ type, detail }) }, FakeEventSource);

    assert.equal(realtime.start(), true);
    assert.equal(realtime.start(), false);
    assert.equal(realtime.source.url, '/api/events');
    realtime.source.dispatch('sync', {});
    realtime.source.dispatch('aria2', { active: [] });

    assert.deepEqual(realtime.latest('aria2'), { active: [] });
    assert.deepEqual(emitted, [
        { type: 'server:sync', detail: {} },
        { type: 'server:aria2', detail: { active: [] } }
    ]);
});

test('closes the active stream', () => {
    const realtime = new RealtimeEvents({ emit: () => {} }, FakeEventSource);
    realtime.start();
    const source = realtime.source;
    realtime.close();

    assert.equal(source.closed, true);
    assert.equal(realtime.source, null);
});

test('reconnects with aria2 updates only while requested', () => {
    const realtime = new RealtimeEvents({ emit: () => {} }, FakeEventSource);
    realtime.start();
    const uploadOnlySource = realtime.source;
    realtime.setAria2Enabled(true);

    assert.equal(uploadOnlySource.closed, true);
    assert.equal(realtime.source.url, '/api/events?aria2=1');

    const aria2Source = realtime.source;
    realtime.setAria2Enabled(false);
    assert.equal(aria2Source.closed, true);
    assert.equal(realtime.source.url, '/api/events');
});
