import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const template = relativePath => readFile(new URL(`../templates/components/${relativePath}`, import.meta.url), 'utf8');

test('transfer rows expose native progress elements', async () => {
    const [uploadRow, aria2cRow] = await Promise.all([
        template('upload_page_row.html'),
        template('aria2c_table_row.html')
    ]);
    for (const markup of [uploadRow, aria2cRow]) {
        assert.match(markup, /<progress class="ui-progress"/);
        assert.match(markup, /max="100"/);
        assert.doesNotMatch(markup, /ui-progress__fill/);
    }
});

test('the upload overlay uses a native progress element', async () => {
    const markup = await template('progress_overlay.html');
    assert.match(markup, /<progress class="ui-progress"/);
    assert.doesNotMatch(markup, /role="progressbar"/);
    assert.doesNotMatch(markup, /ui-progress__fill/);
});
