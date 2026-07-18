import { loadTemplates } from './template.js';
import { AppStateStore } from './state.js';
import { ALL_TEMPLATES } from './template-registry.js';
import { createAppServices } from './app-services.js';
import { initializeApp } from './app-initializer.js';
import { getParentPath, isEditableFile } from './util.js';

class FileManagerApp {
    constructor() {
        this.store = new AppStateStore();
        this.config = {};
        this.directoryScrollPositions = new Map();
        this.isPC = !/Mobi|Android/i.test(navigator.userAgent);
        this.eventBus = new EventTarget();

        createAppServices(this);
    }

    emit(type, detail = {}, { cancelable = false } = {}) {
        const event = new CustomEvent(type, { detail, cancelable });
        this.eventBus.dispatchEvent(event);
        return event;
    }

    get selectedFiles() { return this.store.getState().selection.paths; }
    get selectionAnchorPath() { return this.store.getState().selection.anchorPath; }

    async init() {
        await initializeApp(this);
    }

    async loadFiles(path, options = {}) {
        await this.api.loadFiles(path, options);
        this.uploader.bindUploadEvents();
    }

    async navigateToPath(path, { restoreScroll = false } = {}) {
        const browser = document.querySelector('.file-browser');
        const renderedPath = this.store.getState().directory.renderedPath;
        if (browser && renderedPath && renderedPath !== path) {
            this.directoryScrollPositions.set(renderedPath, browser.scrollTop);
        }
        await this.loadFiles(path);
        const restorePosition = restoreScroll ? (this.directoryScrollPositions.get(path) ?? 0) : 0;
        // File rendering replaces the browser contents. Restore after layout so
        // new directories start at the top while revisited ones retain context.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const currentBrowser = document.querySelector('.file-browser');
                if (currentBrowser && this.router.getCurrentPath() === path) currentBrowser.scrollTop = restorePosition;
            });
        });
        this.clearSelection();
    }

    navigateToParent() {
        const currentPath = this.router.getCurrentPath();
        if (currentPath === '/') return;
        const parentPath = getParentPath(currentPath);
        this.router.navigate(parentPath);
    }

    async editFile(path) {
        const requestId = this.store.getState().editor.loadRequestId + 1;
        this.store.update('editor', { loadRequestId: requestId, status: 'loading', path }, 'EDITOR_LOAD_STARTED');
        const content = await this.api.fetchFileContent(path);
        if (requestId === this.store.getState().editor.loadRequestId && content !== null) {
            this.editor.open(path, content);
        } else if (requestId === this.store.getState().editor.loadRequestId) {
            this.store.update('editor', { status: 'closed', path: null }, 'EDITOR_LOAD_FAILED');
        }
    }

    openFile(path, mimeType) {
        if (!mimeType) {
            const ext = path.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
                mimeType = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
            }
        }

        if (mimeType && mimeType.startsWith('image/')) {
            this.imageViewer.open(path);
        } else if (mimeType && mimeType.startsWith('audio/')) {
            this.mediaPlayer.playAudio(path);
        } else if (mimeType && mimeType.startsWith('video/')) {
            this.mediaPlayer.playVideo(path);
        } else if (isEditableFile(path)) {
            this.editFile(path);
        } else {
            this.api.downloadFile(path);
        }
    }

    setSelection(paths, anchorPath = this.selectionAnchorPath) {
        this.store.update('selection', { paths: new Set(paths), anchorPath }, 'SELECTION_CHANGED');
        this.ui.syncSelectionClasses();
        this.ui.updateToolbar();
    }

    clearSelection() {
        this.setSelection([], null);
    }

    updateStorageInfo(result) {
        try {
            if (result.success) {
                const info = result.data;
                const usagePercentage = (info.used / info.total) * 100;
                document.getElementById('storage-used').textContent = this.ui.formatFileSize(info.used);
                document.getElementById('storage-total').textContent = this.ui.formatFileSize(info.total);
                document.getElementById('storage-progress-inner').style.width = `${usagePercentage}%`;
            } else {
                console.error('Could not update storage info', result.message);
            }
        } catch (error) {
            console.error('Error fetching storage info:', error);
        }
    }
}

async function main() {
    await loadTemplates(ALL_TEMPLATES);

    const app = new FileManagerApp();
    await app.init();
}

function renderStartupError(error) {
    console.error('Failed to initialize Pure Mania', error);
    const root = document.getElementById('app-root') || document.body;
    const panel = document.createElement('main');
    panel.className = 'startup-error';
    panel.setAttribute('role', 'alert');

    const title = document.createElement('h1');
    title.textContent = 'Pure Mania could not start';
    const message = document.createElement('p');
    message.textContent = navigator.onLine
        ? 'Some application resources could not be loaded.'
        : 'You appear to be offline. Check your connection and try again.';
    panel.append(title, message);

    if (Array.isArray(error?.failures)) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Failed resources';
        const list = document.createElement('ul');
        error.failures.forEach(({ url }) => {
            const item = document.createElement('li');
            item.textContent = url;
            list.appendChild(item);
        });
        details.append(summary, list);
        panel.appendChild(details);
    }

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => window.location.reload());
    panel.appendChild(retry);
    root.replaceChildren(panel);
    retry.focus();
}

function startApplication() {
    void main().catch(renderStartupError);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApplication, { once: true });
} else {
    startApplication();
}
