import assert from 'node:assert/strict';
import test from 'node:test';

import { AppStateStore } from './state.js';

test('updates one state slice without replacing the others', () => {
    const store = new AppStateStore();
    const selection = store.getState().selection;
    store.update('route', { page: 'uploads', path: '/system/uploads' }, 'NAVIGATE');
    assert.deepEqual(store.getState().route, { page: 'uploads', path: '/system/uploads' });
    assert.equal(store.getState().selection, selection);
});

test('notifies subscribers with action and previous state', () => {
    const store = new AppStateStore();
    let notification;
    const unsubscribe = store.subscribe((state, previous, action) => { notification = { state, previous, action }; });
    store.update('editor', { status: 'editing', path: '/notes.txt' }, 'EDITOR_OPENED');
    assert.equal(notification.action, 'EDITOR_OPENED');
    assert.equal(notification.previous.editor.status, 'closed');
    assert.equal(notification.state.editor.path, '/notes.txt');
    unsubscribe();
});
