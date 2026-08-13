import { test, expect } from './fixtures.js';
import { resetStorage } from './helpers.js';

test.beforeEach(async () => {
    await resetStorage();
});

test('application boots with the real server and static assets', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Pure Mania/i);
    await expect(page.locator('.file-browser')).toBeVisible();
    await expect(page.locator('.no-files')).toContainText('No files found');
    await expect(page.locator('link[href*="/static/css/style.css"]')).toHaveCount(1);
    await expect(page.locator('.storage-info')).toBeVisible();
});
