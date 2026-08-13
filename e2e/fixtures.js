import { test as base, expect } from '@playwright/test';

export const test = base.extend({
    page: async ({ page }, use) => {
        const errors = [];

        page.on('console', message => {
            if (message.type() === 'error') {
                errors.push(`console.error: ${message.text()}`);
            }
        });
        page.on('pageerror', error => {
            errors.push(`pageerror: ${error.stack || error.message}`);
        });
        page.on('response', response => {
            if (response.status() >= 400) {
                errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
            }
        });

        await page.addInitScript(() => {
            // CodeMirror's Vim mode is useful interactively, but disabling it
            // keeps Ctrl+A/Ctrl+S assertions deterministic in the E2E suite.
            try {
                localStorage.setItem('vimModeEnabled', 'false');
            } catch (_) {
                // File downloads may navigate to a sandboxed document.
            }
        });

        await use(page);

        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
        page.removeAllListeners('response');

        expect(errors, 'browser console/page errors or unexpected HTTP responses').toEqual([]);
    },
});

export { expect };
