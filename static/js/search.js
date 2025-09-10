class SearchHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
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
        
        // ソート関連の状態
        this.sortField = 'name'; // デフォルトソートフィールド
        this.sortDirection = 'asc'; // デフォルトソート方向
        
        // 検索状態の管理
        this.isInSearchMode = false;
        this.originalViewMode = null; // 検索前のビューモードを保存
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.createSearchModal();
        this.setupFileOperationListeners();
    }
    
    // ファイル操作後の自動更新リスナーを設定
    setupFileOperationListeners() {
        // FileManagerのファイル操作メソッドをフック
        const originalMethods = {
            deleteFile: this.fileManager.deleteFile.bind(this.fileManager),
            deleteSelectedFiles: this.fileManager.deleteSelectedFiles.bind(this.fileManager),
            renameFile: this.fileManager.renameFile.bind(this.fileManager),
            moveFile: this.fileManager.moveFile.bind(this.fileManager),
            moveSelected: this.fileManager.moveSelected.bind(this.fileManager),
            createNewFile: this.fileManager.createNewFile.bind(this.fileManager),
            createNewFolder: this.fileManager.createNewFolder.bind(this.fileManager)
        };

        // ファイル削除操作のフック
        this.fileManager.deleteFile = async (path) => {
            const result = await originalMethods.deleteFile(path);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        this.fileManager.deleteSelectedFiles = async () => {
            const result = await originalMethods.deleteSelectedFiles();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // ファイル名変更操作のフック
        this.fileManager.renameFile = async (path) => {
            const result = await originalMethods.renameFile(path);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // ファイル移動操作のフック
        this.fileManager.moveFile = async (sourcePath) => {
            const result = await originalMethods.moveFile(sourcePath);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        this.fileManager.moveSelected = async () => {
            const result = await originalMethods.moveSelected();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // 新規ファイル作成のフック
        this.fileManager.createNewFile = async () => {
            const result = await originalMethods.createNewFile();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        this.fileManager.createNewFolder = async () => {
            const result = await originalMethods.createNewFolder();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // FileManagerのsetViewModeをフック
        const originalSetViewMode = this.fileManager.setViewMode.bind(this.fileManager);
        this.fileManager.setViewMode = (mode) => {
            if (this.isInSearchMode && this.lastSearchResults && this.lastSearchTerm) {
                // 検索モード中の場合、ビュー切り替え後に検索結果を再表示
                this.fileManager.viewMode = mode;
                this.redisplayResults(this.currentPage);
            } else {
                originalSetViewMode(mode);
            }
        };
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
    
    // ソート機能の追加
    sortResults(results, field, direction) {
        if (!results || !Array.isArray(results)) return results;
        
        return results.sort((a, b) => {
            let valueA, valueB;
            
            switch (field) {
                case 'name':
                    valueA = a.name || '';
                    valueB = b.name || '';
                    break;
                case 'type':
                    valueA = a.mime_type || '';
                    valueB = b.mime_type || '';
                    break;
                case 'size':
                    valueA = a.size || 0;
                    valueB = b.size || 0;
                    break;
                case 'modified':
                    valueA = new Date(a.mod_time || 0).getTime();
                    valueB = new Date(b.mod_time || 0).getTime();
                    break;
                default:
                    valueA = a.name || '';
                    valueB = b.name || '';
            }
            
            // 文字列比較
            if (typeof valueA === 'string' && typeof valueB === 'string') {
                return direction === 'asc' 
                    ? valueA.localeCompare(valueB)
                    : valueB.localeCompare(valueA);
            }
            
            // 数値比較
            if (typeof valueA === 'number' && typeof valueB === 'number') {
                return direction === 'asc' ? valueA - valueB : valueB - valueA;
            }
            
            return 0;
        });
    }
    
    // ソートフィールドの設定
    setSort(field) {
        if (this.sortField === field) {
            this.toggleSortDirection();
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        
        if (this.lastSearchResults) {
            this.redisplayResults(this.currentPage);
        }
    }
    
    // ソート方向の切り替え
    toggleSortDirection() {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        if (this.lastSearchResults) {
            this.redisplayResults(this.currentPage);
        }
    }
    
    async performSearch(page = 0) {
        const searchInput = document.querySelector('.search-input');
        if (!searchInput) return;
        
        const searchTerm = searchInput.value.trim();
        
        if (!searchTerm) {
            if (this.fileManager && this.fileManager.showToast) {
                this.fileManager.showToast('Search', 'Please enter a search term', 'warning');
            }
            return;
        }
        
        // 検索モードに入る際の状態保存
        if (!this.isInSearchMode) {
            this.isInSearchMode = true;
            this.originalViewMode = this.fileManager.viewMode;
        }
        
        this.lastSearchTerm = searchTerm;
        this.currentPage = page;
        
        try {
            if (this.fileManager && this.fileManager.showLoading) {
                this.fileManager.showLoading();
            }
            
            const offset = page * this.pageSize;
            
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    term: searchTerm,
                    path: this.fileManager ? this.fileManager.currentPath : '/',
                    useRegex: this.searchOptions.useRegex,
                    caseSensitive: this.searchOptions.caseSensitive,
                    scope: this.searchOptions.scope,
                    maxResults: 10000,
                    offset: offset,
                    limit: this.pageSize
                })
            });
            
            const result = await response.json();
            
            if (result && result.success) {
                this.lastSearchResults = Array.isArray(result.data) ? result.data : [];
                // 取得した結果をソート
                this.lastSearchResults = this.sortResults(this.lastSearchResults, this.sortField, this.sortDirection);
                this.totalResults = this.lastSearchResults.length;
                this.displaySearchResults(this.lastSearchResults, searchTerm, page);
            } else {
                if (this.fileManager && this.fileManager.showToast) {
                    this.fileManager.showToast('Search Error', result ? result.message : 'Unknown error', 'error');
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            if (this.fileManager && this.fileManager.showToast) {
                this.fileManager.showToast('Search Error', 'Failed to perform search', 'error');
            }
        } finally {
            if (this.fileManager && this.fileManager.hideLoading) {
                this.fileManager.hideLoading();
            }
        }
    }
    
    // 検索結果の自動更新
    async refreshSearchResults() {
        if (!this.isInSearchMode || !this.lastSearchTerm) {
            return;
        }
        
        try {
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    term: this.lastSearchTerm,
                    path: this.fileManager ? this.fileManager.currentPath : '/',
                    useRegex: this.searchOptions.useRegex,
                    caseSensitive: this.searchOptions.caseSensitive,
                    scope: this.searchOptions.scope,
                    maxResults: 10000,
                    offset: 0,
                    limit: this.pageSize
                })
            });
            
            const result = await response.json();
            
            if (result && result.success) {
                this.lastSearchResults = Array.isArray(result.data) ? result.data : [];
                this.lastSearchResults = this.sortResults(this.lastSearchResults, this.sortField, this.sortDirection);
                this.totalResults = this.lastSearchResults.length;
                
                // 現在のページが結果数を超えている場合は最初のページに戻る
                const totalPages = Math.ceil(this.lastSearchResults.length / this.pageSize);
                if (this.currentPage >= totalPages) {
                    this.currentPage = Math.max(0, totalPages - 1);
                }
                
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
        
        if (!results) {
            results = [];
        }
        
        const startIndex = page * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, results.length);
        const pageResults = results.slice(startIndex, endIndex);
        const totalPages = Math.ceil(results.length / this.pageSize);
        
        const header = document.createElement('div');
        header.className = 'search-results-header';
        
        let paginationInfo = '';
        if (results.length > this.pageSize) {
            paginationInfo = `<div class="pagination-info">
                [${page + 1}/${totalPages}] Showing ${startIndex + 1}-${endIndex} of ${results.length} results
            </div>`;
        }
        
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
                <button class="search-back-btn" onclick="window.fileManager.searchHandler.exitSearchMode()">
                    ← Back to Files
                </button>
                ${this.createPaginationControls(page, totalPages)}
        `;
        container.appendChild(header);
        
        // ビューモード切り替えボタンを追加（検索モード専用の処理）
        const viewToggle = document.createElement('div');
        viewToggle.className = 'view-toggle';
        viewToggle.innerHTML = `
            <button class="view-toggle-btn ${this.fileManager.viewMode === 'grid' ? 'active' : ''}" 
                    data-view="grid" onclick="window.fileManager.setViewMode('grid')">Grid</button>
            <button class="view-toggle-btn ${this.fileManager.viewMode === 'list' ? 'active' : ''}" 
                    data-view="list" onclick="window.fileManager.setViewMode('list')">List</button>
        `;
        container.appendChild(viewToggle);
        
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
        
        // FileManagerの表示モードに合わせて表示
        if (this.fileManager.viewMode === 'list') {
            this.renderListView(pageResults, container);
        } else {
            this.renderGridView(pageResults, container);
        }
        
        // ページネーションコントロールを下部にも追加
        if (totalPages > 1) {
            const footerPagination = document.createElement('div');
            footerPagination.className = 'search-pagination-footer';
            footerPagination.innerHTML = this.createPaginationControls(page, totalPages);
            container.appendChild(footerPagination);
        }
        
        container.scrollTop = 0;
    }
    
    // 検索モードを終了して通常表示に戻る
    exitSearchMode() {
        this.isInSearchMode = false;
        this.lastSearchResults = null;
        this.lastSearchTerm = '';
        this.currentPage = 0;
        
        // 検索入力をクリア
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        
        // 元のビューモードに復元
        if (this.originalViewMode) {
            this.fileManager.viewMode = this.originalViewMode;
            this.originalViewMode = null;
        }
        
        // 通常のファイル一覧を再読み込み
        this.fileManager.loadFiles(this.fileManager.currentPath);
    }
    
    // Grid表示のレンダリング
    renderGridView(files, container) {
        const fileGrid = document.createElement('div');
        fileGrid.className = 'file-grid';
        
        files.forEach(file => {
            const fileItem = this.fileManager.createFileItem(file);
            fileGrid.appendChild(fileItem);
        });
        
        container.appendChild(fileGrid);
    }
    
    // List表示のレンダリング
    renderListView(files, container) {
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-view-container';
        
        const table = document.createElement('table');
        table.className = 'table-view';
        
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th class="sortable ${this.sortField === 'name' ? this.sortDirection : ''}" 
                    onclick="window.fileManager.searchHandler.setSort('name')">
                    Name ${this.sortField === 'name' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortField === 'size' ? this.sortDirection : ''}" 
                    onclick="window.fileManager.searchHandler.setSort('size')">
                    Size ${this.sortField === 'size' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortField === 'modified' ? this.sortDirection : ''}" 
                    onclick="window.fileManager.searchHandler.setSort('modified')">
                    Modified ${this.sortField === 'modified' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortField === 'type' ? this.sortDirection : ''}" 
                    onclick="window.fileManager.searchHandler.setSort('type')">
                    Type ${this.sortField === 'type' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
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
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
    }
    
    // テーブル行の作成
    createTableRow(file) {
        const tr = document.createElement('tr');
        tr.className = 'file-item';
        this.fileManager.setFileItemData(tr, file);
        
        tr.innerHTML = `
            <td>
                <div class="file-icon ${this.fileManager.getFileIconClass(file)}"></div>
                <span class="file-name">${file.name}</span>
            </td>
            <td>${file.is_dir ? '-' : this.fileManager.formatFileSize(file.size)}</td>
            <td>${new Date(file.mod_time).toLocaleString()}</td>
            <td>${file.is_dir ? 'Folder' : (file.mime_type || 'Unknown')}</td>
            <td>
                ${!file.is_dir ? `
                    <button class="file-action-btn" data-action="download" title="Download">⬇</button>
                    ${file.is_editable ? '<button class="file-action-btn" data-action="edit" title="Edit">✏</button>' : ''}
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
        
        // クリックイベントのバインド
        tr.addEventListener('click', (e) => {
            if (!e.target.matches('.file-action-btn, .file-action-btn *')) {
                this.fileManager.handleFileClick(tr);
            }
        });
        
        tr.addEventListener('dblclick', () => {
            this.fileManager.handleFileDoubleClick(tr);
        });
        
        // アクションボタンのイベントバインド
        tr.querySelectorAll('.file-action-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.fileManager.handleFileActionClick(button, tr);
            });
        });
        
        return tr;
    }
    
    createPaginationControls(currentPage, totalPages) {
        if (totalPages <= 1) return '';
        
        const prevDisabled = currentPage === 0 ? 'disabled' : '';
        const nextDisabled = currentPage === totalPages - 1 ? 'disabled' : '';
        
        let pageNumbers = '';
        
        const startPage = Math.max(0, currentPage - 2);
        const endPage = Math.min(totalPages - 1, currentPage + 2);
        
        if (startPage > 0) {
            pageNumbers += `<button class="page-btn" onclick="window.fileManager.searchHandler.performSearch(0)">1</button>`;
            if (startPage > 1) {
                pageNumbers += '<span class="page-ellipsis">...</span>';
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === currentPage ? 'active' : '';
            pageNumbers += `<button class="page-btn ${activeClass}" onclick="window.fileManager.searchHandler.performSearch(${i})">${i + 1}</button>`;
        }
        
        if (endPage < totalPages - 1) {
            if (endPage < totalPages - 2) {
                pageNumbers += '<span class="page-ellipsis">...</span>';
            }
            pageNumbers += `<button class="page-btn" onclick="window.fileManager.searchHandler.performSearch(${totalPages - 1})">${totalPages}</button>`;
        }
        
        return `
            <div class="pagination-controls">
                <button class="pagination-btn ${prevDisabled}" 
                        onclick="window.fileManager.searchHandler.performSearch(${currentPage - 1})"
                        ${prevDisabled}>
                    ← Previous
                </button>
                <div class="page-numbers">
                    ${pageNumbers}
                </div>
                <button class="pagination-btn ${nextDisabled}" 
                        onclick="window.fileManager.searchHandler.performSearch(${currentPage + 1})"
                        ${nextDisabled}>
                    Next →
                </button>
            </div>
        `;
    }
    
    redisplayResults(page) {
        if (this.lastSearchResults && this.lastSearchTerm) {
            // 現在のソート設定で再ソート
            this.lastSearchResults = this.sortResults(this.lastSearchResults, this.sortField, this.sortDirection);
            this.displaySearchResults(this.lastSearchResults, this.lastSearchTerm, page);
        }
    }
    
    newSearch() {
        this.currentPage = 0;
        this.performSearch(0);
    }
}
