import { getTemplateContent } from './template.js';
import { buildApiUrl } from './util.js';
import { ImageLoader } from './image-loader.js';

export class UIManager {
    constructor(app) {
        this.app = app;
        this.viewMode = 'grid';
        this.sortState = {
            field: 'name',
            direction: 'asc'
        };
        this.fileBrowserExtensionsVisible = false;
        this.lazyImageObserver = null;
        this.imageLoader = new ImageLoader();
        this.directoryPage = null;
        this.directoryPageNumber = 0;
        this.removeVirtualScroll = null;
        this.nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    }

    get currentFiles() { return this.app.store.getState().directory.files; }

    displayFiles(files, { page = null, pageNumber = 0 } = {}) {
        this.directoryPage = page;
        this.directoryPageNumber = pageNumber;
        this.removeVirtualScroll?.();
        this.removeVirtualScroll = null;
        const container = document.querySelector('.file-browser');
        if (!container) return;
        this.resetLazyImageObserver();

        const currentPath = this.app.router.getCurrentPath();
        const isNewFolder = currentPath !== this.app.store.getState().directory.renderedPath;
        this.app.store.update('directory', { renderedPath: currentPath, files, page }, 'DIRECTORY_RENDERED');

        container.innerHTML = '';
        this.renderHeaderToggle();

        this.renderToolbar(container);
        this.renderUploadArea(container);

        if (!files || files.length === 0) {
            this.renderEmptyState(container);
            this.syncSelectionClasses(container);
            return;
        }

        const sortedFiles = page ? files : this.sortFiles(files);
        const imageCount = sortedFiles.filter(f => f.mime_type && f.mime_type.startsWith('image/')).length;
        const videoCount = sortedFiles.filter(f => f.mime_type && f.mime_type.startsWith('video/')).length;
        const hasMasonrySupport = imageCount >= 10;
        const hasVideoSupport = videoCount > 0;
        const isLargeDirectory = (page?.total || files.length) > files.length;

            if (isNewFolder && hasMasonrySupport && !isLargeDirectory) this.viewMode = 'masonry';
            // if (isNewFolder && hasVideoSupport && !hasMasonrySupport) this.viewMode = 'video';
            if (this.viewMode === 'masonry' && !hasMasonrySupport) this.viewMode = 'grid';
            if (this.viewMode === 'video' && !hasVideoSupport) this.viewMode = 'grid';
            if (isLargeDirectory && (this.viewMode === 'masonry' || this.viewMode === 'video')) this.viewMode = 'grid';
        if (this.viewMode === 'masonry') {
            this.renderMasonryView(sortedFiles, container, hasVideoSupport);
        } else {
            this.renderStandardView(sortedFiles, container, hasMasonrySupport, hasVideoSupport);
        }
        this.renderDirectoryPagination(container);
        this.syncSelectionClasses(container);
    }

    syncSelectionClasses(container = document) {
        container.querySelectorAll('.file-item, .masonry-item, .video-card').forEach(item => {
            const selected = this.app.selectedFiles.has(item.dataset.path);
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-selected', String(selected));
        });
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

    setDirectoryStatus(status, message = '') {
        const header = document.querySelector('.header');
        if (!header) return;
        let indicator = header.querySelector('.directory-status');
        if (status === 'ready') {
            indicator?.remove();
            return;
        }
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'directory-status';
            indicator.setAttribute('role', 'status');
            indicator.setAttribute('aria-live', 'polite');
            header.appendChild(indicator);
        }
        indicator.dataset.status = status;
        indicator.textContent = message;
    }

    displayDirectoryError(path, message) {
        const container = document.querySelector('.file-browser');
        if (!container) return;
        container.replaceChildren();
        const panel = document.createElement('section');
        panel.className = 'directory-error';
        panel.setAttribute('role', 'alert');
        const title = document.createElement('h2');
        title.textContent = 'Folder could not be loaded';
        const description = document.createElement('p');
        description.textContent = message;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-primary';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => this.app.loadFiles(path));
        panel.append(title, description, retry);
        container.appendChild(panel);
        this.setDirectoryStatus('error', 'Directory refresh failed');
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
        container.appendChild(fileContainer);
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

        const thumbnailUrl = buildApiUrl('/api/files/thumbnail', { path: file.path });
        const thumbnailImg = videoItem.querySelector('.video-thumbnail img');

        this.prepareLazyImage(thumbnailImg, thumbnailUrl);

        thumbnailImg.alt = file.name;
        videoItem.querySelector('.video-title').textContent = file.name;
        videoItem.querySelector('.video-meta').textContent = `${this.formatFileSize(file.size)} \u00B7 ${new Date(file.mod_time).toLocaleDateString()}`;

        return videoItem;
    }

