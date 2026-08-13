import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FileSystemPicker } from './file-system-picker.js';

const fileHandle = name => ({ kind: 'file', name, getFile: async () => ({ name }) });
const directoryHandle = (name, children) => ({
    kind: 'directory',
    name,
    async *entries() {
        for (const child of children) yield [child.name, child];
    }
});

test('maps selected file handles to upload items', async () => {
    const picker = new FileSystemPicker({
        showOpenFilePicker: async options => {
            assert.deepEqual(options, { multiple: true });
            return [fileHandle('one.txt'), fileHandle('two.txt')];
        }
    });

    const items = await picker.pickFiles();

    assert.deepEqual(items.map(item => item.relativePath), ['one.txt', 'two.txt']);
});

test('walks a selected directory while preserving its root path', async () => {
    const root = directoryHandle('photos', [
        fileHandle('cover.jpg'),
        directoryHandle('raw', [fileHandle('frame.png')])
    ]);
    const picker = new FileSystemPicker({ showDirectoryPicker: async () => root });

    const items = await picker.pickDirectory();

    assert.deepEqual(items.map(item => item.relativePath), [
        'photos/cover.jpg',
        'photos/raw/frame.png'
    ]);
});

test('reports unsupported pickers so callers can use file inputs', async () => {
    const picker = new FileSystemPicker({});

    assert.equal(await picker.pickFiles(), null);
    assert.equal(await picker.pickDirectory(), null);
});

test('retains input and webkitdirectory fallbacks', async () => {
    const template = await readFile(new URL('../templates/components/upload_area.html', import.meta.url), 'utf8');
    assert.match(template, /input type="file" class="upload-input-files"/);
    assert.match(template, /class="upload-input-folders" webkitdirectory/);
});

for (const count of [10_000, 100_000, 300_000]) {
    test(`yields responsively while walking ${count.toLocaleString()} file handles`, async () => {
        let yields = 0;
        const root = {
            kind: 'directory',
            name: 'large',
            async *entries() {
                for (let index = 0; index < count; index++) {
                    const name = `${index}.txt`;
                    yield [name, fileHandle(name)];
                }
            }
        };
        const picker = new FileSystemPicker(
            { showDirectoryPicker: async () => root },
            async () => { yields += 1; }
        );

        const items = await picker.pickDirectory();

        assert.equal(items.length, count);
        assert.equal(yields, Math.floor(count / 500));
        assert.equal(items.at(-1).relativePath, `large/${count - 1}.txt`);
    });
}
