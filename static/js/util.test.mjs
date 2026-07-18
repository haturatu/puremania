import assert from 'node:assert/strict';
import test from 'node:test';
import { createUniqueId, getBaseName, getParentPath, isEditableFile, isValidPath, normalizePath } from './util.js';

test('uses randomUUID when it is available', () => {
    assert.equal(createUniqueId({ randomUUID: () => 'native-id' }), 'native-id');
});

test('creates an RFC 4122 shaped id from getRandomValues', () => {
    const id = createUniqueId({ getRandomValues: bytes => bytes.fill(0) });
    assert.match(id, /^00000000-0000-4000-8000-000000000000$/);
});

test('creates distinct ids without Web Crypto', () => {
    assert.notEqual(createUniqueId(null), createUniqueId(null));
});

test('normalizes and splits virtual paths', () => {
    assert.equal(normalizePath('/music/./album/../tracks'), '/music/tracks');
    assert.equal(getParentPath('/music/tracks/song.mp3'), '/music/tracks');
    assert.equal(getBaseName('/music/tracks/song.mp3'), 'song.mp3');
});

test('validates paths and editable extensions', () => {
    assert.equal(isValidPath('/notes/today.md'), true);
    assert.equal(isValidPath('../outside'), false);
    assert.equal(isEditableFile('/notes/today.MD'), true);
    assert.equal(isEditableFile('/video/movie.mp4'), false);
});
