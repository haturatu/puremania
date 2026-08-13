import { test, expect } from './fixtures.js';
import { completePrompt, fileItem, openApp, resetStorage } from './helpers.js';

test.beforeEach(async () => {
    await resetStorage();
});

test('supports the primary keyboard shortcuts in the browser', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+N');
    await completePrompt(page, 'Create Folder', 'keyboard-dir', 'Create');
    await expect(fileItem(page, 'keyboard-dir')).toBeVisible();

    await page.keyboard.press('Control+F');
    await expect(page.locator('.search-input')).toBeFocused();

    await page.locator('.search-input').fill('keyboard-dir');
    await page.locator('.search-input').press('Enter');
    await expect(page.locator('.search-results-header')).toContainText('keyboard-dir');
    await page.locator('.search-back-btn').click();
    await expect(fileItem(page, 'keyboard-dir')).toBeVisible();

    await fileItem(page, 'keyboard-dir').click();
    await page.keyboard.press('F2');
    await expect(page.getByRole('dialog', { name: 'Rename File' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Rename File' }).getByRole('button', { name: 'Cancel' }).click();
});
