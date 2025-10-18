import { getTemplateContent } from './template.js';

export class UIManager {
    constructor(app) {
        this.app = app;
        this.viewMode = 'grid';
        this.previousPath = null;
        this.currentFiles = [];
        this.sortState = {
            field: 'type',
            direction: 'desc'
        };
        this.fileBrowserExtensionsVisible = false;
    }

    displayFiles(files) {
        this.currentFiles = files;
        const container = document.querySelector('.file-browser');
        if (!container) return;

        const currentPath = this.app.router.getCurrentPath();
        const isNewFolder = currentPath !== this.previousPath;
        this.previousPath = currentPath;

        if (isNewFolder) {
            const musicFileCount = files.filter(file => file.mime_type && file.mime_type.startsWith('audio/')).length;
            this.sortState.field = musicFileCount >= 10 ? 'name' : 'type';
            this.sortState.direction = musicFileCount >= 10 ? 'asc' : 'desc';
        }

        container.innerHTML = '';
        this.renderHeaderToggle();

        this.renderToolbar(container);
        this.renderUploadArea(container);

        if (!files || files.length === 0) {
            this.renderEmptyState(container);
            return;
        }

        const sortedFiles = this.sortFiles(files);
        const imageCount = sortedFiles.filter(f => f.mime_type && f.mime_type.startsWith('image/')).length;
        const videoCount = sortedFiles.filter(f => f.mime_type && f.mime_type.startsWith('video/')).length;
        const hasMasonrySupport = imageCount >= 10;
        const hasVideoSupport = videoCount > 0;

            if (isNewFolder && hasMasonrySupport) this.viewMode = 'masonry';
            // if (isNewFolder && hasVideoSupport && !hasMasonrySupport) this.viewMode = 'video';
            if (this.viewMode === 'masonry' && !hasMasonrySupport) this.viewMode = 'grid';
            if (this.viewMode === 'video' && !hasVideoSupport) this.viewMode = 'grid';
        if (this.viewMode === 'masonry') {
            this.renderMasonryView(sortedFiles, container, hasVideoSupport);
        } else {
            this.renderStandardView(sortedFiles, container, hasMasonrySupport, hasVideoSupport);
        }
    }

    renderHeaderToggle() {
        const header = document.querySelector('.header');
        let toggleBtn = header.querySelector('#toggle-file-browser-extensions-btn');
        if (!toggleBtn) {
            toggleBtn = document.createElement('button');
            toggleBtn.className = 'toolbar-btn';
            toggleBtn.id = 'toggle-file-browser-extensions-btn';
            toggleBtn.textContent = '☰';
            toggleBtn.title = 'Toggle toolbar and upload';
            header.appendChild(toggleBtn);
        }
    }

    toggleFileBrowserExtensions() {
        this.fileBrowserExtensionsVisible = !this.fileBrowserExtensionsVisible;
        const toolbar = document.querySelector('.toolbar');
        const uploadArea = document.querySelector('.upload-area');
        if (toolbar) {
            toolbar.classList.toggle('hidden', !this.fileBrowserExtensionsVisible);
        }
        if (uploadArea) {
            uploadArea.classList.toggle('hidden', !this.fileBrowserExtensionsVisible);
        }
    }

    renderToolbar(container) {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        if (!this.fileBrowserExtensionsVisible) {
            toolbar.classList.add('hidden');
        }
        const template = getTemplateContent('/static/templates/components/toolbar.html');
        toolbar.appendChild(template);
        container.appendChild(toolbar);
    }

    renderUploadArea(container) {
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        if (!this.fileBrowserExtensionsVisible) {
            uploadArea.classList.add('hidden');
        }
        const template = getTemplateContent('/static/templates/components/upload_area.html');
        template.querySelector('.upload-path').textContent = this.app.router.getCurrentPath();
        uploadArea.appendChild(template);
        container.appendChild(uploadArea);
    }

    renderEmptyState(container) {
        const noFiles = document.createElement('div');
        noFiles.className = 'no-files';
        const template = getTemplateContent('/static/templates/components/empty_state.html');
        noFiles.appendChild(template);
        container.appendChild(noFiles);
    }

