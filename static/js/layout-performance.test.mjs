import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readStyle = relativePath => readFile(new URL(`../css/${relativePath}`, import.meta.url), 'utf8');

test('file browser styles declare a named inline-size container', async () => {
    const styles = await readStyle('components/file-browser.css');
    assert.match(styles, /container:\s*file-browser\s*\/\s*inline-size/);
    assert.match(styles, /@container file-browser \(width < 700px\)/);
});

test('large file collections opt into deferred rendering', async () => {
    const [browserStyles, masonryStyles, videoStyles] = await Promise.all([
        readStyle('components/file-browser.css'),
        readStyle('masonry.css'),
        readStyle('components/video-view.css')
    ]);
    for (const styles of [browserStyles, masonryStyles, videoStyles]) {
        assert.match(styles, /content-visibility:\s*auto/);
        assert.match(styles, /contain-intrinsic-size/);
    }
});

test('selection styling supports checkbox-driven state with :has', async () => {
    const [browserStyles, masonryStyles] = await Promise.all([
        readStyle('components/file-browser.css'),
        readStyle('masonry.css')
    ]);
    assert.match(browserStyles, /\.file-item:has\(/);
    assert.match(masonryStyles, /\.masonry-item:has\(/);
});
