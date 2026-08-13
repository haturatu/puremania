import { test, expect } from './fixtures.js';
import {
    completePrompt,
    confirmDialog,
    fileItem,
    openApp,
    openFileBrowserControls,
    readStorageFile,
    resetStorage,
    storagePathExists,
} from './helpers.js';

test.beforeEach(async () => {
    await resetStorage();
});

test('keeps browser, server, and filesystem state in sync', async ({ page }) => {
    await openApp(page);
    await openFileBrowserControls(page);

    await page.getByRole('button', { name: /New Folder/ }).click();
    await completePrompt(page, 'Create Folder', 'test-dir', 'Create');
    await expect(fileItem(page, 'test-dir')).toBeVisible();

    await fileItem(page, 'test-dir').dblclick();
    await expect(page.locator('.breadcrumb-item[data-path="/test-dir"]')).toBeVisible();

    const uploadedName = '日本語 # &.txt';
    await page.locator('.upload-input-files').setInputFiles({
        name: uploadedName,
        mimeType: 'text/plain',
        buffer: Buffer.from('hello puremania'),
    });
    await expect(fileItem(page, uploadedName)).toBeVisible();
    await expect.poll(() => storagePathExists(`test-dir/${uploadedName}`)).toBe(true);
    await expect(page.locator('.progress-status')).toContainText('1/1 files uploaded');
    await page.locator('.progress-close').click();
    await expect(page.locator('.progress-overlay')).toBeHidden();

    await fileItem(page, uploadedName).dblclick();
    const editor = page.locator('.editor-modal');
    await expect(editor).toBeVisible();
    const editorContent = editor.locator('.cm-content');
    await editorContent.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('edited from Playwright');
    await editor.locator('#editor-save').click();
    await expect(editor).toBeHidden();
    await expect.poll(() => readStorageFile(`test-dir/${uploadedName}`)).toBe('edited from Playwright');

    await page.reload();
    await expect(fileItem(page, uploadedName)).toBeVisible();
    await fileItem(page, uploadedName).dblclick();
    await expect(page.locator('.editor-modal .cm-content')).toHaveText('edited from Playwright');
    await page.locator('.editor-modal #editor-cancel').click();

    const renamedName = 'renamed 日本語.txt';
    await fileItem(page, uploadedName).locator('[data-action="rename"]').click();
    await completePrompt(page, 'Rename File', renamedName, 'Rename');
    await expect(fileItem(page, renamedName)).toBeVisible();
    await expect.poll(() => storagePathExists(`test-dir/${renamedName}`)).toBe(true);
    await expect.poll(() => storagePathExists(`test-dir/${uploadedName}`)).toBe(false);

    await fileItem(page, renamedName).locator('[data-action="move"]').click();
    await completePrompt(page, 'Move File', '/', 'Move');
    await expect(fileItem(page, renamedName)).toBeHidden();
    await page.locator('.breadcrumb-item[data-path="/"]').click();
    await expect(fileItem(page, renamedName)).toBeVisible();
    await expect.poll(() => storagePathExists(renamedName)).toBe(true);
    await expect.poll(() => storagePathExists(`test-dir/${renamedName}`)).toBe(false);

    const downloadPromise = page.waitForResponse(response =>
        response.url().includes('/api/files/download') && response.status() === 200
    );
    await fileItem(page, renamedName).locator('[data-action="download"]').click();
    const downloadResponse = await downloadPromise;
    const disposition = downloadResponse.headers()['content-disposition'];
    expect(decodeURIComponent(disposition)).toContain(renamedName);
    await page.goBack();
    await expect(fileItem(page, renamedName)).toBeVisible();

    await fileItem(page, renamedName).locator('[data-action="delete"]').click();
    await confirmDialog(page, 'Delete File', 'Delete');
    await expect(fileItem(page, renamedName)).toBeHidden();
    await expect.poll(() => storagePathExists(renamedName)).toBe(false);

    await fileItem(page, 'test-dir').locator('[data-action="delete"]').click();
    await confirmDialog(page, 'Delete File', 'Delete');
    await expect(fileItem(page, 'test-dir')).toBeHidden();
    await expect.poll(() => storagePathExists('test-dir')).toBe(false);
});
