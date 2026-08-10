import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const template = relativePath => readFile(new URL(`../templates/${relativePath}`, import.meta.url), 'utf8');

test('the shell exposes semantic navigation, search, and storage progress controls', async () => {
    const appShell = await template('app_shell.html');
    assert.match(appShell, /<nav class="file-navigation"/);
    assert.match(appShell, /<a href="\/" class="nav-item active"/);
    assert.match(appShell, /type="search"/);
    assert.match(appShell, /role="combobox"/);
    assert.match(appShell, /<progress class="storage-progress"/);
    assert.doesNotMatch(appShell, /storage-progress-inner/);
});

test('view selection is represented as a native radio group', async () => {
    const viewToggle = await template('components/view_toggle.html');
    assert.match(viewToggle, /type="radio"/);
    assert.match(viewToggle, /name="view-mode"/);
    assert.doesNotMatch(viewToggle, /class="view-toggle-btn"/);
});

test('list timestamps use the time element', async () => {
    const listItem = await template('components/list_view_item.html');
    assert.match(listItem, /<time class="file-mod-time"><\/time>/);
});
