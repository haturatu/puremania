import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readStyle = relativePath => readFile(new URL(`../css/${relativePath}`, import.meta.url), 'utf8');

test('context menu styles use native CSS nesting for actions and hover state', async () => {
    const styles = await readStyle('components/context-menu.css');
    assert.match(styles, /&\s+\.context-menu-item\s*\{/);
    assert.match(styles, /&\s*:hover\s*\{/);
});

test('download item styles keep related child rules inside their component', async () => {
    const styles = await readStyle('components/modal.css');
    const downloadItem = styles.match(/\.download-item\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(downloadItem, /\.download-name/);
    assert.match(downloadItem, /\.download-controls/);
    assert.match(downloadItem, /\.ui-progress__fill/);
});
