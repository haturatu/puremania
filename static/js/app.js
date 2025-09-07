class ProgressManager {
    constructor() {
        this.progressOverlay = null;
        this.currentUpload = null;
        this.init();
    }

    init() {
        this.createProgressOverlay();
    }

    createProgressOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'progress-overlay';
        overlay.innerHTML = `
            <div class="progress-modal">
                <div class="progress-header">
                    <div class="progress-title">Uploading Files</div>
                    <button class="progress-close">&times;</button>
                </div>
                <div class="progress-info">
                    <span class="progress-current">Preparing files...</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill"></div>
                </div>
                <div class="progress-details">
                    <span class="progress-percentage">0%</span>
                    <span class="progress-stats">0 files processed</span>
                </div>
                <div class="progress-status">Initializing...</div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.progressOverlay = overlay;

        overlay.querySelector('.progress-close').addEventListener('click', () => {
            this.hide();
            if (this.currentUpload) {
                this.currentUpload.abort();
            }
        });
    }

    show(title = 'Uploading Files') {
        if (this.progressOverlay) {
            this.progressOverlay.querySelector('.progress-title').textContent = title;
            this.progressOverlay.style.display = 'flex';
            this.resetProgress();
        }
    }

    hide() {
        if (this.progressOverlay) {
            this.progressOverlay.style.display = 'none';
        }
        this.currentUpload = null;
    }

    resetProgress() {
        this.updateProgress({
            currentFile: 'Preparing files...',
            percentage: 0,
            processed: 0,
            total: 0,
            status: 'Initializing...'
        });
    }

    updateProgress(progress) {
        if (!this.progressOverlay) return;

        const {
            currentFile = '',
            percentage = 0,
            processed = 0,
            total = 0,
            status = ''
        } = progress;

        const percentageText = Math.round(percentage) + '%';
        const statsText = total > 0 ? `${processed}/${total} files` : `${processed} files processed`;

        this.progressOverlay.querySelector('.progress-current').textContent = currentFile;
        this.progressOverlay.querySelector('.progress-bar-fill').style.width = percentageText;
        this.progressOverlay.querySelector('.progress-percentage').textContent = percentageText;
        this.progressOverlay.querySelector('.progress-stats').textContent = statsText;

        if (status) {
            this.progressOverlay.querySelector('.progress-status').textContent = status;
        }
    }

    setCurrentUpload(upload) {
        this.currentUpload = upload;
    }
}

class FileManagerApp {
    constructor() {
        this.currentPath = '/';
        this.selectedFiles = new Set();
        this.viewMode = 'grid';
        this.sortBy = 'name';
        this.sortOrder = 'asc';
        this.searchOptions = {
            term: '',
            useRegex: false,
            caseSensitive: false,
            scope: 'current'
        };
        this.mediaPlayer = new MediaPlayer();
        this.imageViewer = new ImageViewer();
        this.router = new Router();
        this.searchHandler = new SearchHandler();
        this.editor = new FileEditor();
	this.progressManager = new ProgressManager();
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadFiles(this.currentPath);
        this.updateStorageInfo();
        
        this.router.onChange((path) => {
            this.navigateToPath(path);
        });
        
        const initialPath = this.router.getCurrentPath();
        if (initialPath && initialPath !== '/') {
            this.navigateToPath(initialPath);
        }
    }

    bindEvents() {
        document.addEventListener('click', (e) => {
            if (e.target.matches('.nav-item')) {
                e.preventDefault();
                const path = e.target.dataset.path;
                if (path) {
			this.navigateToPath(path);
                }
            }
            
            if (e.target.matches('.breadcrumb-item')) {
                e.preventDefault();
                const path = e.target.dataset.path;
                if (path) {
                    this.navigateToPath(path);
                }
            }
            
            if (e.target.matches('.file-item, .masonry-item') || e.target.closest('.file-item, .masonry-item')) {
                const fileItem = e.target.closest('.file-item, .masonry-item');
                if (fileItem) {
                    this.handleFileClick(fileItem);
                }
            }
            
            if (e.target.matches('.view-toggle-btn')) {
                this.setViewMode(e.target.dataset.view);
            }
            
            if (e.target.matches('.file-action-btn')) {
                const fileItem = e.target.closest('.file-item, .masonry-item');
                if (fileItem) {
                    const action = e.target.textContent;
                    if (action === '↓') {
                        this.downloadFile(fileItem.dataset.path);
                    } else if (action === '×') {
                        this.deleteFile(fileItem.dataset.path);
                    } else if (action === '✎') {
                        this.editFile(fileItem.dataset.path);
                    }
                }
            }
            
            if (e.target.matches('.toolbar-btn')) {
                const action = e.target.dataset.action;
                if (action === 'upload') {
                    this.showUploadDialog();
                } else if (action === 'new-folder') {
                    this.createNewFolder();
                } else if (action === 'new-file') {
                    this.createNewFile();
                } else if (action === 'download') {
                    this.downloadSelected();
                } else if (action === 'delete') {
                    this.deleteSelectedFiles();
                }
            }
        });

        document.addEventListener('dblclick', (e) => {
            if (e.target.matches('.file-item, .masonry-item') || e.target.closest('.file-item, .masonry-item')) {
                const fileItem = e.target.closest('.file-item, .masonry-item');
                if (fileItem) {
                    this.handleFileDoubleClick(fileItem);
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.selectedFiles.size > 0) {
                this.deleteSelectedFiles();
            } else if (e.key === 'ArrowLeft' && e.altKey) {
                this.navigateToParent();
            } else if (e.key === 'f' && e.ctrlKey) {
                e.preventDefault();
                document.querySelector('.search-input').focus();
            } else if (e.key === 'n' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                this.createNewFolder();
            } else if (e.key === 'n' && e.ctrlKey) {
                e.preventDefault();
                this.createNewFile();
            } else if (e.key === 'u' && e.ctrlKey) {
                e.preventDefault();
                this.showUploadDialog();
            }
        });

        const fileBrowser = document.querySelector('.file-browser');
        fileBrowser.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileBrowser.classList.add('dragover');
        });

        fileBrowser.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileBrowser.classList.remove('dragover');
        });

        fileBrowser.addEventListener('drop', (e) => {
            e.preventDefault();
            fileBrowser.classList.remove('dragover');
            this.handleFileDrop(e);
        });

        document.addEventListener('contextmenu', (e) => {
            if (e.target.matches('.file-item, .masonry-item') || e.target.closest('.file-item, .masonry-item')) {
                e.preventDefault();
                const fileItem = e.target.closest('.file-item, .masonry-item');
                if (fileItem) {
                    this.showContextMenu(e, fileItem);
                }
            } else if (e.target.matches('.file-browser')) {
                e.preventDefault();
                this.showBrowserContextMenu(e);
            }
        });

        document.addEventListener('click', () => {
            this.hideContextMenu();
        });
    }

    async loadFiles(path) {
        try {
            this.showLoading();
            
            const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const result = await response.json();
            
            if (result.success) {
                this.currentPath = path;
                this.displayFiles(result.data);
                this.updateBreadcrumb(path);
                this.router.updatePath(path);
                this.updateToolbar();
            } else {
                this.showToast('Error', result.message, 'error');
                // エラー時も空のファイルリストを表示
                this.displayFiles([]);
            }
        } catch (error) {
            this.showToast('Error', 'Failed to load files', 'error');
            console.error('Error loading files:', error);
            // エラー時も空のファイルリストを表示
            this.displayFiles([]);
        } finally {
            this.hideLoading();
        }
    }

    displayFiles(files) {
        const container = document.querySelector('.file-browser');
        if (!container) return;
        
        container.innerHTML = '';
        
        // filesがnullやundefinedの場合の処理
        if (!files) {
            files = [];
        }
        
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.innerHTML = `
            <button class="toolbar-btn" data-action="upload" title="Upload (Ctrl+U)">📤 Upload</button>
            <button class="toolbar-btn" data-action="new-folder" title="New Folder (Ctrl+Shift+N)">📁 New Folder</button>
            <button class="toolbar-btn" data-action="new-file" title="New File (Ctrl+N)">📄 New File</button>
            <button class="toolbar-btn" data-action="download" title="Download Selected" ${this.selectedFiles.size === 0 ? 'disabled' : ''}>📥 Download</button>
            <button class="toolbar-btn" data-action="delete" title="Delete Selected (Delete)" ${this.selectedFiles.size === 0 ? 'disabled' : ''}>🗑 Delete</button>
        `;
        container.appendChild(toolbar);
        
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.innerHTML = `
            <div class="upload-text">📁 Drop files here to upload</div>
            <div class="upload-text">or click to select files</div>
            <input type="file" class="upload-input" multiple>
        `;
        container.appendChild(uploadArea);
        
        uploadArea.querySelector('.upload-input').addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files);
        });
        
        uploadArea.addEventListener('click', () => {
            uploadArea.querySelector('.upload-input').click();
        });
    
        if (files.length === 0) {
            const noFiles = document.createElement('div');
            noFiles.className = 'no-files';
            noFiles.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                    <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">📁</div>
                    <div style="font-size: 1.2rem; margin-bottom: 10px;">No files found</div>
                    <div style="font-size: 0.9rem; opacity: 0.8;">Upload files or create new ones to get started</div>
                </div>
            `;
            container.appendChild(noFiles);
            return;
        }
        
        const imageCount = files.filter(file => 
            file.mime_type && file.mime_type.startsWith('image/')
        ).length;
        
        if (imageCount >= 10 && this.viewMode !== 'list') {
            this.viewMode = 'masonry';
            this.renderMasonryView(files);
        } else {
            this.renderStandardView(files);
        }
    }

    renderStandardView(files) {
        const container = document.querySelector('.file-browser');
        
        const viewToggle = document.createElement('div');
        viewToggle.className = 'view-toggle';
        viewToggle.innerHTML = `
            <button class="view-toggle-btn ${this.viewMode === 'grid' ? 'active' : ''}" data-view="grid">Grid</button>
            <button class="view-toggle-btn ${this.viewMode === 'list' ? 'active' : ''}" data-view="list">List</button>
        `;
        container.appendChild(viewToggle);
        
        const fileContainer = document.createElement('div');
        fileContainer.className = this.viewMode === 'list' ? 'table-view-container' : 'file-grid';
        
        if (this.viewMode === 'list') {
            this.renderListView(files, fileContainer);
        } else {
            this.renderGridView(files, fileContainer);
        }
        
        container.appendChild(fileContainer);
    }

    renderGridView(files, container) {
        files.forEach(file => {
            const fileItem = this.createFileItem(file);
            container.appendChild(fileItem);
        });
    }

    renderListView(files, container) {
        const table = document.createElement('table');
        table.className = 'table-view';
        
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th data-sort="name">Name</th>
                <th data-sort="size">Size</th>
                <th data-sort="mod_time">Modified</th>
                <th>Type</th>
                <th>Actions</th>
            </tr>
        `;
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        files.forEach(file => {
            const tr = document.createElement('tr');
            tr.className = 'file-item';
            tr.dataset.path = file.path;
            tr.dataset.isDir = file.is_dir;
            tr.dataset.mimeType = file.mime_type || '';
            
            tr.innerHTML = `
                <td>
                    <div class="file-icon ${this.getFileIconClass(file)}"></div>
                    <span class="file-name">${file.name}</span>
                </td>
                <td>${file.is_dir ? '-' : this.formatFileSize(file.size)}</td>
                <td>${new Date(file.mod_time).toLocaleString()}</td>
                <td>${file.is_dir ? 'Folder' : (file.mime_type || 'Unknown')}</td>
                <td>
                    ${!file.is_dir ? `
                        <button class="file-action-btn" title="Download">↓</button>
                        ${file.is_editable ? '<button class="file-action-btn" title="Edit">✎</button>' : ''}
                        <button class="file-action-btn" title="Delete">×</button>
                    ` : ''}
                </td>
            `;
            
            tbody.appendChild(tr);
        });
        
        table.appendChild(tbody);
        container.appendChild(table);
    }

    renderMasonryView(files) {
        const container = document.querySelector('.file-browser');
        
        const imageFiles = files.filter(file => 
            file.mime_type && file.mime_type.startsWith('image/')
        );
        
        const otherFiles = files.filter(file => 
            !file.mime_type || !file.mime_type.startsWith('image/')
        );
        
        const viewToggle = document.createElement('div');
        viewToggle.className = 'view-toggle';
        viewToggle.innerHTML = `
            <button class="view-toggle-btn" data-view="grid">Grid</button>
            <button class="view-toggle-btn" data-view="list">List</button>
            <button class="view-toggle-btn active" data-view="masonry">Masonry</button>
        `;
        container.appendChild(viewToggle);
        
        if (imageFiles.length > 0) {
            const masonryTitle = document.createElement('h3');
            masonryTitle.textContent = 'Images';
            masonryTitle.style.margin = '20px 0 10px';
            masonryTitle.style.color = 'var(--accent-primary)';
            container.appendChild(masonryTitle);
            
            const masonryGrid = document.createElement('div');
            masonryGrid.className = 'masonry-grid';
            
            imageFiles.forEach(file => {
                const masonryItem = this.createMasonryItem(file);
                masonryGrid.appendChild(masonryItem);
            });
            
            container.appendChild(masonryGrid);
        }
        
        if (otherFiles.length > 0) {
            const otherTitle = document.createElement('h3');
            otherTitle.textContent = 'Other Files';
            otherTitle.style.margin = '30px 0 10px';
            otherTitle.style.color = 'var(--accent-primary)';
            container.appendChild(otherTitle);
            
            const fileGrid = document.createElement('div');
            fileGrid.className = 'file-grid';
            
            otherFiles.forEach(file => {
                const fileItem = this.createFileItem(file);
                fileGrid.appendChild(fileItem);
            });
            
            container.appendChild(fileGrid);
        }
    }

    createFileItem(file) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.path = file.path;
        fileItem.dataset.isDir = file.is_dir;
        fileItem.dataset.mimeType = file.mime_type || '';
        fileItem.dataset.isEditable = file.is_editable || false;
        fileItem.dataset.isMount = file.is_mount || false;
        
        const iconClass = this.getFileIconClass(file);
        
        fileItem.innerHTML = `
            <div class="file-icon ${iconClass}"></div>
            <div class="file-name">${file.name}</div>
            <div class="file-info">
                ${file.is_dir ? 'Folder' : this.formatFileSize(file.size)}
            </div>
            <div class="file-actions">
                ${!file.is_dir ? `
                    <button class="file-action-btn" title="Download">↓</button>
                    ${file.is_editable ? '<button class="file-action-btn" title="Edit">✎</button>' : ''}
                    <button class="file-action-btn" title="Delete">×</button>
                ` : ''}
            </div>
        `;
        
        return fileItem;
    }

    createMasonryItem(file) {
        const item = document.createElement('div');
        item.className = 'masonry-item';
        item.dataset.path = file.path;
        item.dataset.isDir = file.is_dir;
        item.dataset.mimeType = file.mime_type || '';
        
        item.style.gridRowEnd = 'span 20';
        
        item.innerHTML = `
            <img src="/api/files/content?path=${encodeURIComponent(file.path)}" 
                 alt="${file.name}" 
                 class="masonry-image"
                 onload="this.closest('.masonry-item').style.gridRowEnd = 'span ' + Math.round((this.naturalHeight / this.naturalWidth) * 20)"
                 onerror="this.style.display='none'">
            <div class="masonry-info">
                <div class="masonry-name">${file.name}</div>
                <div class="masonry-size">${this.formatFileSize(file.size)}</div>
            </div>
            <div class="file-actions">
                <button class="file-action-btn" title="Download">↓</button>
                <button class="file-action-btn" title="Delete">×</button>
            </div>
        `;
        
        return item;
    }

    getFileIconClass(file) {
        if (file.is_dir) return 'folder';
        if (file.is_mount) return 'mount';
        
        const mime = file.mime_type || '';
        
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('text/') || file.is_editable) return 'document';
        
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz'];
        const codeExts = ['js', 'py', 'java', 'c', 'cpp', 'html', 'css', 'php', 'rb', 'go'];
        
        if (archiveExts.includes(ext)) return 'archive';
        if (codeExts.includes(ext)) return 'code';
        
        return 'file';
    }

    getFileIconClass(file) {
        if (file.is_dir) return 'folder';
        if (file.is_mount) return 'mount';
        
        const mime = file.mime_type || '';
        const name = file.name || '';
        const ext = name.split('.').pop().toLowerCase();
        
        // MIMEタイプに基づく判定
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('text/') || file.is_editable) return 'document';
        
        // 特定のMIMEタイプ
        if (mime.includes('javascript')) return 'code';
        if (mime.includes('python')) return 'code';
        if (mime.includes('java')) return 'code';
        if (mime.includes('c+')) return 'code';
        if (mime.includes('html')) return 'code';
        if (mime.includes('css')) return 'code';
        if (mime.includes('php')) return 'code';
        if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || mime.includes('tar') || mime.includes('gz')) return 'archive';
        
        // 拡張子に基づくフォールバック
        const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];
        const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'html', 'htm', 'css', 'scss', 'less', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'];
        const textExts = ['txt', 'md', 'markdown', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg', 'log'];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
        const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
        
        if (archiveExts.includes(ext)) return 'archive';
        if (codeExts.includes(ext)) return 'code';
        if (textExts.includes(ext)) return 'document';
        if (imageExts.includes(ext)) return 'image';
        if (videoExts.includes(ext)) return 'video';
        if (audioExts.includes(ext)) return 'audio';
        
        return 'file';
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    handleFileClick(fileItem) {
        const path = fileItem.dataset.path;
        const isSelected = this.selectedFiles.has(path);
        
        if (!event.ctrlKey && !event.metaKey) {
            this.clearSelection();
        }
        
        if (isSelected) {
            this.selectedFiles.delete(path);
            fileItem.classList.remove('selected');
        } else {
            this.selectedFiles.add(path);
            fileItem.classList.add('selected');
        }
        
        this.updateToolbar();
    }

    handleFileDoubleClick(fileItem) {
        const path = fileItem.dataset.path;
        const isDir = fileItem.dataset.isDir === 'true';
        const mimeType = fileItem.dataset.mimeType || '';
        
        if (isDir) {
            this.navigateToPath(path);
        } else {
            this.openFile(path, mimeType);
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
        } else if (mimeType && (mimeType.startsWith('text/') || this.isEditableFile(path))) {
            this.editFile(path);
        } else {
            window.open(`/api/files/download?path=${encodeURIComponent(path)}`, '_blank');
        }
    }

    isEditableFile(path) {
        const ext = path.split('.').pop().toLowerCase();
        const editableExts = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'py', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'bat', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env'];
        return editableExts.includes(ext);
    }

    async editFile(path) {
        try {
            this.showLoading();
            
            const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
            const result = await response.json();
            
            if (result.success) {
                this.editor.open(path, result.data.content);
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to load file for editing', 'error');
            console.error('Error loading file:', error);
        } finally {
            this.hideLoading();
        }
    }

    navigateToPath(path) {
        this.currentPath = path;
        this.loadFiles(path);
        this.clearSelection();
    }

    navigateToParent() {
        if (this.currentPath === '/') return;
        
        const parentPath = this.currentPath.split('/').slice(0, -1).join('/') || '/';
        this.navigateToPath(parentPath);
    }

    updateBreadcrumb(path) {
        const breadcrumb = document.querySelector('.breadcrumb');
        breadcrumb.innerHTML = '';
        
        const parts = path.split('/').filter(part => part !== '');
        let currentPath = '';
        
        const rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-item';
        rootItem.textContent = 'Root';
        rootItem.dataset.path = '/';
        breadcrumb.appendChild(rootItem);
        
        parts.forEach((part, index) => {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = '/';
            breadcrumb.appendChild(separator);
            
            currentPath += '/' + part;
            
            const item = document.createElement('span');
            item.className = 'breadcrumb-item';
            item.textContent = part;
            item.dataset.path = currentPath;
            breadcrumb.appendChild(item);
        });
    }

    updateToolbar() {
        const downloadBtn = document.querySelector('[data-action="download"]');
        const deleteBtn = document.querySelector('[data-action="delete"]');
        
        if (downloadBtn && deleteBtn) {
            downloadBtn.disabled = this.selectedFiles.size === 0;
            deleteBtn.disabled = this.selectedFiles.size === 0;
        }
    }

    clearSelection() {
        document.querySelectorAll('.file-item.selected, .masonry-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
        this.selectedFiles.clear();
        this.updateToolbar();
    }

    setViewMode(mode) {
        this.viewMode = mode;
        this.loadFiles(this.currentPath);
    }

    showContextMenu(e, fileItem) {
        this.hideContextMenu();
        
        const contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu';
        contextMenu.style.left = e.pageX + 'px';
        contextMenu.style.top = e.pageY + 'px';
        
        const path = fileItem.dataset.path;
        const isDir = fileItem.dataset.isDir === 'true';
        const mimeType = fileItem.dataset.mimeType || '';
        
        contextMenu.innerHTML = `
            <div class="context-menu-item" data-action="download">
                <span>📥 Download</span>
            </div>
            ${!isDir && this.isEditableFile(path) ? `
                <div class="context-menu-item" data-action="edit">
                    <span>✎ Edit</span>
                </div>
            ` : ''}
            <div class="context-menu-item" data-action="rename">
                <span>📝 Rename</span>
            </div>
            <div class="context-menu-item" data-action="move">
                <span>↗️ Move</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="delete">
                <span>🗑️ Delete</span>
            </div>
        `;
        
        document.body.appendChild(contextMenu);
        
        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                this.handleContextMenuAction(action, path, isDir, mimeType);
                this.hideContextMenu();
            });
        });
        
        this.currentContextMenu = contextMenu;
    }

    showBrowserContextMenu(e) {
        this.hideContextMenu();
        
        const contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu';
        contextMenu.style.left = e.pageX + 'px';
        contextMenu.style.top = e.pageY + 'px';
        
        contextMenu.innerHTML = `
            <div class="context-menu-item" data-action="new-folder">
                <span>📁 New Folder</span>
            </div>
            <div class="context-menu-item" data-action="new-file">
                <span>📄 New File</span>
            </div>
            <div class="context-menu-item" data-action="upload">
                <span>📤 Upload</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="refresh">
                <span>🔄 Refresh</span>
            </div>
        `;
        
        document.body.appendChild(contextMenu);
        
        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                this.handleBrowserContextMenuAction(action);
                this.hideContextMenu();
            });
        });
        
        this.currentContextMenu = contextMenu;
    }

    hideContextMenu() {
        if (this.currentContextMenu) {
            this.currentContextMenu.remove();
            this.currentContextMenu = null;
        }
    }

    handleContextMenuAction(action, path, isDir, mimeType) {
        switch (action) {
            case 'download':
                this.downloadFile(path);
                break;
            case 'edit':
                this.editFile(path);
                break;
            case 'rename':
                this.renameFile(path);
                break;
            case 'move':
                this.moveFile(path);
                break;
            case 'delete':
                this.deleteFile(path);
                break;
        }
    }

    handleBrowserContextMenuAction(action) {
        switch (action) {
            case 'new-folder':
                this.createNewFolder();
                break;
            case 'new-file':
                this.createNewFile();
                break;
            case 'upload':
                this.showUploadDialog();
                break;
            case 'refresh':
                this.loadFiles(this.currentPath);
                break;
        }
    }

    async renameFile(path) {
        const newName = prompt('Enter new name:', path.split('/').pop());
        if (!newName) return;
        
        const newPath = path.split('/').slice(0, -1).join('/') + '/' + newName;
        
        try {
            const response = await fetch('/api/files/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: path,
                    targetPath: newPath
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'File renamed successfully', 'success');
                this.loadFiles(this.currentPath);
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to rename file', 'error');
            console.error('Error renaming file:', error);
        }
    }

    async moveFile(path) {
        const targetPath = prompt('Enter target path:', this.currentPath);
        if (!targetPath) return;
        
        const newPath = targetPath + '/' + path.split('/').pop();
        
        try {
            const response = await fetch('/api/files/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: path,
                    targetPath: newPath
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'File moved successfully', 'success');
                this.loadFiles(this.currentPath);
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to move file', 'error');
            console.error('Error moving file:', error);
        }
    }

    async createNewFolder() {
        const folderName = prompt('Enter folder name:');
        if (!folderName) return;
        
        try {
            const response = await fetch('/api/files/mkdir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.currentPath,
                    name: folderName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'Folder created successfully', 'success');
                this.loadFiles(this.currentPath);
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to create folder', 'error');
            console.error('Error creating folder:', error);
        }
    }

    async createNewFile() {
        const fileName = prompt('Enter file name (default: .md):');
        if (!fileName) return;
        
        try {
            const response = await fetch('/api/files/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.currentPath,
                    name: fileName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'File created successfully', 'success');
                this.loadFiles(this.currentPath);
                
                if (this.isEditableFile(result.data.path)) {
                    setTimeout(() => {
                        this.editFile(result.data.path);
                    }, 500);
                }
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to create file', 'error');
            console.error('Error creating file:', error);
        }
    }

    showUploadDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files);
            // 入力欄をリセット
            e.target.value = '';
        });
        input.click();
    }

    async handleFileUpload(files) {
        if (!files || files.length === 0) return;
        
        try {
            // プログレスバーを表示
            this.progressManager.show('Uploading Files');
            this.progressManager.updateProgress({
                currentFile: 'Preparing upload...',
                percentage: 0,
                processed: 0,
                total: files.length,
                status: `0/${files.length} files`
            });
            
            // アップロードエリアを無効化
            const uploadArea = document.querySelector('.upload-area');
            if (uploadArea) {
                uploadArea.classList.add('uploading');
            }
            
            const formData = new FormData();
            formData.append('path', this.currentPath);
            
            for (let i = 0; i < files.length; i++) {
                formData.append('file', files[i]);
            }
            
            // XMLHttpRequest を使用して進捗を追跡
            const xhr = new XMLHttpRequest();
            
            // 進捗イベントの監視
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentage = (e.loaded / e.total) * 100;
                    this.progressManager.updateProgress({
                        currentFile: `Uploading ${files.length} files...`,
                        percentage: percentage,
                        processed: Math.floor((percentage / 100) * files.length),
                        total: files.length,
                        status: `${Math.round(percentage)}% complete`
                    });
                }
            });
            
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        const successMessage = `Uploaded ${response.successful} file(s) successfully`;
                        
                        if (response.failed_count > 0) {
                            this.showToast('Upload Complete', 
                                `${successMessage}, ${response.failed_count} failed`, 
                                'warning');
                        } else {
                            this.showToast('Success', successMessage, 'success');
                        }
                        this.loadFiles(this.currentPath);
                        
                        // 完了状態を表示
                        this.progressManager.updateProgress({
                            currentFile: 'Upload complete!',
                            percentage: 100,
                            processed: response.successful,
                            total: files.length,
                            status: `Completed: ${response.successful} successful, ${response.failed_count} failed`
                        });
                        
                    } catch (error) {
                        this.showToast('Error', 'Failed to parse response', 'error');
                    }
                } else {
                    this.showToast('Error', 'Upload failed', 'error');
                }
            });
            
            xhr.addEventListener('error', () => {
                this.showToast('Error', 'Network error occurred', 'error');
            });
            
            xhr.addEventListener('abort', () => {
                this.showToast('Info', 'Upload cancelled', 'info');
            });
            
            xhr.open('POST', '/api/files/upload');
            
            // 進行中のアップロードを追跡
            this.progressManager.setCurrentUpload(xhr);
            
            // アップロード開始
            this.progressManager.updateProgress({
                currentFile: 'Starting upload...',
                percentage: 0,
                processed: 0,
                total: files.length,
                status: 'Connecting to server'
            });
            
            xhr.send(formData);
            
            // アップロードが完了するまで待機
            await new Promise((resolve, reject) => {
                xhr.addEventListener('load', resolve);
                xhr.addEventListener('error', reject);
                xhr.addEventListener('abort', resolve);
            });
            
        } catch (error) {
            this.showToast('Error', 'Failed to upload files', 'error');
            console.error('Error uploading files:', error);
        } finally {
            setTimeout(() => {
                this.progressManager.hide();
                const uploadArea = document.querySelector('.upload-area');
                if (uploadArea) {
                    uploadArea.classList.remove('uploading');
                }
            }, 1000);
        }
    }

    async uploadSingleFile(formData, progressContainer, index, total) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/files/upload', true);
    
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    const overall = Math.round(((index + percent / 100) / total) * 100);
    
                    progressContainer.querySelector('.upload-progress-bar').style.width = overall + '%';
                    progressContainer.querySelector('.upload-progress-text').textContent = overall + '%';
                }
            };
    
            xhr.onload = () => {
                if (xhr.status === 200) resolve();
                else reject(new Error(xhr.statusText));
            };
    
            xhr.onerror = () => reject(new Error('Upload failed'));
            xhr.send(formData);
        });
    }

    handleFileDrop(e) {
        e.preventDefault();
        const uploadArea = document.querySelector('.upload-area');
        if (uploadArea) {
            uploadArea.classList.remove('dragover');
        }
        
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            this.handleFileUpload(files);
        }
    }

    async downloadSelected() {
        if (this.selectedFiles.size === 0) return;
        
        if (this.selectedFiles.size === 1) {
            // 単一ファイルのダウンロード
            const path = Array.from(this.selectedFiles)[0];
            this.downloadFile(path);
        } else {
            // 複数ファイルのZIPダウンロード
            try {
                this.progressManager.show('Preparing Download');
                this.progressManager.updateProgress({
                    currentFile: 'Creating archive...',
                    percentage: 0,
                    processed: 0,
                    total: this.selectedFiles.size,
                    status: 'Initializing'
                });
                
                const response = await fetch('/api/files/download-zip', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        paths: Array.from(this.selectedFiles)
                    })
                });
                
                if (response.ok) {
                    const contentLength = response.headers.get('content-length');
                    let loaded = 0;
                    
                    // ストリーミングでダウンロード進捗を追跡
                    const reader = response.body.getReader();
                    const chunks = [];
                    let receivedLength = 0;
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        
                        if (done) {
                            break;
                        }
                        
                        chunks.push(value);
                        receivedLength += value.length;
                        
                        // 進捗更新
                        if (contentLength) {
                            const percentage = (receivedLength / parseInt(contentLength)) * 100;
                            this.progressManager.updateProgress({
                                currentFile: 'Downloading archive...',
                                percentage: percentage,
                                processed: Math.floor((percentage / 100) * this.selectedFiles.size),
                                total: this.selectedFiles.size,
                                status: `${Math.round(percentage)}% downloaded`
                            });
                        }
                    }
                    
                    // すべてのチャンクを結合
                    const blob = new Blob(chunks);
                    
                    this.progressManager.updateProgress({
                        currentFile: 'Saving files...',
                        percentage: 100,
                        processed: this.selectedFiles.size,
                        total: this.selectedFiles.size,
                        status: 'Complete'
                    });
                    
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'files.zip';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    
                    this.showToast('Success', `Downloaded ${this.selectedFiles.size} files successfully`, 'success');
                } else {
                    this.showToast('Error', 'Failed to download files', 'error');
                }
            } catch (error) {
                this.showToast('Error', 'Failed to download files', 'error');
                console.error('Error downloading files:', error);
            } finally {
                setTimeout(() => {
                    this.progressManager.hide();
                }, 1000);
            }
        }
    }
    
    downloadFile(path) {
        window.open(`/api/files/download?path=${encodeURIComponent(path)}`, '_blank');
    }

    async deleteFile(path) {
        if (!confirm(`Delete "${path.split('/').pop()}"? This action cannot be undone.`)) {
            return;
        }
        
        try {
            const response = await fetch('/api/files/batch-delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    paths: [path]
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'File deleted successfully', 'success');
                this.loadFiles(this.currentPath);
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to delete file', 'error');
            console.error('Error deleting file:', error);
        }
    }

    async deleteSelectedFiles() {
        if (this.selectedFiles.size === 0) return;
        
        if (!confirm(`Delete ${this.selectedFiles.size} item(s)? This action cannot be undone.`)) {
            return;
        }
        
        try {
            const response = await fetch('/api/files/batch-delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    paths: Array.from(this.selectedFiles)
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'Files deleted successfully', 'success');
                this.loadFiles(this.currentPath);
                this.clearSelection();
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to delete files', 'error');
            console.error('Error deleting files:', error);
        }
    }

    async updateStorageInfo() {
        try {
            const response = await fetch('/api/storage-info');
            const result = await response.json();
            
            if (result.success) {
                const total = result.data.total;
                const used = result.data.used;
                const percent = result.data.usage_percent;
                
                document.querySelector('.storage-text').textContent = 
                    `Used: ${this.formatFileSize(used)} / ${this.formatFileSize(total)}`;
                
                document.querySelector('.storage-progress-inner').style.width = `${percent}%`;
            }
        } catch (error) {
            console.error('Error fetching storage info:', error);
        }
    }

    showLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showToast(title, message, type = 'info') {
        const toastContainer = document.querySelector('.toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close">&times;</button>
        `;
        
        toastContainer.appendChild(toast);
        
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);
    }
}

