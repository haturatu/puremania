export class UIManager {
    constructor(app) {
        this.app = app;
        this.viewMode = 'grid';
        this.sortState = {
            field: 'type',
            direction: 'desc'
        };
    }

    displayFiles(files) {
        const container = document.querySelector('.file-browser');
        if (!container) return;

        container.innerHTML = '';

        this.renderToolbar(container);
        this.renderUploadArea(container);

        if (!files || files.length === 0) {
            this.renderEmptyState(container);
            return;
        }

        const sortedFiles = this.sortFiles(files);

        const imageCount = sortedFiles.filter(file =>
            file.mime_type && file.mime_type.startsWith('image/')
        ).length;

        if (imageCount >= 10 && this.viewMode !== 'list') {
            this.viewMode = 'masonry';
            this.renderMasonryView(sortedFiles, container);
        } else {
            this.renderStandardView(sortedFiles, container);
        }
    }

    renderToolbar(container) {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.innerHTML = `
            <button class="toolbar-btn" data-action="upload" title="Upload (Ctrl+U)">📂 Upload</button>
            <button class="toolbar-btn" data-action="new-folder" title="New Folder (Ctrl+Shift+N)">📁 New Folder</button>
            <button class="toolbar-btn" data-action="new-file" title="New File (Ctrl+N)">📄 New File</button>
            <button class="toolbar-btn" data-action="download" title="Download Selected" ${this.app.selectedFiles.size === 0 ? 'disabled' : ''}>⬇ Download</button>
            <button class="toolbar-btn" data-action="move" title="Move Selected" ${this.app.selectedFiles.size === 0 ? 'disabled' : ''}>➡️ Move</button>
            <button class="toolbar-btn" data-action="delete" title="Delete Selected (Delete)" ${this.app.selectedFiles.size === 0 ? 'disabled' : ''}>🗑️ Delete</button>
        `;
        container.appendChild(toolbar);
    }

    renderUploadArea(container) {
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.innerHTML = `
            <div class="upload-icon">📁</div>
            <div class="upload-text">Drop files or folders here to upload</div>
            <div class="upload-subtext">or use the buttons below</div>
            <input type="file" class="upload-input-files" multiple hidden>
            <input type="file" class="upload-input-folders" webkitdirectory hidden>
            <div class="upload-buttons">
                <button type="button" class="btn-select-files">📄 Select Files</button>
                <button type="button" class="btn-select-folders">📂 Select Folder</button>
            </div>
            <div class="upload-info">
                <div class="upload-feature">• Files will be uploaded to: <span class="upload-path">${this.app.currentPath}</span></div>
            </div>
        `;
        container.appendChild(uploadArea);
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
                <th class="sortable ${this.sortState.field === 'name' ? this.sortState.direction : ''}" data-sort="name">
                    Name ${this.sortState.field === 'name' ? (this.sortState.direction === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortState.field === 'size' ? this.sortState.direction : ''}" data-sort="size">
                    Size ${this.sortState.field === 'size' ? (this.sortState.direction === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortState.field === 'modified' ? this.sortState.direction : ''}" data-sort="modified">
                    Modified ${this.sortState.field === 'modified' ? (this.sortState.direction === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortState.field === 'type' ? this.sortState.direction : ''}" data-sort="type">
                    Type ${this.sortState.field === 'type' ? (this.sortState.direction === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Actions</th>
            </tr>
        `;
        table.appendChild(thead);

        thead.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', (e) => {
                this.setSort(e.currentTarget.dataset.sort);
            });
        });

        const tbody = document.createElement('tbody');
        files.forEach(file => {
            const tr = this.createTableRow(file);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    }

    setSort(field) {
        if (this.sortState.field === field) {
            this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.direction = 'asc';
        }
        this.app.loadFiles(this.app.currentPath);
    }

    sortFiles(files) {
        return [...files].sort((a, b) => {
            let valueA, valueB;

            switch (this.sortState.field) {
                case 'name':
                    valueA = a.name.toLowerCase();
                    valueB = b.name.toLowerCase();
                    break;
                case 'size':
                    valueA = a.size || 0;
                    valueB = b.size || 0;
                    break;
                case 'modified':
                    valueA = new Date(a.mod_time).getTime();
                    valueB = new Date(b.mod_time).getTime();
                    break;
                case 'type':
                    valueA = a.is_dir ? 'dir' : (a.mime_type || 'file');
                    valueB = b.is_dir ? 'dir' : (b.mime_type || 'file');
                    break;
                default:
                    valueA = a.name.toLowerCase();
                    valueB = b.name.toLowerCase();
            }

            if (valueA < valueB) {
                return this.sortState.direction === 'asc' ? -1 : 1;
            }
            if (valueA > valueB) {
                return this.sortState.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
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

    createTableRow(file) {
        const tr = document.createElement('tr');
        tr.className = 'file-item';
        this.setFileItemData(tr, file);

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
                    <button class="file-action-btn" data-action="download" title="Download">⬇</button>
                    ${file.is_editable ? `<button class="file-action-btn" data-action="edit" title="Edit">✏</button>` : ''}
                    <button class="file-action-btn" data-action="rename" title="Rename (F2)">✏️</button>
                    <button class="file-action-btn" data-action="move" title="Move">➡️</button>
                    <button class="file-action-btn" data-action="delete" title="Delete">🗑</button>
                ` : `
                    <button class="file-action-btn" data-action="rename" title="Rename (F2)">✏️</button>
                    <button class="file-action-btn" data-action="move" title="Move">➡️</button>
                    <button class="file-action-btn" data-action="delete" title="Delete">🗑</button>
                `}
            </td>
        `;

        return tr;
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
                <button class="file-action-btn" data-action="download" title="Download">⬇</button>
                <button class="file-action-btn" data-action="rename" title="Rename">✏️</button>
                <button class="file-action-btn" data-action="move" title="Move">➡️</button>
                <button class="file-action-btn" data-action="delete" title="Delete">🗑</button>
            </div>
        `;

        return item;
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
                    <button class="file-action-btn" data-action="download" title="Download">⬇</button>
                    ${file.is_editable ? `<button class="file-action-btn" data-action="edit" title="Edit">✏</button>` : ''}
                    <button class="file-action-btn" data-action="rename" title="Rename (F2)">✏️</button>
                    <button class="file-action-btn" data-action="move" title="Move">➡️</button>
                    <button class="file-action-btn" data-action="delete" title="Delete">🗑</button>
                ` : `
                    <button class="file-action-btn" data-action="rename" title="Rename (F2)">✏️</button>
                    <button class="file-action-btn" data-action="move" title="Move">➡️</button>
                    <button class="file-action-btn" data-action="delete" title="Delete">🗑</button>
                `}
            </div>
        `;

        return fileItem;
    }

    setFileItemData(element, file) {
        element.dataset.path = file.path;
        element.dataset.isDir = file.is_dir ? "true" : "false";
        element.dataset.mimeType = file.mime_type || '';
        element.dataset.isEditable = file.is_editable ? "true" : "false";
        element.dataset.isMount = file.is_mount ? "true" : "false";
    }

    getFileIconClass(file) {
        if (file.is_dir) return 'folder';
        if (file.is_mount) return 'mount';

        const mime = file.mime_type || '';
        const name = file.name || '';
        const ext = name.split('.').pop()?.toLowerCase() || '';

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
            const hasSelection = this.app.selectedFiles.size > 0;
            downloadBtn.disabled = !hasSelection;
            moveBtn.disabled = !hasSelection;
            deleteBtn.disabled = !hasSelection;
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
        this.app.loadFiles(this.app.currentPath);
    }

    showToast(title, message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            console.error('Toast container not found!');
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close">&times;</button>
        `;

        toastContainer.appendChild(toast);

        const closeButton = toast.querySelector('.toast-close');

        const removeToast = () => {
            toast.style.opacity = '0';
            // Add a transition for the fade-out effect
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        };

        closeButton.addEventListener('click', removeToast);
        setTimeout(removeToast, 5000);
    }

    showLoading() {
        document.getElementById('loading-overlay').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}
