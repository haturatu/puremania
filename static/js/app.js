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
import { Aria2cPageHandler } from './aria2c-page.js';
import { loadTemplates } from './template.js';

class FileManagerApp {
    constructor() {
        this.selectedFiles = new Set();
        this.lastSelectedIndex = -1;
        this.config = {};
        this.isPC = !/Mobi|Android/i.test(navigator.userAgent);

        // Initialize modules that don't depend on templates in their constructor
        this.router = new Router();
        this.util = new Util(this);
        this.api = new ApiClient(this);
        this.uploader = new Uploader(this);
        this.events = new EventHandler(this);
        this.ui = new UIManager(this);
        
        // These will be initialized properly in the init method
        this.progressManager = new ProgressManager();
        this.editor = new FileEditor(this);
        this.mediaPlayer = new MediaPlayer(this);
        this.imageViewer = new ImageViewer(this);
        this.searchHandler = new SearchHandler(this);
        this.aria2cPageHandler = new Aria2cPageHandler(this);
    }

    async init() {
        // Initialize modules that need templates
        this.progressManager.init();
        this.imageViewer.init();
        this.searchHandler.init();
        
        // These might not have been converted to templates, but it's good practice
        // to have an init method for consistency. Let's assume they have one.
        // We need to check their implementation and add init() if it's missing.
        if(typeof this.editor.init === 'function') this.editor.init();
        if(typeof this.mediaPlayer.init === 'function') this.mediaPlayer.init();


        // Fetch config first
        this.config = await this.api.getConfig();
        if (!this.config) {
            return; // Stop initialization if config fails
        }

        // Update UI based on config
        this.ui.updateAria2cVisibility(this.config.Aria2cEnabled);

        this.events.bindEvents();
        this.aria2cPageHandler.init();
        this.updateStorageInfo();

        // Load and display specific dirs
        const specificDirs = await this.api.getSpecificDirs();
        this.ui.updateSpecificDirs(specificDirs);

        // Setup router
        this.router.onChange((path) => {
            if (path === '/system/aria2c') {
                if (!this.config.Aria2cEnabled) {
                    this.ui.showToast('Info', 'Aria2c feature is not enabled.', 'info');
                    this.router.navigate('/');
                    return;
                }
                if (this.searchHandler.isInSearchMode) {
                    this.searchHandler.exitSearchMode(true);
                }
                this.aria2cPageHandler.enterAria2cMode();
            } else {
                if (this.aria2cPageHandler.isInAria2cMode) {
                    this.aria2cPageHandler.exitAria2cMode();
                }
                this.navigateToPath(path);
            }
        });
    }

    async loadFiles(path) {
        await this.api.loadFiles(path);
        this.uploader.bindUploadEvents();
    }

    async navigateToPath(path) {
        await this.loadFiles(path);
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
            const result = await this.api.getStorageInfo();
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
    const templatePaths = [
        '/static/templates/components/toolbar.html',
        '/static/templates/components/upload_area.html',
        '/static/templates/components/empty_state.html',
        '/static/templates/components/view_toggle.html',
        '/static/templates/components/list_view_header.html',
        '/static/templates/components/list_view_item.html',
        '/static/templates/components/grid_view_item.html',
        '/static/templates/components/file_actions.html',
        '/static/templates/components/folder_actions.html',
        '/static/templates/components/toast.html',
        '/static/templates/components/nav_item.html',
        '/static/templates/components/masonry_item.html',
        '/static/templates/components/progress_overlay.html',
        '/static/templates/components/aria2c_header.html',
        '/static/templates/components/aria2c_no_downloads.html',
        '/static/templates/components/aria2c_table.html',
        '/static/templates/components/aria2c_table_row.html',
        '/static/templates/components/image_viewer.html',
        '/static/templates/components/completion_dropdown.html',
        '/static/templates/components/completion_item.html',
        '/static/templates/components/search_modal.html',
        '/static/templates/components/search_results_header.html',
        '/static/templates/components/search_no_results.html'
    ];
    await loadTemplates(templatePaths);

    const app = new FileManagerApp();
    await app.init();
}

document.addEventListener('DOMContentLoaded', main);
