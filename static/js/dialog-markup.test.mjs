import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const template = relativePath => readFile(new URL(`../templates/${relativePath}`, import.meta.url), 'utf8');

test('the static Aria2c dialog uses the native dialog element', async () => {
    const appShell = await template('app_shell.html');
    assert.match(appShell, /<dialog id="aria2cStatusDialog"/);
    assert.doesNotMatch(appShell, /id="aria2c-status-modal"/);
});

test('dynamic dialog templates do not reintroduce legacy modal panels', async () => {
    const [searchModal, imageViewer] = await Promise.all([
        template('components/search_modal.html'),
        template('components/image_viewer.html')
    ]);

    for (const markup of [searchModal, imageViewer]) {
        assert.doesNotMatch(markup, /class="modal"/);
        assert.match(markup, /class="dialog-panel"/);
    }
});
