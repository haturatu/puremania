const SCAN_YIELD_INTERVAL = 500;

export class FileSystemPicker {
    constructor(windowObject = globalThis.window, yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0))) {
        this.window = windowObject;
        this.yieldToBrowser = yieldToBrowser;
    }

    get supportsFiles() {
        return typeof this.window?.showOpenFilePicker === 'function';
    }

    get supportsDirectories() {
        return typeof this.window?.showDirectoryPicker === 'function';
    }

    async pickFiles() {
        if (!this.supportsFiles) return null;
        const handles = await this.window.showOpenFilePicker({ multiple: true });
        const items = [];
        for (const handle of handles) {
            const file = await handle.getFile();
            items.push({ file, relativePath: file.name });
        }
        return items;
    }

    async pickDirectory() {
        if (!this.supportsDirectories) return null;
        const directory = await this.window.showDirectoryPicker();
        const items = [];
        let scanned = 0;
        const visit = async (handle, parent) => {
            for await (const [name, child] of handle.entries()) {
                const relativePath = parent ? `${parent}/${name}` : name;
                if (child.kind === 'file') {
                    items.push({ file: await child.getFile(), relativePath });
                } else if (child.kind === 'directory') {
                    await visit(child, relativePath);
                }
                scanned += 1;
                if (scanned % SCAN_YIELD_INTERVAL === 0) await this.yieldToBrowser();
            }
        };
        await visit(directory, directory.name);
        return items;
    }
}
