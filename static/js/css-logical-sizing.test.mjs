import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readStyle = relativePath => readFile(new URL(`../css/${relativePath}`, import.meta.url), 'utf8');

test('frequently mirrored UI edges use logical properties', async () => {
    const styles = await Promise.all([
        readStyle('layout/sidebar.css'),
        readStyle('components/file-browser.css'),
        readStyle('components/image-viewer.css'),
        readStyle('components/media-player.css'),
        readStyle('masonry.css')
    ]);
    const combined = styles.join('\n');
    assert.match(combined, /border-inline-end/);
    assert.match(combined, /inset-inline-end/);
    assert.match(combined, /inset-inline-start/);
    assert.match(combined, /margin-inline-end/);
});

test('responsive control sizes use clamp instead of fixed mobile jumps', async () => {
    const styles = await Promise.all([
        readStyle('components/search.css'),
        readStyle('responsive.css')
    ]);
    const combined = styles.join('\n');
    assert.match(combined, /width:\s*clamp\(/);
    assert.match(combined, /font-size:\s*clamp\(/);
    assert.match(combined, /min-height:\s*clamp\(/);
});
