import { getTemplateContent } from './template.js';
import { createModalOverlay, bindModalClose, hideModalOverlay, showModalOverlay } from './modal.js';
import { TEMPLATES } from './template-registry.js';

export class SearchHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.isSearchOpen = false;
        this.searchOptions = { useRegex: false, caseSensitive: false, scope: 'current' };
        this.lastSearchTerm = '';
        this.lastSearchResults = null;
        this.currentPage = 0;
        this.pageSize = 100;
        this.searchController = null;
        this.cursorHistory = [''];
        this.nextCursor = '';
        this.hasMore = false;
        this.refreshTimer = null;
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

    get isInSearchMode() { return this.fileManager.store.getState().search.active; }
    set isInSearchMode(active) { this.fileManager.store.update('search', { active }, 'SEARCH_MODE_CHANGED'); }
    get isCdMode() { return this.fileManager.store.getState().search.commandMode === 'cd'; }
    set isCdMode(active) {
        const current = this.fileManager.store.getState().search.commandMode;
        this.fileManager.store.update('search', { commandMode: active ? 'cd' : current === 'cd' ? null : current }, 'SEARCH_COMMAND_MODE_CHANGED');
    }
    get isAria2cMode() { return this.fileManager.store.getState().search.commandMode === 'aria2c'; }
    set isAria2cMode(active) {
        const current = this.fileManager.store.getState().search.commandMode;
        this.fileManager.store.update('search', { commandMode: active ? 'aria2c' : current === 'aria2c' ? null : current }, 'SEARCH_COMMAND_MODE_CHANGED');
    }
    get lastSearchTerm() { return this.fileManager.store.getState().search.query; }
    set lastSearchTerm(query) { this.fileManager.store.update('search', { query }, 'SEARCH_QUERY_CHANGED'); }
    get lastSearchResults() { return this.fileManager.store.getState().search.results; }
    set lastSearchResults(results) { this.fileManager.store.update('search', { results }, 'SEARCH_RESULTS_CHANGED'); }
    get currentPage() { return this.fileManager.store.getState().search.page; }
    set currentPage(page) { this.fileManager.store.update('search', { page }, 'SEARCH_PAGE_CHANGED'); }
    get cursorHistory() { return this.fileManager.store.getState().search.cursorHistory; }
    set cursorHistory(cursorHistory) { this.fileManager.store.update('search', { cursorHistory }, 'SEARCH_CURSORS_CHANGED'); }
    get nextCursor() { return this.fileManager.store.getState().search.nextCursor; }
    set nextCursor(nextCursor) { this.fileManager.store.update('search', { nextCursor }, 'SEARCH_CURSOR_CHANGED'); }
    get hasMore() { return this.fileManager.store.getState().search.hasMore; }
    set hasMore(hasMore) { this.fileManager.store.update('search', { hasMore }, 'SEARCH_CURSOR_CHANGED'); }

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
        const template = getTemplateContent(TEMPLATES.completionDropdown);
        dropdown.appendChild(template);
        document.querySelector('.search-container')?.appendChild(dropdown);
        this.completionDropdown = dropdown;
    }

    setupFileOperationListeners() {
        this.fileManager.eventBus.addEventListener('files-mutated', () => {
            if (this.isInSearchMode && this.lastSearchTerm) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = setTimeout(() => this.refreshSearchResults(), 100);
            }
        });
        this.fileManager.eventBus.addEventListener('view-change-requested', event => {
            if (this.isInSearchMode && this.lastSearchResults && this.lastSearchTerm) {
                event.preventDefault();
                this.fileManager.ui.viewMode = event.detail.mode;
                this.redisplayResults(this.currentPage);
            }
        });
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
            const result = await this.fileManager.api.getFiles(normalizedPath, { useCache: false });
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
            const template = getTemplateContent(TEMPLATES.completionItem);
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
        const template = getTemplateContent(TEMPLATES.searchModal);
        const modal = createModalOverlay({ className: 'search-modal', hidden: true, content: template });
        this.searchModal = modal;

        modal.querySelector('#search-apply').addEventListener('click', () => {
            this.applySearchOptions();
            this.hideSearchOptions();
        });
        modal.querySelector('#search-cancel').addEventListener('click', () => this.hideSearchOptions());
        bindModalClose(modal, { onClose: () => this.hideSearchOptions() });
    }

    showSearchOptions() {
        document.querySelector('.search-container')?.classList.add('expanded');
    }

    hideSearchOptions() {
        document.querySelector('.search-container')?.classList.remove('expanded');
        if (this.searchModal) hideModalOverlay(this.searchModal);
    }

    toggleSearchOptions() {
        if (this.searchModal) {
            if (this.searchModal.style.display === 'none') {
                showModalOverlay(this.searchModal);
            } else {
                hideModalOverlay(this.searchModal);
            }
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
        if (page === 0) this.cursorHistory = [''];
        const cursor = this.cursorHistory[page] ?? '';
        const requestId = this.fileManager.store.getState().search.requestId + 1;
        this.fileManager.store.update('search', { requestId, query: searchTerm, status: 'loading' }, 'SEARCH_STARTED');
        this.searchController?.abort();
        const controller = new AbortController();
        this.searchController = controller;
        this.fileManager.ui.showLoading();
        try {
            const result = await this.fileManager.api.search(searchTerm, this.fileManager.router.getCurrentPath(), this.searchOptions, this.pageSize, cursor, controller.signal);
            if (requestId !== this.fileManager.store.getState().search.requestId || controller.signal.aborted) return;
            if (result && result.success) {
                const searchPage = result.data || {};
                this.lastSearchResults = this.sortResults(searchPage.data || [], this.sortField, this.sortDirection);
                this.nextCursor = searchPage.nextCursor || '';
                this.hasMore = Boolean(searchPage.hasMore);
                const cursorHistory = this.cursorHistory.slice(0, page + 1);
                if (this.hasMore) cursorHistory[page + 1] = this.nextCursor;
                this.cursorHistory = cursorHistory;
                if (this.fileManager.ui.viewMode === 'masonry') {
                    this.fileManager.ui.viewMode = 'grid';
                }
                this.displaySearchResults(this.lastSearchResults, searchTerm, page);
                this.fileManager.store.update('search', { status: this.lastSearchResults.length ? 'ready' : 'empty' }, 'SEARCH_COMPLETED');
            } else {
                this.fileManager.ui.showToast('Search Error', result ? result.message : 'Unknown error', 'error');
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
            if (requestId !== this.fileManager.store.getState().search.requestId) return;
            this.fileManager.store.update('search', { status: 'error' }, 'SEARCH_FAILED');
            this.fileManager.ui.showToast('Search Error', 'Failed to perform search', 'error');
        } finally {
            this.fileManager.ui.hideLoading();
        }
    }

    async refreshSearchResults() {
        if (!this.isInSearchMode || !this.lastSearchTerm) return;
        try {
            await this.performSearch(this.currentPage);
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
        const endIndex = startIndex + results.length;

        const header = document.createElement('div');
        header.className = 'search-results-header';
        const headerTemplate = getTemplateContent(TEMPLATES.searchResultsHeader);
        headerTemplate.querySelector('.search-results-count div').textContent = `Search Results for "${searchTerm}"`;
        headerTemplate.querySelector('.pagination-info').textContent = results.length
            ? `Page ${page + 1} · Showing ${startIndex + 1}-${endIndex}${this.hasMore ? '+' : ''}`
            : `Page ${page + 1}`;
        const options = [];
        if (this.searchOptions.useRegex) options.push('REGEX');
        if (this.searchOptions.caseSensitive) options.push('CASE-SENSITIVE');
        if (this.searchOptions.scope === 'recursive') options.push('RECURSIVE');
        if (options.length > 0) {
            headerTemplate.querySelector('.search-options-display').textContent = `[${options.join(', ')}]`;
        }
        header.appendChild(headerTemplate);
        header.querySelector('.search-controls').appendChild(this.createPaginationControls(page, this.hasMore));
        container.appendChild(header);
        header.querySelector('.search-back-btn').addEventListener('click', () => this.exitSearchMode());

        const viewToggle = this.fileManager.ui.createViewToggle(false);
        container.appendChild(viewToggle);

        if (results.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-search-results';
            const noResultsTemplate = getTemplateContent(TEMPLATES.searchNoResults);
            noResultsTemplate.querySelector('.no-search-results-text').textContent = `No files found matching "${searchTerm}"`;
            noResults.appendChild(noResultsTemplate);
            container.appendChild(noResults);
            return;
        }

        this.fileManager.ui.renderSearchResultsFiles(
            results,
            container,
            this.sortField,
            this.sortDirection,
            (field) => this.setSort(field)
        );

        if (page > 0 || this.hasMore) {
            const footerPagination = document.createElement('div');
            footerPagination.className = 'search-pagination-footer';
            footerPagination.appendChild(this.createPaginationControls(page, this.hasMore));
            container.appendChild(footerPagination);
        }
        container.scrollTop = 0;
    }

    exitSearchMode(preventNavigation = false) {
        this.isInSearchMode = false;
        this.lastSearchResults = null;
        this.lastSearchTerm = '';
        this.currentPage = 0;
        this.fileManager.store.update('search', { active: false, query: '', status: 'idle', commandMode: null }, 'SEARCH_EXITED');
        this.searchController?.abort();
        this.searchController = null;
        this.cursorHistory = [''];
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

    createPaginationControls(currentPage, hasMore) {
        if (currentPage === 0 && !hasMore) return document.createDocumentFragment();
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

        controls.appendChild(createNavBtn('← Previous', currentPage - 1, currentPage === 0));
        const pageLabel = document.createElement('span');
        pageLabel.className = 'pagination-info';
        pageLabel.textContent = `Page ${currentPage + 1}`;
        controls.appendChild(pageLabel);
        controls.appendChild(createNavBtn('Next →', currentPage + 1, !hasMore));
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
