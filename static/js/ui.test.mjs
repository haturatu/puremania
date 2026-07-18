import assert from 'node:assert/strict';
import test from 'node:test';
import { VIRTUAL_RENDER_THRESHOLD, shouldUseVirtualRendering } from './ui.js';

test('renders a complete API directory page without virtualization', () => {
    assert.equal(shouldUseVirtualRendering(111), false);
    assert.equal(shouldUseVirtualRendering(200), false);
});

test('keeps virtualization for unusually large client-side result sets', () => {
    assert.equal(shouldUseVirtualRendering(VIRTUAL_RENDER_THRESHOLD + 1), true);
});
