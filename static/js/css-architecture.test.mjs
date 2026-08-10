import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styleSheet = () => readFile(new URL('../css/style.css', import.meta.url), 'utf8');

test('the main stylesheet declares an explicit cascade layer order', async () => {
    const styles = await styleSheet();
    assert.match(styles, /@layer reset, tokens, base, layout, components, utilities, responsive;/);
});

test('stylesheet imports are assigned to the intended cascade layers', async () => {
    const styles = await styleSheet();
    const imports = styles.matchAll(/@import url\('([^']+)'\) layer\(([^)]+)\);/g);
    const assignments = Object.fromEntries([...imports].map(([, path, layer]) => [path, layer]));
    assert.equal(assignments['base/variables.css'], 'tokens');
    assert.equal(assignments['base/base.css'], 'base');
    assert.equal(assignments['layout/sidebar.css'], 'layout');
    assert.equal(assignments['components/file-browser.css'], 'components');
    assert.equal(assignments['responsive.css'], 'responsive');
});
