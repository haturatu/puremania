export class EventHandler {
    constructor(app) {
        this.app = app;
    }

    bindEvents() {
        document.addEventListener('click', (e) => this.handleClick(e));
        document.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        document.addEventListener('keydown', (e) => this.handleKeydown(e));

        const fileBrowser = document.querySelector('.file-browser');
        if (fileBrowser) {
            this.bindDragDropEvents(fileBrowser);
        }
    }

    handleClick(e) {
        // Navigation clicks
        if (e.target.matches('.nav-item')) {
            e.preventDefault();
            const path = e.target.dataset.path;
            if (path) {
                this.app.router.navigate(path);
            }
            return;
        }

        const aria2cBtn = e.target.closest('#aria2c-status-btn');
        if (aria2cBtn) {
            e.preventDefault();
            this.app.router.navigate('/system/aria2c');
            return;
        }
        
        // Breadcrumb clicks
        if (e.target.matches('.breadcrumb-item')) {
            e.preventDefault();
            const path = e.target.dataset.path;
            if (path) {
                this.app.router.navigate(path);
            }
            return;
        }
        
        // File action button clicks
        if (e.target.matches('.file-action-btn, .file-action-btn *')) {
            const button = e.target.closest('.file-action-btn');
            const fileItem = e.target.closest('.file-item, .masonry-item');
            if (button && fileItem) {
                e.stopPropagation();
                this.handleFileActionClick(button, fileItem);
                return;
            }
        }
        
        // File item clicks
        if (e.target.matches('.file-item, .masonry-item') || e.target.closest('.file-item, .masonry-item')) {
            const fileItem = e.target.closest('.file-item, .masonry-item');
            if (fileItem) {
                this.handleFileClick(fileItem, e);
            }
            return;
        }
        
        // View toggle buttons
        if (e.target.matches('.view-toggle-btn')) {
            this.app.ui.setViewMode(e.target.dataset.view);
            return;
        }

        if (e.target.id === 'toggle-file-browser-extensions-btn') {
            this.app.ui.toggleFileBrowserExtensions();
            return;
        }
        
        // Toolbar buttons
        if (e.target.matches('.toolbar-btn')) {
            this.handleToolbarClick(e.target);
            return;
        }
    }

    handleFileActionClick(button, fileItem) {
        const path = fileItem.dataset.path;
        const action = button.dataset.action || this.getActionFromButtonText(button);
        
        switch (action) {
            case 'download':
                this.app.api.downloadFile(path);
                break;
            case 'delete':
                this.app.api.deleteFile(path);
                break;
            case 'edit':
                this.app.editFile(path);
                break;
            case 'rename':
                this.app.api.renameFile(path);
                break;
            case 'move':
                this.app.api.moveFile(path);
                break;
            case 'extract':
                this.app.api.extractFile(path);
                break;
        }
    }

    getActionFromButtonText(button) {
        const text = button.textContent.trim();
        const actionMap = {
            '⬇': 'download',
            '🗑': 'delete',
            '✏': 'edit',
            '✏️': 'rename',
            '➡️': 'move'
        };
        return actionMap[text] || '';
    }

    handleToolbarClick(button) {
        const action = button.dataset.action;
        
        switch (action) {
            case 'upload':
                this.app.uploader.showUploadDialog();
                break;
            case 'new-folder':
                this.app.api.createNewFolder();
                break;
            case 'new-file':
                this.app.api.createNewFile();
                break;
            case 'download':
                this.app.api.downloadSelected();
                break;
            case 'move':
                this.app.api.moveSelected();
                break;
            case 'delete':
                this.app.api.deleteSelectedFiles();
                break;
        }
    }

    handleDoubleClick(e) {
        if (e.target.matches('.file-item, .masonry-item') || e.target.closest('.file-item, .masonry-item')) {
            const fileItem = e.target.closest('.file-item, .masonry-item');
            if (fileItem) {
                this.handleFileDoubleClick(fileItem);
            }
        }
    }

    handleKeydown(e) {
        const keyActions = {
            'Delete': () => this.app.selectedFiles.size > 0 && this.app.api.deleteSelectedFiles(),
            'ArrowLeft': () => e.altKey && this.app.navigateToParent(),
            'f': () => e.ctrlKey && (e.preventDefault(), document.querySelector('.search-input')?.focus()),
            'n': () => {
                if (e.ctrlKey) {
                    e.preventDefault();
                    e.shiftKey ? this.app.api.createNewFolder() : this.app.api.createNewFile();
                }
            },
            'u': () => e.ctrlKey && (e.preventDefault(), this.app.uploader.showUploadDialog()),
            'F2': () => {
                if (this.app.selectedFiles.size === 1) {
                    const path = Array.from(this.app.selectedFiles)[0];
                    this.app.api.renameFile(path);
                }
            }
        };

        const action = keyActions[e.key];
        if (action) {
            action();
        }
    }

    bindDragDropEvents(fileBrowser) {
        let dragCounter = 0;
        
        fileBrowser.addEventListener('dragenter', (e) => {
            if (!e.target.closest('.upload-area')) {
                e.preventDefault();
                dragCounter++;
                fileBrowser.classList.add('dragover');
            }
        });
    
        fileBrowser.addEventListener('dragover', (e) => {
            if (!e.target.closest('.upload-area')) {
                e.preventDefault();
            }
        });
    
        fileBrowser.addEventListener('dragleave', (e) => {
            if (!e.target.closest('.upload-area')) {
                e.preventDefault();
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    fileBrowser.classList.remove('dragover');
                }
            }
        });
    
        fileBrowser.addEventListener('drop', (e) => {
            if (!e.target.closest('.upload-area')) {
                e.preventDefault();
                dragCounter = 0;
                fileBrowser.classList.remove('dragover');
                this.app.uploader.handleFileDrop(e);
            }
        });
    }

    handleFileClick(fileItem, event) {
        const path = fileItem.dataset.path;
        const isSelected = this.app.selectedFiles.has(path);

        // On mobile, if an item is already selected and it's the only one, the next tap opens it.
        if (!this.app.isPC && isSelected && this.app.selectedFiles.size === 1) {
            this.handleFileDoubleClick(fileItem);
            return;
        }

        const fileItems = Array.from(document.querySelectorAll('.file-item, .masonry-item'));
        const currentIndex = fileItems.indexOf(fileItem);
        
        if (event.shiftKey && this.app.lastSelectedIndex !== -1 && this.app.lastSelectedIndex !== currentIndex) {
            this.app.clearSelection();
            
            const start = Math.min(this.app.lastSelectedIndex, currentIndex);
            const end = Math.max(this.app.lastSelectedIndex, currentIndex);
            
            for (let i = start; i <= end; i++) {
                if (i < fileItems.length) {
                    const item = fileItems[i];
                    const itemPath = item.dataset.path;
                    this.app.selectedFiles.add(itemPath);
                    item.classList.add('selected');
                }
            }
        } 
        else if (event.ctrlKey || event.metaKey) {
            if (isSelected) {
                this.app.selectedFiles.delete(path);
                fileItem.classList.remove('selected');
            } else {
                this.app.selectedFiles.add(path);
                fileItem.classList.add('selected');
                this.app.lastSelectedIndex = currentIndex;
            }
        } 
        else {
            this.app.clearSelection();
            this.app.selectedFiles.add(path);
            fileItem.classList.add('selected');
            this.app.lastSelectedIndex = currentIndex;
        }
        
        this.app.ui.updateToolbar();
    }

    handleFileDoubleClick(fileItem) {
        const path = fileItem.dataset.path;
        const isDir = fileItem.dataset.isDir === 'true';
        const mimeType = fileItem.dataset.mimeType || '';

        if (this.app.searchHandler && this.app.searchHandler.isInSearchMode && isDir) {
            this.app.searchHandler.navigateToFolder(path);
            return;
        }
        
        if (isDir) {
            this.app.router.navigate(path);
        } else {
            this.app.openFile(path, mimeType);
        }
    }
}