    createViewToggle(hasMasonrySupport = false, hasVideoSupport = false) {
        const viewToggle = document.createElement('div');
        viewToggle.className = 'view-toggle';
        const template = getTemplateContent('/static/templates/components/view_toggle.html');
        
        const activeBtn = template.querySelector(`[data-view="${this.viewMode}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        if (hasMasonrySupport) {
            const masonryBtn = document.createElement('button');
            masonryBtn.className = 'view-toggle-btn';
            masonryBtn.dataset.view = 'masonry';
            masonryBtn.textContent = 'Masonry';
            if (this.viewMode === 'masonry') {
                masonryBtn.classList.add('active');
            }
            template.appendChild(masonryBtn);
        }

        if (!hasVideoSupport) {
            const videoBtn = template.querySelector('[data-view="video"]');
            if (videoBtn) {
                videoBtn.remove();
            }
        }

        viewToggle.appendChild(template);
        return viewToggle;
    }

    renderStandardView(files, container, hasMasonrySupport = false, hasVideoSupport = false) {
        const viewToggle = this.createViewToggle(hasMasonrySupport, hasVideoSupport);
        container.appendChild(viewToggle);

        const fileContainer = document.createElement('div');
        if (this.viewMode === 'list') {
            fileContainer.className = 'table-view-container';
            this.renderListView(files, fileContainer);
        } else if (this.viewMode === 'video') {
            fileContainer.className = 'video-grid';
            this.renderVideoView(files, fileContainer);
        } else {
            fileContainer.className = 'file-grid';
            this.renderGridView(files, fileContainer);
        }
        container.appendChild(fileContainer);
    }

    renderVideoView(files, container) {
        const videoFiles = files.filter(f => f.mime_type && f.mime_type.startsWith('video/'));
        videoFiles.forEach(file => {
            const videoItem = this.createVideoItem(file);
            container.appendChild(videoItem);
        });
    }

    createVideoItem(file) {
        const template = getTemplateContent('/static/templates/components/video_view_item.html');
        const videoItem = template.querySelector('.video-card');
        this.setFileItemData(videoItem, file);

        const thumbnailUrl = `/api/files/thumbnail?path=${encodeURIComponent(file.path)}`;
        const thumbnailImg = videoItem.querySelector('.video-thumbnail img');
        
        this.loadImageWithRetry(thumbnailImg, thumbnailUrl);

        thumbnailImg.alt = file.name;
        videoItem.querySelector('.video-title').textContent = file.name;
        videoItem.querySelector('.video-meta').textContent = `${this.formatFileSize(file.size)} \u00B7 ${new Date(file.mod_time).toLocaleDateString()}`;

        return videoItem;
    }

    loadImageWithRetry(imgElement, src, retries = 3, delay = 1000) {
        let attempts = 0;

        const loadImage = () => {
            imgElement.src = `${src}${src.includes('?') ? '&' : '?'}v=${new Date().getTime() + attempts}`;
        };

        imgElement.onerror = () => {
            attempts++;
            if (attempts < retries) {
                setTimeout(loadImage, delay);
            } else {
                // Optional: Set a fallback image or handle the final failure
                console.error(`Failed to load image after ${retries} attempts: ${src}`);
            }
        };

        loadImage();
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

        const thead = this.createListViewHeader(this.sortState.field, this.sortState.direction);
        
        thead.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', (e) => this.setSort(e.currentTarget.dataset.sort));
        });
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        files.forEach(file => {
            const tr = this.createTableRow(file);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    }

    createListViewHeader(sortField, sortDirection) {
        const thead = document.createElement('thead');
        const headerTemplate = getTemplateContent('/static/templates/components/list_view_header.html');
        const headerRow = headerTemplate.querySelector('tr');
        
        const sortableHeader = headerRow.querySelector(`[data-sort="${sortField}"]`);
        if(sortableHeader) {
            sortableHeader.classList.add(sortDirection);
            sortableHeader.textContent += sortDirection === 'asc' ? ' ↑' : ' ↓';
        }
        thead.appendChild(headerRow);
        return thead;
    }

    setSort(field) {
        if (this.sortState.field === field) {
            this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.direction = 'asc';
        }
        this.displayFiles(this.currentFiles);
    }

    sortFiles(files) {
        return [...files].sort((a, b) => {
            const field = this.sortState.field;
            const dir = this.sortState.direction === 'asc' ? 1 : -1;
            
            let valA = field === 'name' ? a.name.toLowerCase() : (a[field] || 0);
            let valB = field === 'name' ? b.name.toLowerCase() : (b[field] || 0);

            if (field === 'type') {
                valA = a.is_dir ? 'dir' : (a.mime_type || 'file');
                valB = b.is_dir ? 'dir' : (b.mime_type || 'file');
            }
            if (field === 'modified') {
                valA = new Date(a.mod_time).getTime();
                valB = new Date(b.mod_time).getTime();
            }

            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });
    }

    renderMasonryView(files, container, hasVideoSupport = false) {
        const imageFiles = files.filter(f => f.mime_type && f.mime_type.startsWith('image/'));
        const otherFiles = files.filter(f => !f.mime_type || !f.mime_type.startsWith('image/'));

        const viewToggle = this.createViewToggle(true, hasVideoSupport);
        container.appendChild(viewToggle);

        if (imageFiles.length > 0) this.renderImageSection(imageFiles, container);
        if (otherFiles.length > 0) this.renderOtherFilesSection(otherFiles, container);
    }

    createTableRow(file) {
        const tr = document.createElement('tr');
        tr.className = 'file-item';
        this.setFileItemData(tr, file);

        const template = getTemplateContent('/static/templates/components/list_view_item.html');
        template.querySelector('.file-icon').className = `file-icon ${this.getFileIconClass(file)}`;
        template.querySelector('.file-name').textContent = file.name;
        template.querySelector('.file-size').textContent = file.is_dir ? '-' : this.formatFileSize(file.size);
        template.querySelector('.file-mod-time').textContent = new Date(file.mod_time).toLocaleString();
        template.querySelector('.file-mime-type').textContent = file.is_dir ? 'Folder' : (file.mime_type || 'Unknown');
        
        const actionsContainer = template.querySelector('.file-actions');
        this.renderFileActions(actionsContainer, file);

        tr.appendChild(template);
        return tr;
    }

    createMasonryItem(file) {
        const item = document.createElement('div');
        item.className = 'masonry-item';
        this.setFileItemData(item, file);

        const template = getTemplateContent('/static/templates/components/masonry_item.html');
        const img = template.querySelector('.masonry-image');
        img.src = `/api/files/content?path=${encodeURIComponent(file.path)}`;
        img.alt = file.name;
        img.onload = () => item.style.gridRowEnd = `span ${Math.round((img.naturalHeight / img.naturalWidth) * 20)}`;
        img.onerror = () => img.style.display = 'none';

        template.querySelector('.masonry-name').textContent = file.name;
        template.querySelector('.masonry-size').textContent = this.formatFileSize(file.size);
        
        item.appendChild(template);
        return item;
    }

    renderImageSection(imageFiles, container) {
        const title = document.createElement('h3');
        title.textContent = 'Images';
        title.style.cssText = 'margin: 20px 0 10px; color: var(--accent-primary);';
        container.appendChild(title);

        const masonryGrid = document.createElement('div');
        masonryGrid.className = 'masonry-grid';
        imageFiles.forEach(file => masonryGrid.appendChild(this.createMasonryItem(file)));
        container.appendChild(masonryGrid);
    }

    renderOtherFilesSection(otherFiles, container) {
        const title = document.createElement('h3');
        title.textContent = 'Other Files';
        title.style.cssText = 'margin: 30px 0 10px; color: var(--accent-primary);';
        container.appendChild(title);

        const fileGrid = document.createElement('div');
        fileGrid.className = 'file-grid';
        otherFiles.forEach(file => fileGrid.appendChild(this.createFileItem(file)));
        container.appendChild(fileGrid);
    }

    createFileItem(file) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        this.setFileItemData(fileItem, file);

        const template = getTemplateContent('/static/templates/components/grid_view_item.html');
        template.querySelector('.file-icon').className = `file-icon ${this.getFileIconClass(file)}`;
        template.querySelector('.file-name').textContent = file.name;
        template.querySelector('.file-info').textContent = file.is_dir ? 'Folder' : this.formatFileSize(file.size);
        
        const actionsContainer = template.querySelector('.file-actions');
        this.renderFileActions(actionsContainer, file);

        fileItem.appendChild(template);
        return fileItem;
    }
    
    renderFileActions(container, file) {
        const templateFile = file.is_dir ? '/static/templates/components/folder_actions.html' : '/static/templates/components/file_actions.html';
        const template = getTemplateContent(templateFile);

        if (!file.is_dir) {
            if (!file.is_editable) {
                const editBtn = template.querySelector('[data-action="edit"]');
                if (editBtn) editBtn.remove();
            }
            if (this.getFileIconClass(file) !== 'archive') {
                const extractBtn = template.querySelector('[data-action="extract"]');
                if (extractBtn) extractBtn.remove();
            }
        }
        container.appendChild(template);
    }

    setFileItemData(element, file) {
        element.dataset.path = file.path;
        element.dataset.isDir = file.is_dir;
        element.dataset.mimeType = file.mime_type || '';
        element.dataset.isEditable = file.is_editable;
        element.dataset.isMount = file.is_mount;
    }

    getFileIconClass(file) {
        if (file.is_dir) return 'folder';
        if (file.is_mount) return 'mount';
        const mime = file.mime_type || '';
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('text/') || file.is_editable) return 'document';
        if (['zip', 'rar', '7z', 'tar', 'gz'].some(ext => file.name.endsWith(ext))) return 'archive';
        return 'file';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    updateBreadcrumb(path) {
        const breadcrumb = document.querySelector('.breadcrumb');
        if (!breadcrumb) return;
        breadcrumb.innerHTML = '';
        const parts = path.split('/').filter(Boolean);
        let currentPath = '';

        const rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-item';
        rootItem.textContent = 'Root';
        rootItem.dataset.path = '/';
        breadcrumb.appendChild(rootItem);

        parts.forEach(part => {
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
        const hasSelection = this.app.selectedFiles.size > 0;
        const downloadBtn = document.querySelector('[data-action="download"]');
        if (downloadBtn) {
            downloadBtn.disabled = !hasSelection;
        }
        const moveBtn = document.querySelector('[data-action="move"]');
        if (moveBtn) {
            moveBtn.disabled = !hasSelection;
        }
        const deleteBtn = document.querySelector('[data-action="delete"]');
        if (deleteBtn) {
            deleteBtn.disabled = !hasSelection;
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
        this.displayFiles(this.currentFiles);
    }

    showToast(title, message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const template = getTemplateContent('/static/templates/components/toast.html');
        template.querySelector('.toast-title').textContent = title;
        template.querySelector('.toast-message').textContent = message;
        toast.appendChild(template);
        
        toastContainer.appendChild(toast);

        const removeToast = () => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        };
        toast.querySelector('.toast-close').addEventListener('click', removeToast);
        setTimeout(removeToast, 5000);
    }

    showLoading() {
        document.getElementById('loading-overlay').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    }

    updateSpecificDirs(dirs) {
        const container = document.getElementById('specific-dirs-container');
        if (!container) return;
        container.innerHTML = '';
        
        const iconMap = { 'Documents': '📄', 'Images': '🖼️', 'Music': '🎵', 'Videos': '🎬', 'Downloads': '📥', 'default': '📂' };

        dirs.forEach(dir => {
            const navItem = document.createElement('div');
            navItem.className = 'nav-item';
            navItem.dataset.path = dir.path;
            
            const template = getTemplateContent('/static/templates/components/nav_item.html');
            template.querySelector('i').textContent = iconMap[dir.name] || iconMap['default'];
            template.querySelector('span').textContent = dir.name;
            navItem.appendChild(template);
            
            container.appendChild(navItem);
        });
    }

    updateSidebarActiveState(path) {
        document.querySelectorAll('.sidebar .nav-item.active').forEach(item => item.classList.remove('active'));
        const activeItem = document.querySelector(`.sidebar .nav-item[data-path="${path}"]`);
        if (activeItem) activeItem.classList.add('active');
    }

    updateAria2cVisibility(enabled) {
        const aria2cBtn = document.getElementById('aria2c-status-btn');
        if (aria2cBtn) aria2cBtn.style.display = enabled ? 'flex' : 'none';
    }
}
