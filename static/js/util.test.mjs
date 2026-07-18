import assert from 'node:assert/strict';
import test from 'node:test';
import { createUniqueId } from './util.js';

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
