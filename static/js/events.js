export class EventHandler {
    constructor(app) {
        this.app = app;
    }

    bindEvents() {
        document.addEventListener('click', (e) => this.handleClick(e));
        document.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
        document.addEventListener('change', (e) => this.handleChange(e));

        const fileBrowser = document.querySelector('.file-browser');
        if (fileBrowser) {
            this.bindDragDropEvents(fileBrowser);
        }
    }

    handleClick(e) {
        // Navigation clicks
        const navItem = e.target.closest('.nav-item');
        if (navItem) {
            e.preventDefault();
            const path = navItem.dataset.path;
            if (path) {
                this.app.router.navigate(path);
            }
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
            const fileItem = e.target.closest('.file-item, .masonry-item, .video-card');
            if (button && fileItem) {
                e.stopPropagation();
                this.handleFileActionClick(button, fileItem);
                return;
            }
        }
        
        // File item clicks
        if (e.target.matches('.file-item, .masonry-item, .video-card') || e.target.closest('.file-item, .masonry-item, .video-card')) {
            const fileItem = e.target.closest('.file-item, .masonry-item, .video-card');
            if (fileItem) {
                this.handleFileClick(fileItem, e);
            }
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

    handleChange(e) {
        if (e.target.matches('.view-toggle-input')) {
            this.app.ui.setViewMode(e.target.value);
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
        if (e.target.matches('.file-item, .masonry-item, .video-card') || e.target.closest('.file-item, .masonry-item, .video-card')) {
            const fileItem = e.target.closest('.file-item, .masonry-item, .video-card');
            if (fileItem) {
                this.handleFileDoubleClick(fileItem);
            }
        }
    }

    handleKeydown(e) {
        if (e.defaultPrevented) return;
        const target = e.target;
        if (target instanceof Element && target.closest('input, textarea, select, dialog, [contenteditable="true"], .cm-editor, .editor-modal')) return;
        const browserFocused = document.activeElement?.closest?.('.file-browser') || target?.closest?.('.file-browser');
        const noModifiers = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
        const altOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
        const shiftOnly = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
        const keyActions = {
            'Delete': () => browserFocused && this.app.selectedFiles.size > 0 && this.app.api.deleteSelectedFiles(),
            'Backspace': () => {
                if (!noModifiers) return;
                e.preventDefault();
                this.app.navigateToParent();
            },
            'ArrowLeft': () => {
                if (!noModifiers) return;
                e.preventDefault();
                this.app.navigateToParent();
            },
            'f': () => e.ctrlKey && (e.preventDefault(), document.querySelector('.search-input')?.focus()),
            'n': () => {
                if (shiftOnly) {
                    e.preventDefault();
                    this.app.api.createNewFolder();
                } else if (noModifiers || altOnly) {
                    e.preventDefault();
                    this.app.api.createNewFile();
                }
            },
            'u': () => noModifiers && (e.preventDefault(), this.app.uploader.showUploadDialog()),
            'F2': () => {
                if (this.app.selectedFiles.size === 1) {
                    const path = Array.from(this.app.selectedFiles)[0];
                    this.app.api.renameFile(path);
                }
            }
        };

        const normalizedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const action = keyActions[e.key] || keyActions[normalizedKey];
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
                e.stopPropagation();
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

        const fileItems = Array.from(document.querySelectorAll('.file-item, .masonry-item, .video-card'));
        const anchorIndex = fileItems.findIndex(item => item.dataset.path === this.app.selectionAnchorPath);
        const currentIndex = fileItems.indexOf(fileItem);
        let nextSelection = new Set(this.app.selectedFiles);
        let nextAnchor = this.app.selectionAnchorPath;
        
        if (event.shiftKey && anchorIndex !== -1 && anchorIndex !== currentIndex) {
            nextSelection = new Set();
            const start = Math.min(anchorIndex, currentIndex);
            const end = Math.max(anchorIndex, currentIndex);
            for (let i = start; i <= end; i++) {
                if (i < fileItems.length) {
                    nextSelection.add(fileItems[i].dataset.path);
                }
            }
        } 
        else if (event.ctrlKey || event.metaKey) {
            if (isSelected) {
                nextSelection.delete(path);
            } else {
                nextSelection.add(path);
                nextAnchor = path;
            }
        } 
        else {
            nextSelection = new Set([path]);
            nextAnchor = path;
        }
        this.app.setSelection(nextSelection, nextAnchor);
        // File cards are non-form containers, so a pointer click otherwise
        // leaves focus on <body>. Keep keyboard actions scoped to the browser
        // while allowing Delete to work immediately after selecting an item.
        fileItem.closest('.file-browser')?.focus({ preventScroll: true });
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