    loadImageWithRetry(imgElement, src) {
        if (!imgElement || imgElement.dataset.imageLoaded === 'true') {
            return false;
        }
        imgElement.dataset.loadingStarted = 'true';
        const queued = this.imageLoader.enqueue({
            key: imgElement.dataset.imageKey,
            src,
            priority: Number(imgElement.dataset.imagePriority || 0),
            onLoad: loaded => {
                imgElement.src = loaded.src;
                imgElement.dataset.imageLoaded = 'true';
                imgElement.classList.remove('image-pending');
                this.lazyImageObserver?.unobserve(imgElement);
            },
            onError: () => { imgElement.dataset.loadingStarted = ''; imgElement.classList.remove('image-pending'); console.error(`Failed to load image: ${src}`); },
            onCancel: () => { imgElement.dataset.loadingStarted = ''; }
        });
        if (!queued) imgElement.dataset.loadingStarted = '';
        return queued;
    }

    resetLazyImageObserver() {
        if (this.lazyImageObserver) {
            this.lazyImageObserver.disconnect();
            this.lazyImageObserver = null;
        }
        this.imageLoader.clear();
    }

    getLazyImageObserver() {
        if (this.lazyImageObserver) {
            return this.lazyImageObserver;
        }

        if (!('IntersectionObserver' in window)) {
            return null;
        }

        this.lazyImageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const imgElement = entry.target;
                const src = imgElement.dataset.src;
                if (!src || imgElement.dataset.imageLoaded === 'true') return;
                if (!entry.isIntersecting) {
                    if (this.imageLoader.cancel(imgElement.dataset.imageKey)) imgElement.dataset.loadingStarted = '';
                    return;
                }
                const imageCenter = entry.boundingClientRect.top + entry.boundingClientRect.height / 2;
                imgElement.dataset.imagePriority = String(Math.abs(imageCenter - window.innerHeight / 2));
                this.loadImageWithRetry(imgElement, src);
            });
        }, {
            rootMargin: matchMedia('(max-width: 768px)').matches ? '800px 0px' : '1600px 0px'
        });

        return this.lazyImageObserver;
    }

    prepareLazyImage(imgElement, src) {
        imgElement.dataset.src = src;
        imgElement.dataset.imageKey = `image:${src}`;
        imgElement.loading = 'lazy';
        imgElement.decoding = 'async';
        imgElement.classList.add('image-pending');

        const observer = this.getLazyImageObserver();
        if (observer) {
            observer.observe(imgElement);
            return;
        }

        this.loadImageWithRetry(imgElement, src);
    }

    renderGridView(files, container) {
        if (files.length > 80) {
            this.renderVirtualGrid(files, container);
            return;
        }
        files.forEach(file => {
            const fileItem = this.createFileItem(file);
            container.appendChild(fileItem);
        });
    }

    createListViewTable(files, sortField, sortDirection, onSort) {
        const table = document.createElement('table');
        table.className = 'table-view';

        const thead = this.createListViewHeader(sortField, sortDirection);
        if (typeof onSort === 'function') {
            thead.querySelectorAll('.sortable').forEach(header => {
                header.addEventListener('click', (e) => onSort(e.currentTarget.dataset.sort));
            });
        }
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        files.forEach(file => {
            const tr = this.createTableRow(file);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        return table;
    }

    renderListView(files, container) {
        if (files.length > 80) {
            this.renderVirtualList(files, container);
            return;
        }
        const table = this.createListViewTable(
            files,
            this.sortState.field,
            this.sortState.direction,
            (field) => this.setSort(field)
        );
        container.appendChild(table);
    }

    renderSearchResultsFiles(files, container, sortField, sortDirection, onSort) {
        if (this.viewMode === 'list') {
            const tableContainer = document.createElement('div');
            tableContainer.className = 'table-view-container';
            tableContainer.appendChild(this.createListViewTable(files, sortField, sortDirection, onSort));
            container.appendChild(tableContainer);
            return;
        }

        const fileGrid = document.createElement('div');
        fileGrid.className = 'file-grid';
        this.renderGridView(files, fileGrid);
        container.appendChild(fileGrid);
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
        this.app.loadFiles(this.app.router.getCurrentPath());
    }

    bindVirtualScroll(render) {
        const browser = document.querySelector('.file-browser');
        if (!browser) return;
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; render(); });
        };
        browser.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        this.removeVirtualScroll = () => {
            browser.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
        render();
    }

    renderVirtualGrid(files, container) {
        const rowHeight = 190;
        this.bindVirtualScroll(() => {
            const browser = document.querySelector('.file-browser');
            const columns = Math.max(1, Math.floor(container.clientWidth / 160));
            const firstRow = Math.max(0, Math.floor((browser.scrollTop - container.offsetTop) / rowHeight) - 3);
            const visibleRows = Math.ceil(browser.clientHeight / rowHeight) + 6;
            const lastRow = Math.min(Math.ceil(files.length / columns), firstRow + visibleRows);
            const start = firstRow * columns;
            const end = Math.min(files.length, lastRow * columns);
            const top = document.createElement('div');
            top.className = 'virtual-spacer';
            top.style.cssText = `grid-column:1/-1;height:${firstRow * rowHeight}px`;
            const bottom = document.createElement('div');
            bottom.className = 'virtual-spacer';
            bottom.style.cssText = `grid-column:1/-1;height:${Math.max(0, (Math.ceil(files.length / columns) - lastRow) * rowHeight)}px`;
            container.replaceChildren(top, ...files.slice(start, end).map(file => this.createFileItem(file)), bottom);
            this.syncSelectionClasses(container);
        });
    }

    renderVirtualList(files, container) {
        const table = this.createListViewTable([], this.sortState.field, this.sortState.direction, field => this.setSort(field));
        const body = table.querySelector('tbody');
        container.appendChild(table);
        const rowHeight = 48;
        this.bindVirtualScroll(() => {
            const browser = document.querySelector('.file-browser');
            const start = Math.max(0, Math.floor((browser.scrollTop - table.offsetTop) / rowHeight) - 10);
            const count = Math.ceil(browser.clientHeight / rowHeight) + 20;
            const end = Math.min(files.length, start + count);
            const spacer = height => {
                const row = document.createElement('tr');
                row.className = 'virtual-spacer';
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.style.height = `${height}px`;
                row.appendChild(cell);
                return row;
            };
            body.replaceChildren(spacer(start * rowHeight), ...files.slice(start, end).map(file => this.createTableRow(file)), spacer((files.length - end) * rowHeight));
            this.syncSelectionClasses(body);
        });
    }

    renderDirectoryPagination(container) {
        const page = this.directoryPage;
        if (!page || (page.offset === 0 && !page.hasMore)) return;
        const controls = document.createElement('nav');
        controls.className = 'pagination-controls directory-pagination';
        controls.setAttribute('aria-label', 'Directory pages');
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'pagination-btn';
        previous.textContent = '← Previous';
        previous.disabled = page.offset === 0;
        previous.addEventListener('click', () => this.app.loadFiles(this.app.router.getCurrentPath(), {
            cursor: String(Math.max(0, page.offset - 200)), pageNumber: Math.max(0, this.directoryPageNumber - 1)
        }));
        const label = document.createElement('span');
        label.textContent = `Page ${this.directoryPageNumber + 1} · ${page.offset + 1}-${page.offset + page.data.length} of ${page.total}`;
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'pagination-btn';
        next.textContent = 'Next →';
        next.disabled = !page.hasMore;
        next.addEventListener('click', () => this.app.loadFiles(this.app.router.getCurrentPath(), {
            cursor: page.nextCursor, pageNumber: this.directoryPageNumber + 1
        }));
        controls.append(previous, label, next);
        container.appendChild(controls);
    }

    sortFiles(files) {
        return [...files].sort((a, b) => {
            const field = this.sortState.field;
            const dir = this.sortState.direction === 'asc' ? 1 : -1;
            
            if (field === 'name') {
                const comparison = this.nameCollator.compare(a.name, b.name);
                return comparison * dir;
            }

            let valA = a[field] || 0;
            let valB = b[field] || 0;

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
        
        img.alt = file.name;
        img.onload = () => item.style.gridRowEnd = `span ${Math.round((img.naturalHeight / img.naturalWidth) * 20)}`;
        img.onerror = () => img.style.display = 'none';

        this.prepareLazyImage(img, buildApiUrl('/api/files/content', { path: file.path }));

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
        const event = this.app.emit('view-change-requested', { mode }, { cancelable: true });
        if (event.defaultPrevented) return;
        this.viewMode = mode;
        this.displayFiles(this.currentFiles);
        this.app.uploader.bindUploadEvents();
    }

    showToast(title, message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.setAttribute('aria-atomic', 'true');
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
        setTimeout(removeToast, type === 'error' ? 10000 : 5000);
    }

    showLoading() {
        const pendingOperations = this.app.store.getState().ui.pendingOperations + 1;
        this.app.store.update('ui', { pendingOperations }, 'OPERATION_STARTED');
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'flex';
    }

    hideLoading() {
        const pendingOperations = Math.max(0, this.app.store.getState().ui.pendingOperations - 1);
        this.app.store.update('ui', { pendingOperations }, 'OPERATION_FINISHED');
        if (pendingOperations === 0) {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.style.display = 'none';
        }
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
        const activeItem = [...document.querySelectorAll('.sidebar .nav-item')].find(item => item.dataset.path === path);
        if (activeItem) activeItem.classList.add('active');
    }

    updateAria2cVisibility(enabled) {
        const aria2cBtn = document.getElementById('aria2c-status-btn');
        if (aria2cBtn) aria2cBtn.style.display = enabled ? 'flex' : 'none';
    }
}
