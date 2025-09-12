import { Router } from './router.js';
import { ProgressManager } from './progress.js';
import { FileEditor } from './file-editor.js';
import { MediaPlayer } from './media-player.js';
import { ImageViewer } from './gallery.js';
import { SearchHandler } from './search.js';
import { UIManager } from './ui.js';
import { ApiClient } from './api.js';
import { EventHandler } from './events.js';
import { Uploader } from './uploader.js';
import { Util } from './util.js';

class FileManagerApp {
    constructor() {
        this.selectedFiles = new Set();
        this.lastSelectedIndex = -1;

        // Initialize modules
        this.router = new Router();
        this.progressManager = new ProgressManager();
        
        // Foundational modules that other modules depend on
        this.util = new Util(this);
        this.ui = new UIManager(this);
        this.api = new ApiClient(this);
        this.uploader = new Uploader(this);
        this.events = new EventHandler(this);

        // Modules with dependencies
        this.editor = new FileEditor(this);
        this.mediaPlayer = new MediaPlayer(this);
        this.imageViewer = new ImageViewer(this);
        
        // SearchHandler depends on many other modules, so it should be initialized 
        // after the modules it depends on are available.
        this.searchHandler = new SearchHandler(this);

        this.init();
    }

    init() {
        this.events.bindEvents();
        this.searchHandler.init();
        this.updateStorageInfo();

        this.router.onChange((path) => {
            this.navigateToPath(path);
        });
    }

    // Wrapper for API method to allow central control
    async loadFiles(path) {
        await this.api.loadFiles(path);
        // After files are loaded and UI is rendered, bind events to the new elements
        this.uploader.bindUploadEvents();
    }

    navigateToPath(path) {
        this.loadFiles(path);
        this.clearSelection();
    }

    navigateToParent() {
        const currentPath = this.router.getCurrentPath();
        if (currentPath === '/') return;
        const parentPath = this.util.getParentPath(currentPath);
        this.router.navigate(parentPath);
    }

    async editFile(path) {
        const content = await this.api.fetchFileContent(path);
        if (content !== null) {
            this.editor.open(path, content);
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
        } else if (this.util.isEditableFile(path)) {
            this.editFile(path);
        } else {
            this.api.downloadFile(path);
        }
    }

    clearSelection() {
        document.querySelectorAll('.file-item.selected, .masonry-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
        this.selectedFiles.clear();
        this.ui.updateToolbar();
    }

    async updateStorageInfo() {
        try {
            const response = await fetch('/api/storage-info');
            const result = await response.json();
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

document.addEventListener('DOMContentLoaded', () => {
    new FileManagerApp();
});