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
        
        this.bindEvents();
    }

    bindEvents() {
        this.editorElement.querySelector('#editor-cancel').addEventListener('click', () => {
            this.close();
        });
        
        this.editorElement.querySelector('#editor-save').addEventListener('click', () => {
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
        // Use the parent FileManagerApp's showToast if available
        if (window.fileManager && window.fileManager.showToast) {
            window.fileManager.showToast(title, message, type);
            return;
        }
        
        // Fallback toast implementation
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
        this.currentContextMenu = null;
        
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
        document.addEventListener('click', (e) => this.handleClick(e));
        document.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
        document.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        document.addEventListener('click', () => this.hideContextMenu());

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
                this.navigateToPath(path);
            }
            return;
        }
        
        // Breadcrumb clicks
        if (e.target.matches('.breadcrumb-item')) {
            e.preventDefault();
            const path = e.target.dataset.path;
            if (path) {
                this.navigateToPath(path);
            }
            return;
        }
        
        // File item clicks
        if (e.target.matches('.file-item, .masonry-item') || e.target.closest('.file-item, .masonry-item')) {
            const fileItem = e.target.closest('.file-item, .masonry-item');
            if (fileItem) {
                this.handleFileClick(fileItem);
            }
            return;
        }
        
        // View toggle buttons
        if (e.target.matches('.view-toggle-btn')) {
            this.setViewMode(e.target.dataset.view);
            return;
        }
        
        // File action buttons
        if (e.target.matches('.file-action-btn')) {
            const fileItem = e.target.closest('.file-item, .masonry-item');
            if (fileItem) {
                this.handleFileActionClick(e.target, fileItem);
            }
            return;
        }
        
        // Toolbar buttons
        if (e.target.matches('.toolbar-btn')) {
            this.handleToolbarClick(e.target);
            return;
        }
    }

    handleFileActionClick(button, fileItem) {
        const action = button.textContent.trim();
        const path = fileItem.dataset.path;
        
        switch (action) {
            case '↓':
                this.downloadFile(path);
                break;
            case '×':
                this.deleteFile(path);
                break;
            case '✎':
                this.editFile(path);
                break;
        }
    }

    handleToolbarClick(button) {
        const action = button.dataset.action;
        
        switch (action) {
            case 'upload':
                this.showUploadDialog();
                break;
            case 'new-folder':
                this.createNewFolder();
                break;
            case 'new-file':
                this.createNewFile();
                break;
            case 'download':
                this.downloadSelected();
                break;
            case 'move':
                this.moveSelected();
                break;
            case 'delete':
                this.deleteSelectedFiles();
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
            'Delete': () => this.selectedFiles.size > 0 && this.deleteSelectedFiles(),
            'ArrowLeft': () => e.altKey && this.navigateToParent(),
            'f': () => e.ctrlKey && (e.preventDefault(), document.querySelector('.search-input')?.focus()),
            'n': () => {
                if (e.ctrlKey) {
                    e.preventDefault();
                    e.shiftKey ? this.createNewFolder() : this.createNewFile();
                }
            },
            'u': () => e.ctrlKey && (e.preventDefault(), this.showUploadDialog())
        };

        const action = keyActions[e.key];
        if (action) {
            action();
        }
    }

    handleContextMenu(e) {
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
    }

    bindDragDropEvents(fileBrowser) {
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
                this.displayFiles([]);
            }
        } catch (error) {
            this.showToast('Error', 'Failed to load files', 'error');
            console.error('Error loading files:', error);
            this.displayFiles([]);
        } finally {
            this.hideLoading();
        }
    }

    displayFiles(files) {
        const container = document.querySelector('.file-browser');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!files) {
            files = [];
        }
        
        this.renderToolbar(container);
        this.renderUploadArea(container);
    
        if (files.length === 0) {
            this.renderEmptyState(container);
            return;
        }
        
        const imageCount = files.filter(file => 
            file.mime_type && file.mime_type.startsWith('image/')
        ).length;
        
        if (imageCount >= 10 && this.viewMode !== 'list') {
            this.viewMode = 'masonry';
            this.renderMasonryView(files, container);
        } else {
            this.renderStandardView(files, container);
        }
    }

    renderToolbar(container) {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.innerHTML = `
            <button class="toolbar-btn" data-action="upload" title="Upload (Ctrl+U)">📤 Upload</button>
            <button class="toolbar-btn" data-action="new-folder" title="New Folder (Ctrl+Shift+N)">📁 New Folder</button>
            <button class="toolbar-btn" data-action="new-file" title="New File (Ctrl+N)">📄 New File</button>
            <button class="toolbar-btn" data-action="download" title="Download Selected" ${this.selectedFiles.size === 0 ? 'disabled' : ''}>📥 Download</button>
            <button class="toolbar-btn" data-action="move" title="Move Selected" ${this.selectedFiles.size === 0 ? 'disabled' : ''}>↗️ Move</button>
            <button class="toolbar-btn" data-action="delete" title="Delete Selected (Delete)" ${this.selectedFiles.size === 0 ? 'disabled' : ''}>🗑️ Delete</button>
        `;
        container.appendChild(toolbar);
    }

    renderUploadArea(container) {
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.innerHTML = `
            <div class="upload-text">📁 Drop files here to upload</div>
            <div class="upload-text">or click to select files</div>
            <input type="file" class="upload-input" multiple>
        `;
        container.appendChild(uploadArea);
        
        const uploadInput = uploadArea.querySelector('.upload-input');
        uploadInput.addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files);
        });
        
        uploadArea.addEventListener('click', () => {
            uploadInput.click();
        });
    }

    renderEmptyState(container) {
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
    }

    renderStandardView(files, container) {
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
            const tr = this.createTableRow(file);
            tbody.appendChild(tr);
        });
        
        table.appendChild(tbody);
        container.appendChild(table);
    }

    createTableRow(file) {
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
        
        return tr;
    }

    renderMasonryView(files, container) {
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
            this.renderImageSection(imageFiles, container);
        }
        
        if (otherFiles.length > 0) {
            this.renderOtherFilesSection(otherFiles, container);
        }
    }

    renderImageSection(imageFiles, container) {
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

    renderOtherFilesSection(otherFiles, container) {
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

    createFileItem(file) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        this.setFileItemData(fileItem, file);
        
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
        this.setFileItemData(item, file);
        
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

    setFileItemData(element, file) {
        element.dataset.path = file.path;
        element.dataset.isDir = file.is_dir;
        element.dataset.mimeType = file.mime_type || '';
        element.dataset.isEditable = file.is_editable || false;
        element.dataset.isMount = file.is_mount || false;
    }

    getFileIconClass(file) {
        if (file.is_dir) return 'folder';
        if (file.is_mount) return 'mount';
        
        const mime = file.mime_type || '';
        const name = file.name || '';
        const ext = name.split('.').pop()?.toLowerCase() || '';
        
        // MIME type based detection
        const mimeMap = {
            'image/': 'image',
            'video/': 'video',
            'audio/': 'audio',
            'text/': 'document',
            'javascript': 'code',
            'python': 'code',
            'java': 'code',
            'c+': 'code',
            'html': 'code',
            'css': 'code',
            'php': 'code',
            'zip': 'archive',
            'rar': 'archive',
            '7z': 'archive',
            'tar': 'archive',
            'gz': 'archive'
        };
        
        for (const [key, value] of Object.entries(mimeMap)) {
            if (mime.includes(key) || (key.length > 10 && mime.startsWith(key))) {
                return value;
            }
        }
        
        if (file.is_editable) return 'document';
        
        // Extension based fallback
        const extMap = {
            archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
            code: ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'html', 'htm', 'css', 'scss', 'less', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'],
            document: ['txt', 'md', 'markdown', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg', 'log'],
            image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'],
            video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
            audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']
        };
        
        for (const [type, extensions] of Object.entries(extMap)) {
            if (extensions.includes(ext)) {
                return type;
            }
        }
        
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
        if (!breadcrumb) return;
        
        breadcrumb.innerHTML = '';
        
        const parts = path.split('/').filter(part => part !== '');
        let currentPath = '';
        
        const rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-item';
        rootItem.textContent = 'Root';
        rootItem.dataset.path = '/';
        breadcrumb.appendChild(rootItem);
        
        parts.forEach((part) => {
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
        const moveBtn = document.querySelector('[data-action="move"]');
        const deleteBtn = document.querySelector('[data-action="delete"]');
        
        if (downloadBtn && moveBtn && deleteBtn) {
            const hasSelection = this.selectedFiles.size > 0;
            downloadBtn.disabled = !hasSelection;
            moveBtn.disabled = !hasSelection;
            deleteBtn.disabled = !hasSelection;
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
                <span>↗ Move</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="delete">
                <span>🗑 Delete</span>
            </div>
        `;
        
        document.body.appendChild(contextMenu);
        
        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                this.handleContextMenuAction(action, path, isDir);
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

    handleContextMenuAction(action, path, isDir) {
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

    // Utility methods
    isValidPath(path) {
        return path && path.length > 0 && !path.includes('..');
    }
    
    suggestMoveTarget(sourcePath) {
        const parentPath = this.getParentPath(sourcePath);
        return this.currentPath !== '/' ? this.currentPath : parentPath;
    }

    getParentPath(path) {
        const parts = path.split('/').filter(part => part !== '');
        if (parts.length <= 1) return '/';
        parts.pop();
        return '/' + parts.join('/');
    }

    // File operations
    async renameFile(path) {
        const newName = prompt('Enter new name:', path.split('/').pop());
        if (!newName) return;
        
        const newPath = this.getParentPath(path) + '/' + newName;
        
        try {
            this.showLoading();
            
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
        } finally {
            this.hideLoading();
        }
    }

    async moveFile(sourcePath) {
        const fileName = sourcePath.split('/').pop();
        const suggestedPath = this.suggestMoveTarget(sourcePath);
        
        const targetDir = prompt(`Move "${fileName}" to directory:`, suggestedPath);
        if (!targetDir) return;
        
        if (!this.isValidPath(targetDir)) {
            this.showToast('Error', 'Invalid target path', 'error');
            return;
        }
        
        const targetPath = targetDir.endsWith('/') ? 
            targetDir + fileName : 
            targetDir + '/' + fileName;
        
        if (sourcePath === targetPath) {
            this.showToast('Info', 'Source and target are the same', 'info');
            return;
        }
        
        try {
            this.showLoading();
            
            const response = await fetch('/api/files/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: sourcePath,
                    targetPath: targetPath
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', `Moved "${fileName}" successfully`, 'success');
                this.loadFiles(this.currentPath);
            } else {
                this.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to move file', 'error');
            console.error('Error moving file:', error);
        } finally {
            this.hideLoading();
        }
    }

    async moveSelected() {
        if (this.selectedFiles.size === 0) return;
        
        if (this.selectedFiles.size === 1) {
            const path = Array.from(this.selectedFiles)[0];
            this.moveFile(path);
        } else {
            await this.moveMultipleFiles();
        }
    }

    async moveMultipleFiles() {
        const firstFile = Array.from(this.selectedFiles)[0];
        const suggestedPath = this.suggestMoveTarget(firstFile);
        
        const targetDir = prompt(`Move ${this.selectedFiles.size} items to directory:`, suggestedPath);
        if (!targetDir) return;
        
        if (!this.isValidPath(targetDir)) {
            this.showToast('Error', 'Invalid target path', 'error');
            return;
        }
        
        try {
            this.showLoading();
            let successCount = 0;
            let failCount = 0;
            
            for (const sourcePath of this.selectedFiles) {
                const fileName = sourcePath.split('/').pop();
                const targetPath = targetDir.endsWith('/') ? 
                    targetDir + fileName : 
                    targetDir + '/' + fileName;
                
                if (sourcePath === targetPath) {
                    failCount++;
                    continue;
                }
                
                try {
                    const response = await fetch('/api/files/move', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            sourcePath: sourcePath,
                            targetPath: targetPath
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (error) {
                    failCount++;
                }
            }
            
            if (successCount > 0) {
                const message = `Moved ${successCount} item(s) successfully`;
                if (failCount > 0) {
                    this.showToast('Move Complete', `${message}, ${failCount} failed`, 'warning');
                } else {
                    this.showToast('Success', message, 'success');
                }
                this.loadFiles(this.currentPath);
                this.clearSelection();
            } else {
                this.showToast('Error', 'All items failed to move', 'error');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to move items', 'error');
            console.error('Error moving items:', error);
        } finally {
            this.hideLoading();
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
            e.target.value = '';
        });
        input.click();
    }

    async handleFileUpload(files) {
        if (!files || files.length === 0) return;
        
        try {
            this.progressManager.show('Uploading Files');
            this.progressManager.updateProgress({
                currentFile: 'Preparing upload...',
                percentage: 0,
                processed: 0,
                total: files.length,
                status: `0/${files.length} files`
            });
            
            const uploadArea = document.querySelector('.upload-area');
            if (uploadArea) {
                uploadArea.classList.add('uploading');
            }
            
            const formData = new FormData();
            formData.append('path', this.currentPath);
            
            for (let i = 0; i < files.length; i++) {
                formData.append('file', files[i]);
            }
            
            const xhr = new XMLHttpRequest();
            
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
            this.progressManager.setCurrentUpload(xhr);
            
            this.progressManager.updateProgress({
                currentFile: 'Starting upload...',
                percentage: 0,
                processed: 0,
                total: files.length,
                status: 'Connecting to server'
            });
            
            xhr.send(formData);
            
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
            const path = Array.from(this.selectedFiles)[0];
            this.downloadFile(path);
        } else {
            await this.downloadMultipleFiles();
        }
    }

    async downloadMultipleFiles() {
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
                const storageTextElement = document.querySelector('.storage-text');
                const storageProgressElement = document.querySelector('.storage-progress-inner');
                
                if (storageTextElement && storageProgressElement) {
                    const total = result.data.total;
                    const used = result.data.used;
                    const percent = result.data.usage_percent;
                    
                    storageTextElement.textContent = 
                        `Used: ${this.formatFileSize(used)} / ${this.formatFileSize(total)}`;
                    
                    storageProgressElement.style.width = `${percent}%`;
                }
            }
        } catch (error) {
            console.error('Error fetching storage info:', error);
        }
    }

    // UI Helper methods
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
        if (!toastContainer) return;
        
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.fileManager = new FileManagerApp();
    window.fileEditor = new FileEditor();
});