class FileEditor {
    constructor() {
        this.currentFile = null;
        this.init();
    }
    
    init() {
        this.createEditorElement();
    }
    
    createEditorElement() {
        const editor = document.createElement('div');
        editor.className = 'modal-overlay editor-modal';
        editor.style.display = 'none';
        
        editor.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="editor-header">
                        <div class="editor-filename"></div>
                        <div class="editor-actions">
                            <button class="btn" id="editor-cancel">Cancel</button>
                            <button class="btn btn-primary" id="editor-save">Save</button>
                        </div>
                    </div>
                </div>
                <div class="modal-body">
                    <div class="editor-container">
                        <textarea class="editor-textarea" placeholder="File content..."></textarea>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(editor);
        this.editorElement = editor;
        this.textarea = editor.querySelector('.editor-textarea');
        this.filenameElement = editor.querySelector('.editor-filename');
        
        editor.querySelector('#editor-cancel').addEventListener('click', () => {
            this.close();
        });
        
        editor.querySelector('#editor-save').addEventListener('click', () => {
            this.save();
        });
        
        this.textarea.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.save();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }
    
    open(filePath, content) {
        this.currentFile = filePath;
        this.filenameElement.textContent = filePath.split('/').pop();
        this.textarea.value = content;
        this.editorElement.style.display = 'flex';
        this.textarea.focus();
        
        document.body.style.overflow = 'hidden';
    }
    
    close() {
        this.editorElement.style.display = 'none';
        this.currentFile = null;
        document.body.style.overflow = '';
    }
    
    async save() {
        if (!this.currentFile) return;
        
        const content = this.textarea.value;
        
        try {
            const response = await fetch('/api/files/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.currentFile,
                    content: content
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'File saved successfully', 'success');
                this.close();
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to save file', 'error');
            console.error('Error saving file:', error);
        }
    }
    
    showToast(title, message, type) {
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.padding = '10px 15px';
        toast.style.background = type === 'success' ? 'var(--success)' : 'var(--error)';
        toast.style.color = 'white';
        toast.style.borderRadius = '4px';
        toast.style.zIndex = '1000';
        toast.textContent = `${title}: ${message}`;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.fileManager = new FileManagerApp();
    window.fileEditor = new FileEditor();
});
