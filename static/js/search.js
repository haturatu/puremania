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
    
    async performSearch() {
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
        
        try {
            if (window.fileManager && window.fileManager.showLoading) {
                window.fileManager.showLoading();
            }
            
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
                    maxResults: 100
                })
            });
            
            const result = await response.json();
            this.lastSearchResults = result;
            
            if (result && result.success) {
                this.displaySearchResults(result.data, searchTerm);
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
    
    displaySearchResults(results, searchTerm) {
        const container = document.querySelector('.file-browser');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 結果がnullまたはundefinedの場合の処理
        if (!results) {
            results = [];
        }
        
        const header = document.createElement('div');
        header.className = 'search-results-header';
        header.innerHTML = `
            <div class="search-results-count">
                Search Results for "${searchTerm}" (${results.length} found)
            </div>
            <button class="search-back-btn" onclick="window.fileManager.loadFiles(window.fileManager.currentPath)">
                ← Back to Files
            </button>
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
        
        results.forEach(file => {
            const fileItem = window.fileManager.createFileItem(file);
            fileGrid.appendChild(fileItem);
        });
        
        container.appendChild(fileGrid);
    }
}
