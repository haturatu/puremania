import assert from 'node:assert/strict';
import test from 'node:test';
import { UploadChangeChannel } from './upload-change-channel.js';

class FakeBroadcastChannel {
    constructor(name) {
        this.name = name;
        this.messages = [];
        this.listeners = new Map();
        this.closed = false;
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage(message) { this.messages.push(message); }
    receive(message) { this.listeners.get('message')?.({ data: message }); }
    close() { this.closed = true; }
}

test('notifies the current document and broadcasts the upload id', () => {
    const changes = [];
    const notifier = new UploadChangeChannel(detail => changes.push(detail), FakeBroadcastChannel);

    notifier.notify('upload-1');

    assert.equal(notifier.channel.name, 'puremania');
    assert.deepEqual(changes, [{ uploadId: 'upload-1', remote: false }]);
    assert.deepEqual(notifier.channel.messages, [{ type: 'upload-changed', uploadId: 'upload-1' }]);
});

test('accepts only typed changes from another tab', () => {
    const changes = [];
    const notifier = new UploadChangeChannel(detail => changes.push(detail), FakeBroadcastChannel);

    notifier.channel.receive({ type: 'unrelated', uploadId: 'ignored' });
    notifier.channel.receive({ type: 'upload-changed', uploadId: 'upload-2' });

    assert.deepEqual(changes, [{ uploadId: 'upload-2', remote: true }]);
});

test('keeps same-document notifications when BroadcastChannel is unavailable', () => {
    const changes = [];
    const notifier = new UploadChangeChannel(detail => changes.push(detail), null);
    notifier.notify('upload-3');

    assert.deepEqual(changes, [{ uploadId: 'upload-3', remote: false }]);
});
