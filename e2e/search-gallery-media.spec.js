import { test, expect } from './fixtures.js';
import {
    fileItem,
    openApp,
    openFileItem,
    onePixelJpeg,
    onePixelPng,
    resetStorage,
    seedFiles,
    shortWav,
} from './helpers.js';

test.beforeEach(async () => {
    await resetStorage();
});

test('searches the real storage and renders matching results', async ({ page }) => {
    await seedFiles({
        'alpha.txt': 'alpha',
        'beta.txt': 'beta',
        '日本語.txt': 'unicode',
    });

    await openApp(page);
    const search = page.locator('.search-input');
    await search.fill('alpha');
    await search.press('Enter');

    await expect(page.locator('.search-results-header')).toContainText('Search Results for "alpha"');
    await expect(fileItem(page, 'alpha.txt')).toBeVisible();
    await expect(fileItem(page, 'beta.txt')).toBeHidden();
});

test('opens image navigation and media controls in Chromium', async ({ page }) => {
    await seedFiles({
        'image-one.png': onePixelPng(),
        'image-two.png': onePixelPng(),
        'cover.jpg': onePixelJpeg(),
        'tone.wav': shortWav(),
    });

    await openApp(page);
    await openFileItem(page, 'image-one.png');
    const viewer = page.locator('.image-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.image-name')).toHaveText('image-one.png');
    await expect(viewer.locator('img')).toHaveJSProperty('naturalWidth', 1);
    await viewer.locator('.next').click();
    await expect(viewer.locator('.image-name')).toHaveText('image-two.png');
    await viewer.locator('.dialog-close').click();
    await expect(viewer).toBeHidden();

    const mediaResponse = page.waitForResponse(response =>
        response.url().includes('/api/files/download') && response.status() >= 200 && response.status() < 400
    );
    await openFileItem(page, 'tone.wav');
    await mediaResponse;
    await expect(page.locator('.media-player')).toBeVisible();
    await expect(page.locator('.media-player audio')).toHaveAttribute('src', /\/api\/files\/download/);
});
