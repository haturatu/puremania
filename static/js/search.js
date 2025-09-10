class SearchHandler {
    constructor() {
        this.isSearchOpen = false;
        this.searchOptions = {
            useRegex: false,
            caseSensitive: false,
            scope: 'current'
        };
        this.lastSearchTerm = '';
        this.lastSearchResults = null;
        this.currentPage = 0;
        this.pageSize = 100;
        this.totalResults = 0;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.createSearchModal();
    }
    
    bindEvents() {
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.addEventListener('focus', () => {
                this.showSearchOptions();
            });
            
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }
        
        const searchOptions = document.querySelector('.search-options');
        if (searchOptions) {
            searchOptions.addEventListener('click', () => {
                this.toggleSearchOptions();
            });
        }
    }
    
    createSearchModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay search-modal';
        modal.style.display = 'none';
        
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="modal-title">Search Options</div>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="search-option">
                        <label>
                            <input type="checkbox" id="search-use-regex" ${this.searchOptions.useRegex ? 'checked' : ''}>
                            Use regular expression
                        </label>
                    </div>
                    
                    <div class="search-option">
                        <label>
                            <input type="checkbox" id="search-case-sensitive" ${this.searchOptions.caseSensitive ? 'checked' : ''}>
                            Case sensitive
                        </label>
                    </div>
                    
                    <div class="search-option">
                        <label>Search scope:</label>
                        <select id="search-scope">
                            <option value="current" ${this.searchOptions.scope === 'current' ? 'selected' : ''}>Current folder</option>
                            <option value="recursive" ${this.searchOptions.scope === 'recursive' ? 'selected' : ''}>All subfolders</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="search-apply">Apply</button>
                    <button class="btn" id="search-cancel">Cancel</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.searchModal = modal;
        
        modal.querySelector('#search-apply').addEventListener('click', () => {
            this.applySearchOptions();
            this.hideSearchOptions();
        });
        
        modal.querySelector('#search-cancel').addEventListener('click', () => {
            this.hideSearchOptions();
        });
        
        modal.querySelector('.modal-close').addEventListener('click', () => {
            this.hideSearchOptions();
        });
    }
    
    showSearchOptions() {
        if (!this.isSearchOpen) {
            this.isSearchOpen = true;
            const searchContainer = document.querySelector('.search-container');
            if (searchContainer) {
                searchContainer.classList.add('expanded');
            }
        }
    }
    
    hideSearchOptions() {
        this.isSearchOpen = false;
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.classList.remove('expanded');
        }
        if (this.searchModal) {
            this.searchModal.style.display = 'none';
        }
    }
    
    toggleSearchOptions() {
        if (this.searchModal) {
            if (this.searchModal.style.display === 'none') {
                this.searchModal.style.display = 'flex';
            } else {
                this.searchModal.style.display = 'none';
            }
        }
    }
    
    applySearchOptions() {
        if (this.searchModal) {
            const useRegex = document.getElementById('search-use-regex');
            const caseSensitive = document.getElementById('search-case-sensitive');
            const scope = document.getElementById('search-scope');
            
            if (useRegex && caseSensitive && scope) {
                this.searchOptions.useRegex = useRegex.checked;
                this.searchOptions.caseSensitive = caseSensitive.checked;
                this.searchOptions.scope = scope.value;
            }
        }
    }
    
    async performSearch(page = 0) {
        const searchInput = document.querySelector('.search-input');
        if (!searchInput) return;
        
        const searchTerm = searchInput.value.trim();
        
        if (!searchTerm) {
            if (window.fileManager && window.fileManager.showToast) {
                window.fileManager.showToast('Search', 'Please enter a search term', 'warning');
            }
            return;
        }
        
        this.lastSearchTerm = searchTerm;
        this.currentPage = page;
        
        try {
            if (window.fileManager && window.fileManager.showLoading) {
                window.fileManager.showLoading();
            }
            
            const offset = page * this.pageSize;
            
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    term: searchTerm,
                    path: window.fileManager ? window.fileManager.currentPath : '/',
                    useRegex: this.searchOptions.useRegex,
                    caseSensitive: this.searchOptions.caseSensitive,
                    scope: this.searchOptions.scope,
                    maxResults: 10000, // より多くの結果を取得してクライアント側でページネーション
                    offset: offset,
                    limit: this.pageSize
                })
            });
            
            const result = await response.json();
            
            if (result && result.success) {
                this.lastSearchResults = Array.isArray(result.data) ? result.data : [];
                this.totalResults = this.lastSearchResults.length;
                this.displaySearchResults(this.lastSearchResults, searchTerm, page);
            } else {
                if (window.fileManager && window.fileManager.showToast) {
                    window.fileManager.showToast('Search Error', result ? result.message : 'Unknown error', 'error');
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            if (window.fileManager && window.fileManager.showToast) {
                window.fileManager.showToast('Search Error', 'Failed to perform search', 'error');
            }
        } finally {
            if (window.fileManager && window.fileManager.hideLoading) {
                window.fileManager.hideLoading();
            }
        }
    }
    
    displaySearchResults(results, searchTerm, page = 0) {
        const container = document.querySelector('.file-browser');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 結果がnullまたはundefinedの場合の処理
        if (!results) {
            results = [];
        }
        
        // ページネーション用の結果を計算
        const startIndex = page * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, results.length);
        const pageResults = results.slice(startIndex, endIndex);
        const totalPages = Math.ceil(results.length / this.pageSize);
        
        const header = document.createElement('div');
        header.className = 'search-results-header';
        
        // ページネーション情報を含むヘッダー
        let paginationInfo = '';
        if (results.length > this.pageSize) {
            paginationInfo = `<div class="pagination-info">
                [${page + 1}/${totalPages}] Showing ${startIndex + 1}-${endIndex} of ${results.length} results
            </div>`;
        }
        
        // 検索オプション情報
        let searchOptions = '';
        if (this.searchOptions.useRegex || this.searchOptions.caseSensitive || this.searchOptions.scope === 'recursive') {
            const options = [];
            if (this.searchOptions.useRegex) options.push('REGEX');
            if (this.searchOptions.caseSensitive) options.push('CASE-SENSITIVE');
            if (this.searchOptions.scope === 'recursive') options.push('RECURSIVE');
            searchOptions = `<div style="font-size: 0.8em; color: var(--accent-primary); margin-top: 3px;">[${options.join(', ')}]</div>`;
        }
        
        header.innerHTML = `
            <div class="search-results-count">
                <div>Search Results for "${searchTerm}" (${results.length} found)</div>
                ${searchOptions}
                ${paginationInfo}
            </div>
            <div class="search-controls">
                <button class="search-back-btn" onclick="window.fileManager.loadFiles(window.fileManager.currentPath)">
                    ← Back to Files
                </button>
                ${this.createPaginationControls(page, totalPages)}
            </div>
        `;
        container.appendChild(header);
        
        if (results.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-search-results';
            noResults.innerHTML = `
                <div class="no-search-results-icon">🔍</div>
                <div class="no-search-results-text">No files found matching "${searchTerm}"</div>
                <div class="no-search-results-subtext">Try different search terms or check your search options</div>
            `;
            container.appendChild(noResults);
            return;
        }
        
        const fileGrid = document.createElement('div');
        fileGrid.className = 'file-grid';
        
        pageResults.forEach(file => {
            const fileItem = window.fileManager.createFileItem(file);
            fileGrid.appendChild(fileItem);
        });
        
        container.appendChild(fileGrid);
        
        // ページネーションコントロールを下部にも追加
        if (totalPages > 1) {
            const footerPagination = document.createElement('div');
            footerPagination.className = 'search-pagination-footer';
            footerPagination.innerHTML = this.createPaginationControls(page, totalPages);
            container.appendChild(footerPagination);
        }
        
        // 検索結果のスクロールを最上部にリセット
        container.scrollTop = 0;
    }
    
    createPaginationControls(currentPage, totalPages) {
        if (totalPages <= 1) return '';
        
        const prevDisabled = currentPage === 0 ? 'disabled' : '';
        const nextDisabled = currentPage === totalPages - 1 ? 'disabled' : '';
        
        let pageNumbers = '';
        
        // ページ番号ボタンの生成（最大5つ表示）
        const startPage = Math.max(0, currentPage - 2);
        const endPage = Math.min(totalPages - 1, currentPage + 2);
        
        // 最初のページ
        if (startPage > 0) {
            pageNumbers += `<button class="page-btn" onclick="window.searchHandler.performSearch(0)">1</button>`;
            if (startPage > 1) {
                pageNumbers += '<span class="page-ellipsis">...</span>';
            }
        }
        
        // 中央のページ番号
        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === currentPage ? 'active' : '';
            pageNumbers += `<button class="page-btn ${activeClass}" onclick="window.searchHandler.performSearch(${i})">${i + 1}</button>`;
        }
        
        // 最後のページ
        if (endPage < totalPages - 1) {
            if (endPage < totalPages - 2) {
                pageNumbers += '<span class="page-ellipsis">...</span>';
            }
            pageNumbers += `<button class="page-btn" onclick="window.searchHandler.performSearch(${totalPages - 1})">${totalPages}</button>`;
        }
        
        return `
            <div class="pagination-controls">
                <button class="pagination-btn ${prevDisabled}" 
                        onclick="window.searchHandler.performSearch(${currentPage - 1})"
                        ${prevDisabled}>
                    ← Previous
                </button>
                <div class="page-numbers">
                    ${pageNumbers}
                </div>
                <button class="pagination-btn ${nextDisabled}" 
                        onclick="window.searchHandler.performSearch(${currentPage + 1})"
                        ${nextDisabled}>
                    Next →
                </button>
            </div>
        `;
    }
    
    // 検索結果の再表示（ページ変更時に使用）
    redisplayResults(page) {
        if (this.lastSearchResults && this.lastSearchTerm) {
            this.displaySearchResults(this.lastSearchResults, this.lastSearchTerm, page);
        }
    }
    
    // 新しい検索を実行
    newSearch() {
        this.currentPage = 0;
        this.performSearch(0);
    }
}

window.searchHandler = new SearchHandler();
