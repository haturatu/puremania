import { getTemplateContent } from './template.js';

export class SearchHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.isSearchOpen = false;
        this.searchOptions = { useRegex: false, caseSensitive: false, scope: 'current' };
        this.lastSearchTerm = '';
        this.lastSearchResults = null;
        this.currentPage = 0;
        this.pageSize = 100;
        this.totalResults = 0;
        this.sortField = 'name';
        this.sortDirection = 'asc';
        this.isInSearchMode = false;
        this.originalViewMode = null;
        this.isCdMode = false;
        this.isAria2cMode = false;
        this.cdCompletions = [];
        this.selectedCompletionIndex = -1;
        this.isShowingCompletions = false;
    }

    init() {
        this.bindEvents();
        this.createSearchModal();
        this.createCompletionDropdown();
        this.setupFileOperationListeners();
    }

    createCompletionDropdown() {
        const dropdown = document.createElement('div');
        dropdown.className = 'cd-completion-dropdown';
        dropdown.style.display = 'none';
        const template = getTemplateContent('/static/templates/components/completion_dropdown.html');
        dropdown.appendChild(template);
        document.querySelector('.search-container')?.appendChild(dropdown);
        this.completionDropdown = dropdown;
    }

    setupFileOperationListeners() {
        const api = this.fileManager.api;
        const ui = this.fileManager.ui;
        const originalMethods = {
            deleteFile: api.deleteFile.bind(api),
            renameFile: api.renameFile.bind(api),
            moveFile: api.moveFile.bind(api),
            createNewFile: api.createNewFile.bind(api),
            createNewFolder: api.createNewFolder.bind(api),
            setViewMode: ui.setViewMode.bind(ui)
        };

        const hook = (originalFn) => async (...args) => {
            const result = await originalFn(...args);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        api.deleteFile = hook(originalMethods.deleteFile);
        api.renameFile = hook(originalMethods.renameFile);
        api.moveFile = hook(originalMethods.moveFile);
        api.createNewFile = hook(originalMethods.createNewFile);
        api.createNewFolder = hook(originalMethods.createNewFolder);

        ui.setViewMode = (mode) => {
            if (this.isInSearchMode && this.lastSearchResults && this.lastSearchTerm) {
                ui.viewMode = mode;
                this.redisplayResults(this.currentPage);
            } else {
                originalMethods.setViewMode(mode);
            }
        };
    }

    bindEvents() {
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.addEventListener('focus', () => this.showSearchOptions());
            searchInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
            searchInput.addEventListener('input', (e) => this.handleInput(e));
            searchInput.addEventListener('blur', () => setTimeout(() => {
                if (!this.completionDropdown.contains(document.activeElement)) this.hideCompletions();
            }, 200));
        }
        document.querySelector('.search-options')?.addEventListener('click', () => this.toggleSearchOptions());
    }

    handleKeyDown(e) {
        if (this.isShowingCompletions) {
            const actions = { ArrowDown: 1, ArrowUp: -1, Tab: 1 };
            if (actions[e.key] !== undefined) {
                e.preventDefault();
                this.navigateCompletion(actions[e.key]);
                if(e.key === 'Tab') this.applyCompletion();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.selectedCompletionIndex >= 0) this.applyCompletion();
                else this.handleEnter(e.target);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hideCompletions();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.handleEnter(e.target);
        } else if (e.key === 'Tab' && this.isCdMode) {
            e.preventDefault();
            this.showCompletions(e.target.value);
        }
    }

    handleInput(e) {
        const value = e.target.value;
        this.isCdMode = value.startsWith('cd ');
        this.isAria2cMode = value.startsWith('aria2c ');
        if (this.isCdMode && this.isShowingCompletions) {
            this.updateCompletions(value.slice(3));
        }
    }

    handleEnter(searchInput) {
        const value = searchInput.value.trim();
        if (this.isCdMode) this.executeCdCommand(value);
        else if (this.isAria2cMode) this.executeAria2cCommand(value);
        else this.performSearch();
    }

    async executeCdCommand(command) {
        const path = command.slice(2).trim();
        try {
            let targetPath = '/';
            if (path && path !== '') {
                if (path === '..') targetPath = this.fileManager.util.getParentPath(this.fileManager.router.getCurrentPath());
                else if (path.startsWith('/')) targetPath = path;
                else {
                    const basePath = this.fileManager.router.getCurrentPath();
                    targetPath = basePath.endsWith('/') ? basePath + path : `${basePath}/${path}`;
                }
            }
            await this.navigateToFolder(this.fileManager.util.normalizePath(targetPath));
        } catch (error) {
            this.fileManager.ui.showToast('cd Error', `Cannot change directory: ${error.message}`, 'error');
        }
    }

    async executeAria2cCommand(command) {
        const url = command.slice('aria2c '.length).trim();
        if (!url) {
            this.fileManager.ui.showToast('aria2c Error', 'Please provide a URL.', 'error');
            return;
        }
        this.fileManager.ui.showToast('aria2c', `Starting download...`, 'info');
        try {
            const result = await this.fileManager.api.startAria2cDownload(url, this.fileManager.router.getCurrentPath());
            if (result.success) {
                this.fileManager.ui.showToast('aria2c', result.message || 'Download started.', 'success');
                const searchInput = document.querySelector('.search-input');
                if (searchInput) searchInput.value = '';
                this.isAria2cMode = false;
                this.isCdMode = false;
            } else {
                this.fileManager.ui.showToast('aria2c Error', result.message || 'Failed to start download.', 'error');
            }
        } catch (error) {
            this.fileManager.ui.showToast('aria2c Error', `Failed to start download: ${error.message}`, 'error');
        }
    }

    async navigateToFolder(path) {
        try {
            const normalizedPath = this.fileManager.util.normalizePath(path);
            const result = await this.fileManager.api.getFiles(normalizedPath, false); // Don't use cache
            if (result) {
                this.exitSearchMode(true);
                const searchInput = document.querySelector('.search-input');
                if (searchInput) searchInput.value = '';
                this.fileManager.router.navigate(normalizedPath);
            } else {
                throw new Error(`Directory not found: ${normalizedPath}`);
            }
        } catch (error) {
            this.fileManager.ui.showToast('Error', error.message, 'error');
        }
    }

    async showCompletions(command) {
        const path = command.slice(3);
        try {
            const completions = await this.getCompletions(path);
            this.displayCompletions(completions);
        } catch (error) {
            console.error('Completion error:', error);
        }
    }

    async getCompletions(partialPath) {
        try {
            let searchPath, prefix;
            if (partialPath.startsWith('/')) {
                const lastSlashIndex = partialPath.lastIndexOf('/');
                searchPath = lastSlashIndex === 0 ? '/' : partialPath.substring(0, lastSlashIndex);
                prefix = partialPath.substring(lastSlashIndex + 1);
            } else {
                searchPath = this.fileManager.router.getCurrentPath();
                prefix = partialPath;
            }
            const files = await this.fileManager.api.getFiles(searchPath);
            if (!files) return [];
            return files
                .filter(item => item.is_dir && item.name.toLowerCase().startsWith(prefix.toLowerCase()))
                .slice(0, 10)
                .map(folder => ({ 
                    name: folder.name, 
                    fullPath: searchPath.endsWith('/') ? searchPath + folder.name : `${searchPath}/${folder.name}`
                }));
        } catch (error) {
            console.error('Error getting completions:', error);
            return [];
        }
    }

    async updateCompletions(path) {
        const completions = await this.getCompletions(path);
        this.displayCompletions(completions);
    }

    displayCompletions(completions) {
        if (!this.completionDropdown) return;
        this.cdCompletions = completions;
        this.selectedCompletionIndex = -1;
        const list = this.completionDropdown.querySelector('.completion-list');
        list.innerHTML = '';
        if (completions.length === 0) {
            this.hideCompletions();
            return;
        }
        completions.forEach((completion, index) => {
            const li = document.createElement('li');
            li.className = 'completion-item';
            const template = getTemplateContent('/static/templates/components/completion_item.html');
            template.querySelector('.completion-name').textContent = completion.name;
            template.querySelector('.completion-path').textContent = completion.fullPath;
            li.appendChild(template);
            li.addEventListener('click', () => {
                this.selectedCompletionIndex = index;
                this.applyCompletion();
            });
            list.appendChild(li);
        });
        this.showCompletionsDropdown();
    }

    navigateCompletion(direction) {
        if (this.cdCompletions.length === 0) return;
        const newIndex = this.selectedCompletionIndex + direction;
        if (newIndex >= 0 && newIndex < this.cdCompletions.length) {
            this.selectedCompletionIndex = newIndex;
            this.updateCompletionSelection();
        }
    }

    updateCompletionSelection() {
        this.completionDropdown.querySelectorAll('.completion-item').forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedCompletionIndex);
        });
    }

    applyCompletion() {
        if (this.selectedCompletionIndex >= 0 && this.selectedCompletionIndex < this.cdCompletions.length) {
            const completion = this.cdCompletions[this.selectedCompletionIndex];
            const searchInput = document.querySelector('.search-input');
            if (searchInput) {
                searchInput.value = `cd ${completion.fullPath}/`;
                searchInput.focus();
            }
            this.hideCompletions();
        }
    }

    showCompletionsDropdown() {
        if (this.completionDropdown) {
            this.completionDropdown.style.display = 'block';
            this.isShowingCompletions = true;
        }
    }

    hideCompletions() {
        if (this.completionDropdown) {
            this.completionDropdown.style.display = 'none';
            this.isShowingCompletions = false;
            this.selectedCompletionIndex = -1;
        }
    }

    createSearchModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay search-modal';
        modal.style.display = 'none';
        const template = getTemplateContent('/static/templates/components/search_modal.html');
        modal.appendChild(template);
        document.body.appendChild(modal);
        this.searchModal = modal;

        modal.querySelector('#search-apply').addEventListener('click', () => {
            this.applySearchOptions();
            this.hideSearchOptions();
        });
        modal.querySelector('#search-cancel').addEventListener('click', () => this.hideSearchOptions());
        modal.querySelector('.modal-close').addEventListener('click', () => this.hideSearchOptions());
    }

    showSearchOptions() {
        document.querySelector('.search-container')?.classList.add('expanded');
    }

    hideSearchOptions() {
        document.querySelector('.search-container')?.classList.remove('expanded');
        if (this.searchModal) this.searchModal.style.display = 'none';
    }

    toggleSearchOptions() {
        if (this.searchModal) {
            this.searchModal.style.display = this.searchModal.style.display === 'none' ? 'flex' : 'none';
        }
    }

    applySearchOptions() {
        if (this.searchModal) {
            this.searchOptions.useRegex = this.searchModal.querySelector('#search-use-regex').checked;
            this.searchOptions.caseSensitive = this.searchModal.querySelector('#search-case-sensitive').checked;
            this.searchOptions.scope = this.searchModal.querySelector('#search-scope').value;
        }
    }

    sortResults(results, field, direction) {
        if (!results || !Array.isArray(results)) return results;
        return results.sort((a, b) => {
            let valueA = a[field] || (typeof a[field] === 'number' ? 0 : '');
            let valueB = b[field] || (typeof b[field] === 'number' ? 0 : '');
            if (field === 'modified') {
                valueA = new Date(a.mod_time || 0).getTime();
                valueB = new Date(b.mod_time || 0).getTime();
            }
            if (typeof valueA === 'string') {
                return direction === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
            }
            return direction === 'asc' ? valueA - valueB : valueB - valueA;
        });
    }

    setSort(field) {
        if (this.sortField === field) this.toggleSortDirection();
        else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        if (this.lastSearchResults) this.redisplayResults(this.currentPage);
    }

    toggleSortDirection() {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        if (this.lastSearchResults) this.redisplayResults(this.currentPage);
    }

    async performSearch(page = 0) {
        const searchInput = document.querySelector('.search-input');
        if (!searchInput) return;
        const searchTerm = searchInput.value.trim();
        if (!searchTerm) {
            this.fileManager.ui.showToast('Search', 'Please enter a search term', 'warning');
            return;
        }
        if (!this.isInSearchMode) {
            this.isInSearchMode = true;
            this.originalViewMode = this.fileManager.ui.viewMode;
        }
        this.lastSearchTerm = searchTerm;
        this.currentPage = page;
        this.fileManager.ui.showLoading();
        try {
            const result = await this.fileManager.api.search(searchTerm, this.fileManager.router.getCurrentPath(), this.searchOptions, this.pageSize, page * this.pageSize);
            if (result && result.success) {
                this.lastSearchResults = this.sortResults(result.data || [], this.sortField, this.sortDirection);
                this.totalResults = this.lastSearchResults.length;
                if (this.fileManager.ui.viewMode === 'masonry') {
                    this.fileManager.ui.viewMode = 'grid';
                }
                this.displaySearchResults(this.lastSearchResults, searchTerm, page);
            } else {
                this.fileManager.ui.showToast('Search Error', result ? result.message : 'Unknown error', 'error');
            }
        } catch (error) {
            this.fileManager.ui.showToast('Search Error', 'Failed to perform search', 'error');
        } finally {
            this.fileManager.ui.hideLoading();
        }
    }

    async refreshSearchResults() {
        if (!this.isInSearchMode || !this.lastSearchTerm) return;
        try {
            const result = await this.fileManager.api.search(this.lastSearchTerm, this.fileManager.router.getCurrentPath(), this.searchOptions, this.pageSize, 0);
            if (result && result.success) {
                this.lastSearchResults = this.sortResults(result.data || [], this.sortField, this.sortDirection);
                this.totalResults = this.lastSearchResults.length;
                const totalPages = Math.ceil(this.lastSearchResults.length / this.pageSize);
                if (this.currentPage >= totalPages) this.currentPage = Math.max(0, totalPages - 1);
                this.displaySearchResults(this.lastSearchResults, this.lastSearchTerm, this.currentPage);
            }
        } catch (error) {
            console.error('Error refreshing search results:', error);
        }
    }

    displaySearchResults(results, searchTerm, page = 0) {
        const container = document.querySelector('.file-browser');
        if (!container) return;
        container.innerHTML = '';
        results = results || [];
        const startIndex = page * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, results.length);
        const pageResults = results.slice(startIndex, endIndex);
        const totalPages = Math.ceil(results.length / this.pageSize);

        const header = document.createElement('div');
        header.className = 'search-results-header';
        const headerTemplate = getTemplateContent('/static/templates/components/search_results_header.html');
        headerTemplate.querySelector('.search-results-count div').textContent = `Search Results for "${searchTerm}" (${results.length} found)`;
        if (results.length > this.pageSize) {
            headerTemplate.querySelector('.pagination-info').textContent = `[${page + 1}/${totalPages}] Showing ${startIndex + 1}-${endIndex} of ${results.length} results`;
        }
        const options = [];
        if (this.searchOptions.useRegex) options.push('REGEX');
        if (this.searchOptions.caseSensitive) options.push('CASE-SENSITIVE');
        if (this.searchOptions.scope === 'recursive') options.push('RECURSIVE');
        if (options.length > 0) {
            headerTemplate.querySelector('.search-options-display').textContent = `[${options.join(', ')}]`;
        }
        header.appendChild(headerTemplate);
        header.querySelector('.search-controls').appendChild(this.createPaginationControls(page, totalPages));
        container.appendChild(header);
        header.querySelector('.search-back-btn').addEventListener('click', () => this.exitSearchMode());

        const viewToggle = this.fileManager.ui.createViewToggle(false);
        container.appendChild(viewToggle);

        if (results.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-search-results';
            const noResultsTemplate = getTemplateContent('/static/templates/components/search_no_results.html');
            noResultsTemplate.querySelector('.no-search-results-text').textContent = `No files found matching "${searchTerm}"`;
            noResults.appendChild(noResultsTemplate);
            container.appendChild(noResults);
            return;
        }

        if (this.fileManager.ui.viewMode === 'list') this.renderListView(pageResults, container);
        else this.renderGridView(pageResults, container);

        if (totalPages > 1) {
            const footerPagination = document.createElement('div');
            footerPagination.className = 'search-pagination-footer';
            footerPagination.appendChild(this.createPaginationControls(page, totalPages));
            container.appendChild(footerPagination);
        }
        container.scrollTop = 0;
    }

    exitSearchMode(preventNavigation = false) {
        this.isInSearchMode = false;
        this.lastSearchResults = null;
        this.lastSearchTerm = '';
        this.currentPage = 0;
        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';
        this.isCdMode = false;
        this.isAria2cMode = false;
        this.hideCompletions();
        if (this.originalViewMode) {
            this.fileManager.ui.viewMode = this.originalViewMode;
            this.originalViewMode = null;
        }
        if (!preventNavigation) {
            this.fileManager.loadFiles(this.fileManager.router.getCurrentPath());
        }
    }

    renderGridView(files, container) {
        const fileGrid = document.createElement('div');
        fileGrid.className = 'file-grid';
        files.forEach(file => fileGrid.appendChild(this.fileManager.ui.createFileItem(file)));
        container.appendChild(fileGrid);
    }

    renderListView(files, container) {
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-view-container';
        const table = document.createElement('table');
        table.className = 'table-view';
        const thead = this.fileManager.ui.createListViewHeader(this.sortField, this.sortDirection);
        thead.querySelectorAll('.sortable').forEach(th => th.addEventListener('click', () => this.setSort(th.dataset.sort)));
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        files.forEach(file => tbody.appendChild(this.fileManager.ui.createTableRow(file)));
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
    }

    createPaginationControls(currentPage, totalPages) {
        if (totalPages <= 1) return document.createDocumentFragment();
        const controls = document.createElement('div');
        controls.className = 'pagination-controls';
        
        const createNavBtn = (text, page, disabled = false) => {
            const btn = document.createElement('button');
            btn.className = 'pagination-btn';
            btn.textContent = text;
            btn.disabled = disabled;
            if (!disabled) btn.addEventListener('click', () => this.performSearch(page));
            return btn;
        };

        const createPageBtn = (text, page) => {
            const btn = document.createElement('button');
            btn.className = 'page-btn';
            btn.textContent = text;
            btn.addEventListener('click', () => this.performSearch(page));
            return btn;
        };

        controls.appendChild(createNavBtn('← Previous', currentPage - 1, currentPage === 0));
        
        const pageNumbers = document.createElement('div');
        pageNumbers.className = 'page-numbers';
        
        const startPage = Math.max(0, currentPage - 2);
        const endPage = Math.min(totalPages - 1, currentPage + 2);

        if (startPage > 0) {
            pageNumbers.appendChild(createPageBtn('1', 0));
            if (startPage > 1) pageNumbers.insertAdjacentHTML('beforeend', '<span class="page-ellipsis">...</span>');
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = createPageBtn(i + 1, i);
            if (i === currentPage) btn.classList.add('active');
            pageNumbers.appendChild(btn);
        }

        if (endPage < totalPages - 1) {
            if (endPage < totalPages - 2) pageNumbers.insertAdjacentHTML('beforeend', '<span class="page-ellipsis">...</span>');
            pageNumbers.appendChild(createPageBtn(totalPages, totalPages - 1));
        }

        controls.appendChild(pageNumbers);
        controls.appendChild(createNavBtn('Next →', currentPage + 1, currentPage === totalPages - 1));
        return controls;
    }

    redisplayResults(page) {
        if (this.lastSearchResults && this.lastSearchTerm) {
            this.lastSearchResults = this.sortResults(this.lastSearchResults, this.sortField, this.sortDirection);
            this.displaySearchResults(this.lastSearchResults, this.lastSearchTerm, page);
        }
    }

    newSearch() {
        this.currentPage = 0;
        this.performSearch(0);
    }
}