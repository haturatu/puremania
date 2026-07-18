import assert from 'node:assert/strict';
import test from 'node:test';
import { VIRTUAL_RENDER_THRESHOLD, shouldUseVirtualRendering } from './ui.js';
import { UIManager } from './ui.js';
import { AppStateStore } from './state.js';

test('renders a complete API directory page without virtualization', () => {
    assert.equal(shouldUseVirtualRendering(111), false);
    assert.equal(shouldUseVirtualRendering(200), false);
});

test('keeps virtualization for unusually large client-side result sets', () => {
    assert.equal(shouldUseVirtualRendering(VIRTUAL_RENDER_THRESHOLD + 1), true);
});

test('derives loading overlay visibility from store updates', t => {
    const overlay = {
        style: {},
        attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); }
    };
    globalThis.document = { getElementById: id => id === 'loading-overlay' ? overlay : null };
    globalThis.matchMedia = () => ({ matches: false });
    t.after(() => {
        delete globalThis.document;
        delete globalThis.matchMedia;
    });
    const app = { store: new AppStateStore() };
    const ui = new UIManager(app);
    ui.bindStore();

    ui.showLoading();
    assert.equal(overlay.style.display, 'flex');
    assert.equal(overlay.attributes.get('aria-hidden'), 'false');
    ui.hideLoading();
    assert.equal(overlay.style.display, 'none');
    assert.equal(overlay.attributes.get('aria-hidden'), 'true');
});
