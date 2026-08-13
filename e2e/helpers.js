import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

export const storageDir = process.env.E2E_STORAGE_DIR || '/tmp/puremania-e2e';

export async function resetStorage() {
    await rm(storageDir, { recursive: true, force: true });
    await mkdir(storageDir, { recursive: true });
}

export async function openApp(page) {
    await page.goto('/');
    await page.locator('.file-browser .no-files, .file-browser .file-item').first().waitFor({ state: 'visible' });
}

export async function seedFiles(files) {
    for (const [relativePath, content] of Object.entries(files)) {
        const path = `${storageDir}/${relativePath}`;
        const parent = path.slice(0, path.lastIndexOf('/'));
        await mkdir(parent, { recursive: true });
        await writeFile(path, content);
    }
}

export async function readStorageFile(relativePath) {
    return readFile(`${storageDir}/${relativePath}`, 'utf8');
}

export async function storagePathExists(relativePath) {
    try {
        await stat(`${storageDir}/${relativePath}`);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

export function fileItem(page, name) {
    return page.locator('.file-item').filter({ hasText: name }).first();
}

export async function openFileItem(page, name) {
    const item = fileItem(page, name);
    if ((page.viewportSize()?.width || 1280) <= 500) {
        await item.click();
        await item.click();
    } else {
        await item.dblclick();
    }
}

export async function openFileBrowserControls(page) {
    await page.locator('#toggle-file-browser-extensions-btn').click();
    await expectVisible(page.locator('.toolbar'));
}

export async function expectVisible(locator) {
    await locator.waitFor({ state: 'visible' });
}

export async function completePrompt(page, title, value, buttonLabel) {
    const dialog = page.getByRole('dialog', { name: title });
    await expectVisible(dialog);
    await dialog.getByRole('textbox').fill(value);
    await dialog.getByRole('button', { name: buttonLabel }).click();
    await dialog.waitFor({ state: 'hidden' }).catch(() => {});
}

export async function confirmDialog(page, title, buttonLabel) {
    const dialog = page.getByRole('dialog', { name: title });
    await expectVisible(dialog);
    await dialog.getByRole('button', { name: buttonLabel }).click();
}

export function onePixelPng() {
    return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
}

export function onePixelJpeg() {
    return Buffer.from(
        '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
        'base64'
    );
}

export function shortWav() {
    const sampleRate = 8_000;
    const samples = sampleRate / 10;
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let index = 0; index < samples; index++) {
        buffer.writeInt16LE(Math.round(Math.sin(index / 4) * 2_000), 44 + index * 2);
    }
    return buffer;
}
