import { test, expect } from './fixtures.js';
import {
    completePrompt,
    confirmDialog,
    fileItem,
    openApp,
    openFileBrowserControls,
    openFileItem,
    resetStorage,
    seedFiles,
    storagePathExists,
} from './helpers.js';

const renameDialog = page => page.getByRole('dialog', { name: 'Rename File' });

async function openWithSelectedFile(page, name = 'focus-target.bin') {
    await seedFiles({ [name]: 'keyboard shortcut guard' });
    await openApp(page);
    const item = fileItem(page, name);
    await item.click();
    await expect(item).toHaveAttribute('aria-selected', 'true');
    return item;
}

async function expectF2Suppressed(page) {
    await page.keyboard.press('F2');
    await expect(renameDialog(page)).toHaveCount(0);
}

test.beforeEach(async () => {
    await resetStorage();
});

test('Ctrl+N creates a file', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+N');
    await completePrompt(page, 'Create File', 'keyboard-file.bin', 'Create');

    await expect(fileItem(page, 'keyboard-file.bin')).toBeVisible();
    await expect.poll(() => storagePathExists('keyboard-file.bin')).toBe(true);
});

test('Ctrl+Shift+N creates a folder', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+N');
    await completePrompt(page, 'Create Folder', 'keyboard-dir', 'Create');

    await expect(fileItem(page, 'keyboard-dir')).toBeVisible();
    await expect.poll(() => storagePathExists('keyboard-dir')).toBe(true);
});

test('Ctrl+U opens the native upload chooser', async ({ page }) => {
    await openApp(page);

    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.keyboard.press('Control+U'),
    ]);

    expect(chooser.isMultiple()).toBe(true);
});

test('Ctrl+F focuses application search and prevents the browser shortcut', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
        const probe = event => {
            if (event.ctrlKey && event.key.toLowerCase() === 'f') {
                globalThis.__e2eCtrlFDefaultPrevented = event.defaultPrevented;
                document.removeEventListener('keydown', probe);
            }
        };
        document.addEventListener('keydown', probe);
    });

    await page.keyboard.press('Control+F');

    await expect(page.locator('.search-input')).toBeFocused();
    await expect.poll(() => page.evaluate(() => globalThis.__e2eCtrlFDefaultPrevented)).toBe(true);
});

test('F2 renames only when exactly one item is selected', async ({ page }) => {
    await seedFiles({ 'first.bin': 'first', 'second.bin': 'second' });
    await openApp(page);

    await page.keyboard.press('F2');
    await expect(renameDialog(page)).toHaveCount(0);

    const first = fileItem(page, 'first.bin');
    const second = fileItem(page, 'second.bin');
    await first.click();
    await second.click({ modifiers: ['Control'] });
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('F2');
    await expect(renameDialog(page)).toHaveCount(0);

    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(second).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('F2');
    await completePrompt(page, 'Rename File', 'renamed-first.bin', 'Rename');
    await expect(fileItem(page, 'renamed-first.bin')).toBeVisible();
    await expect.poll(() => storagePathExists('renamed-first.bin')).toBe(true);
    await expect.poll(() => storagePathExists('first.bin')).toBe(false);
});

test('Delete requires selection and focus inside the file browser', async ({ page }) => {
    await seedFiles({ 'delete-target.bin': 'keep until confirmed' });
    await openApp(page);
    await openFileBrowserControls(page);
    const browserControl = page.getByRole('button', { name: /New File/ });
    const item = fileItem(page, 'delete-target.bin');

    await browserControl.focus();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('dialog', { name: 'Delete Selected Items' })).toHaveCount(0);

    await item.click();
    await page.locator('.search-input').focus();
    await page.keyboard.press('Delete');
    await expect(item).toBeVisible();
    await expect.poll(() => storagePathExists('delete-target.bin')).toBe(true);

    await browserControl.focus();
    await page.keyboard.press('Delete');
    await confirmDialog(page, 'Delete Selected Items', 'Delete');
    await expect(item).toBeHidden();
    await expect.poll(() => storagePathExists('delete-target.bin')).toBe(false);
});

test('Alt+Left navigates to the parent directory', async ({ page }) => {
    await seedFiles({ 'parent/child/file.bin': 'nested' });
    await openApp(page);
    await openFileItem(page, 'parent');
    await openFileItem(page, 'child');
    await expect(page).toHaveURL(/\/parent\/child$/);

    await page.keyboard.press('Alt+ArrowLeft');

    await expect(page).toHaveURL(/\/parent$/);
    await expect(page.locator('.breadcrumb-item[data-path="/parent"]')).toBeVisible();
});

test.describe('shortcut suppression', () => {
    test('ignores shortcuts while an input is focused', async ({ page }) => {
        await openWithSelectedFile(page);
        const searchInput = page.locator('.search-input');
        await searchInput.focus();

        await expectF2Suppressed(page);
        await expect(searchInput).toBeFocused();
    });

    test('ignores shortcuts while a textarea is focused', async ({ page }) => {
        await openWithSelectedFile(page);
        await page.evaluate(() => {
            const textarea = document.createElement('textarea');
            textarea.dataset.testid = 'shortcut-textarea';
            textarea.value = 'editing';
            document.body.appendChild(textarea);
        });
        const textarea = page.getByTestId('shortcut-textarea');
        await textarea.focus();

        await expectF2Suppressed(page);
        await expect(textarea).toBeFocused();
    });

    test('ignores shortcuts while a select is focused', async ({ page }) => {
        await openWithSelectedFile(page);
        await page.locator('.search-options').click();
        const dialog = page.getByRole('dialog', { name: 'Search Options' });
        const select = dialog.locator('#search-scope');
        await select.focus();

        await expectF2Suppressed(page);
        await expect(select).toBeFocused();
    });

    test('ignores shortcuts from non-form controls inside a dialog', async ({ page }) => {
        await openWithSelectedFile(page);
        await page.locator('.search-options').click();
        const dialog = page.getByRole('dialog', { name: 'Search Options' });
        const applyButton = dialog.getByRole('button', { name: 'Apply' });
        await applyButton.focus();

        await expectF2Suppressed(page);
        await expect(applyButton).toBeFocused();
    });

    test('ignores shortcuts while contenteditable is focused', async ({ page }) => {
        await openWithSelectedFile(page);
        await page.evaluate(() => {
            const editable = document.createElement('div');
            editable.contentEditable = 'true';
            editable.dataset.testid = 'shortcut-contenteditable';
            editable.textContent = 'editing';
            document.body.appendChild(editable);
        });
        const editable = page.getByTestId('shortcut-contenteditable');
        await editable.focus();

        await expectF2Suppressed(page);
        await expect(editable).toBeFocused();
    });

    test('ignores application shortcuts inside the CodeMirror editor', async ({ page }) => {
        await seedFiles({ 'editor-target.txt': 'editable text' });
        await openApp(page);
        await openFileItem(page, 'editor-target.txt');
        const editor = page.locator('.editor-modal');
        const editorContent = editor.locator('.cm-content');
        await expect(editor).toBeVisible();
        await editorContent.focus();

        await expectF2Suppressed(page);
        await expect(editorContent).toBeFocused();
    });
});
