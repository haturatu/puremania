import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Uploader } from './uploader.js';

function mockFile(contents) {
    const bytes = new TextEncoder().encode(contents);
    return {
        size: bytes.length,
        slice(start, end) { return new Blob([bytes.slice(start, end)]); }
    };
}

test('file fingerprints work without Web Crypto', async () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const file = mockFile('vimusic archive contents');
    const fingerprintInput = new Uint8Array(file.size * 2 + 8);
    const contents = new TextEncoder().encode('vimusic archive contents');
    fingerprintInput.set(contents);
    fingerprintInput.set(contents, contents.length);
    new DataView(fingerprintInput.buffer).setFloat64(fingerprintInput.length - 8, file.size);
    const expected = createHash('sha256').update(fingerprintInput).digest('hex');
    try {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
        const uploader = Object.create(Uploader.prototype);
        assert.equal(await uploader.fileFingerprint(file), expected);
        assert.equal(await uploader.fileRangeFingerprint(file, 0, file.size), createHash('sha256').update(contents).digest('hex'));
    } finally {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    }
});
