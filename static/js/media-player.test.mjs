import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaPlayer } from './media-player.js';

test('remember 480p video quality across player instances', t => {
    const saved = new Map();
    const original = globalThis.localStorage;
    globalThis.localStorage = {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value)
    };
    t.after(() => {
        if (original === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = original;
    });
    const first = new MediaPlayer({});
    assert.equal(first.savedVideoQuality, 'original');
    first.saveVideoQuality('480');
    assert.equal(saved.get('puremania.video.quality'), '480');
    assert.equal(new MediaPlayer({}).savedVideoQuality, '480');
    first.saveVideoQuality('720');
    assert.equal(new MediaPlayer({}).savedVideoQuality, '720');
    first.saveVideoQuality('invalid');
    assert.equal(saved.get('puremania.video.quality'), '720');
});

test('storage denial does not block video playback configuration', t => {
    const old = globalThis.localStorage;
    globalThis.localStorage = {
        getItem: () => { throw new Error('disabled'); },
        setItem: () => { throw new Error('disabled'); }
    };
    t.after(() => {
        if (old === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = old;
    });
    const player = new MediaPlayer({});
    assert.equal(player.savedVideoQuality, 'original');
    player.saveVideoQuality('480');
    assert.equal(player.savedVideoQuality, '480');
});
