import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readStatic = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('directory completions use a popover with a fallback path', async () => {
    const searchSource = await readStatic('js/search.js');
    assert.match(searchSource, /setAttribute\('popover', 'auto'\)/);
    assert.match(searchSource, /showPopover\(\)/);
    assert.match(searchSource, /hidePopover\(\)/);
});

test('completion styling declares an anchor-positioning enhancement', async () => {
    const searchStyles = await readStatic('css/components/search.css');
    assert.match(searchStyles, /anchor-name: --search-input/);
    assert.match(searchStyles, /position-anchor: --search-input/);
    assert.match(searchStyles, /position-area: block-end span-inline-end/);
});

test('context menu styles do not hide popover content with legacy display rules', async () => {
    const contextMenuStyles = await readStatic('css/components/context-menu.css');
    assert.doesNotMatch(contextMenuStyles, /display:\s*none/);
    assert.match(contextMenuStyles, /popover-ready context menu/i);
});
