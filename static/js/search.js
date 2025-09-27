export class SearchHandler {
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
        
        // cdコマンドとTab補完関連の状態
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
    
    // Tab補完用のドロップダウンを作成
    createCompletionDropdown() {
        const dropdown = document.createElement('div');
        dropdown.className = 'cd-completion-dropdown';
        dropdown.style.display = 'none';
        dropdown.innerHTML = '<ul class="completion-list"></ul>';
        
        // 検索入力の親要素に追加
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.appendChild(dropdown);
        }
        
        this.completionDropdown = dropdown;
    }
    
    // ファイル操作後の自動更新リスナーを設定
    setupFileOperationListeners() {
        const api = this.fileManager.api;
        const ui = this.fileManager.ui;

        // FileManagerのファイル操作メソッドをフック
        const originalMethods = {
            deleteFile: api.deleteFile.bind(api),
            deleteSelectedFiles: api.deleteSelectedFiles.bind(api),
            renameFile: api.renameFile.bind(api),
            moveFile: api.moveFile.bind(api),
            moveSelected: api.moveSelected.bind(api),
            createNewFile: api.createNewFile.bind(api),
            createNewFolder: api.createNewFolder.bind(api),
            setViewMode: ui.setViewMode.bind(ui)
        };

        // ファイル削除操作のフック
        api.deleteFile = async (path) => {
            const result = await originalMethods.deleteFile(path);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        api.deleteSelectedFiles = async () => {
            const result = await originalMethods.deleteSelectedFiles();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // ファイル名変更操作のフック
        api.renameFile = async (path) => {
            const result = await originalMethods.renameFile(path);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // ファイル移動操作のフック
        api.moveFile = async (sourcePath) => {
            const result = await originalMethods.moveFile(sourcePath);
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        api.moveSelected = async () => {
            const result = await originalMethods.moveSelected();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // 新規ファイル作成のフック
        api.createNewFile = async () => {
            const result = await originalMethods.createNewFile();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        api.createNewFolder = async () => {
            const result = await originalMethods.createNewFolder();
            if (this.isInSearchMode && this.lastSearchTerm) {
                setTimeout(() => this.refreshSearchResults(), 100);
            }
            return result;
        };

        // FileManagerのsetViewModeをフック
        ui.setViewMode = (mode) => {
            if (this.isInSearchMode && this.lastSearchResults && this.lastSearchTerm) {
                // 検索モード中の場合、ビュー切り替え後に検索結果を再表示
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
            searchInput.addEventListener('focus', () => {
                this.showSearchOptions();
            });
            
            // キーボードイベントを強化
            searchInput.addEventListener('keydown', (e) => {
                this.handleKeyDown(e);
            });
            
            // 入力変更イベント
            searchInput.addEventListener('input', (e) => {
                this.handleInput(e);
            });
            
            // ブラー時に補完を隠す
            searchInput.addEventListener('blur', (e) => {
                // 補完リストをクリックした場合は隠さない
                setTimeout(() => {
                    if (!this.completionDropdown.contains(document.activeElement)) {
                        this.hideCompletions();
                    }
                }, 200);
            });
        }
        
        const searchOptions = document.querySelector('.search-options');
        if (searchOptions) {
            searchOptions.addEventListener('click', () => {
                this.toggleSearchOptions();
            });
        }
    }
    
    // キーボードイベントハンドラ
    handleKeyDown(e) {
        const searchInput = e.target;
        
        if (this.isShowingCompletions) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateCompletion(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateCompletion(-1);
                    break;
                case 'Tab':
                    e.preventDefault();
                    this.navigateCompletion(1);
                    this.applyCompletion();
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (this.selectedCompletionIndex >= 0) {
                        this.applyCompletion();
                    } else {
                        this.handleEnter(searchInput);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.hideCompletions();
                    break;
                default:
                    // 他のキーが押された場合は補完を隠す
                    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                        this.hideCompletions();
                    }
            }
        } else {
            switch (e.key) {
                case 'Enter':
                    e.preventDefault();
                    this.handleEnter(searchInput);
                    break;
                case 'Tab':
                    if (this.isCdMode) {
                        e.preventDefault();
                        this.showCompletions(searchInput.value);
                    }
                    break;
            }
        }
    }
    
    // 入力変更ハンドラ
    handleInput(e) {
        const value = e.target.value;
        this.isCdMode = value.startsWith('cd ');
        this.isAria2cMode = value.startsWith('aria2c ');
        
        if (this.isCdMode && this.isShowingCompletions) {
            const path = value.slice(3); // 'cd ' を除去
            this.updateCompletions(path);
        }
    }
    
    // Enterキーハンドラ
    handleEnter(searchInput) {
        const value = searchInput.value.trim();
        
        if (this.isCdMode) {
            this.executeCdCommand(value);
        } else if (this.isAria2cMode) {
            this.executeAria2cCommand(value);
        } else {
            this.performSearch();
        }
    }
    
    // cdコマンドの実行
    async executeCdCommand(command) {
        const path = command.slice(2).trim(); // 'cd' を除去
        
        try {
            let targetPath;
            
            if (!path || path === '') {
                // 'cd' のみの場合はルートに移動
                targetPath = '/';
            } else if (path === '..') {
                // 親ディレクトリに移動
                targetPath = this.getParentPath(this.fileManager.router.getCurrentPath());
            } else if (path.startsWith('/')) {
                // 絶対パス
                targetPath = path;
            } else {
                // 相対パス
                targetPath = this.joinPaths(this.fileManager.router.getCurrentPath(), path);
            }
            
            // パスの正規化
            targetPath = this.normalizePath(targetPath);
            
            // フォルダの存在確認と移動
            await this.navigateToFolder(targetPath);
            
        } catch (error) {
            console.error('cd command error:', error);
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('cd Error', `Cannot change directory: ${error.message}`, 'error');
            }
        }
    }
    
    // aria2cコマンドの実行
    async executeAria2cCommand(command) {
        const url = command.slice('aria2c '.length).trim();
        if (!url) {
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('aria2c Error', 'Please provide a URL.', 'error');
            }
            return;
        }

        const currentPath = this.fileManager.router.getCurrentPath();

        try {
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('aria2c', `Starting download...`, 'info');
            }

            const response = await fetch('/api/system/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: url,
                    path: currentPath
                })
            });

            const result = await response.json();

            if (result.success) {
                if (this.fileManager && this.fileManager.ui) {
                    this.fileManager.ui.showToast('aria2c', result.message || 'Download started.', 'success');
                }
                const searchInput = document.querySelector('.search-input');
                if (searchInput) {
                    searchInput.value = '';
                }
                this.isAria2cMode = false;
                this.isCdMode = false;
            } else {
                if (this.fileManager && this.fileManager.ui) {
                    this.fileManager.ui.showToast('aria2c Error', result.message || 'Failed to start download.', 'error');
                }
            }
        } catch (error) {
            console.error('aria2c command error:', error);
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('aria2c Error', `Failed to start download: ${error.message}`, 'error');
            }
        }
    }
    
    // フォルダへの移動
    async navigateToFolder(path) {
        try {
            // APIを使ってフォルダの存在確認
            const encodedPath = encodeURIComponent(path);
            const response = await fetch(`/api/files?path=${encodedPath}`);
            const result = await response.json();
            
            if (result.success) {
                // 検索関連の状態をリセット
                this.isInSearchMode = false;
                this.lastSearchResults = null;
                this.lastSearchTerm = '';
                this.currentPage = 0;

                const searchInput = document.querySelector('.search-input');
                if (searchInput) {
                    searchInput.value = '';
                }
                this.isCdMode = false;
                this.isAria2cMode = false;
                this.hideCompletions();

                if (this.originalViewMode) {
                    this.fileManager.ui.viewMode = this.originalViewMode;
                    this.originalViewMode = null;
                }
                
                // ルーターを使ってナビゲーション
                this.fileManager.api.directoryEtags.delete(path);
                this.fileManager.router.navigate(path);

            } else {
                throw new Error(result.message || 'Directory not found');
            }
        } catch (error) {
            throw new Error(`Directory '${path}' not found or inaccessible`);
        }
    }
    
    // Tab補完の表示
    async showCompletions(command) {
        const path = command.slice(3); // 'cd ' を除去
        
        try {
            const completions = await this.getCompletions(path);
            this.displayCompletions(completions);
        } catch (error) {
            console.error('Completion error:', error);
        }
    }
    
    // 補完候補の取得
    async getCompletions(partialPath) {
        try {
            let searchPath, prefix;
            
            if (partialPath.startsWith('/')) {
                // 絶対パス
                const lastSlashIndex = partialPath.lastIndexOf('/');
                searchPath = lastSlashIndex === 0 ? '/' : partialPath.substring(0, lastSlashIndex);
                prefix = partialPath.substring(lastSlashIndex + 1);
            } else {
                // 相対パス
                searchPath = this.fileManager.router.getCurrentPath();
                prefix = partialPath;
            }
            
            // APIからフォルダ一覧を取得
            const encodedPath = encodeURIComponent(searchPath);
            const response = await fetch(`/api/files?path=${encodedPath}`);
            const result = await response.json();
            
            if (!result.success) {
                return [];
            }
            
            // フォルダのみをフィルタリングし、プレフィックスに一致するものを取得
            const folders = result.data.filter(item => 
                item.is_dir && 
                item.name.toLowerCase().startsWith(prefix.toLowerCase())
            );
            
            // 最大10個まで
            return folders.slice(0, 10).map(folder => ({
                name: folder.name,
                fullPath: this.joinPaths(searchPath, folder.name)
            }));
            
        } catch (error) {
            console.error('Error getting completions:', error);
            return [];
        }
    }
    
    // 補完候補の更新
    async updateCompletions(path) {
        const completions = await this.getCompletions(path);
        this.displayCompletions(completions);
    }
    
    // 補完候補の表示
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
            li.innerHTML = `
                <div class="completion-text">
                    <div class="completion-name">${completion.name}</div>
                    <div class="completion-path">${completion.fullPath}</div>
                </div>
            `;
            
            li.addEventListener('click', () => {
                this.selectedCompletionIndex = index;
                this.applyCompletion();
            });
            
            list.appendChild(li);
        });
        
        this.showCompletionsDropdown();
    }
    
    // 補完ナビゲーション
    navigateCompletion(direction) {
        if (this.cdCompletions.length === 0) return;
        
        const newIndex = this.selectedCompletionIndex + direction;
        
        if (newIndex >= 0 && newIndex < this.cdCompletions.length) {
            this.selectedCompletionIndex = newIndex;
            this.updateCompletionSelection();
        }
    }
    
    // 補完選択の更新
    updateCompletionSelection() {
        const items = this.completionDropdown.querySelectorAll('.completion-item');
        items.forEach((item, index) => {
            if (index === this.selectedCompletionIndex) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }
    
    // 補完の適用
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
    
    // 補完ドロップダウンの表示
    showCompletionsDropdown() {
        if (this.completionDropdown) {
            this.completionDropdown.style.display = 'block';
            this.isShowingCompletions = true;
        }
    }
    
    // 補完の非表示
    hideCompletions() {
        if (this.completionDropdown) {
            this.completionDropdown.style.display = 'none';
            this.isShowingCompletions = false;
            this.selectedCompletionIndex = -1;
        }
    }
    
    // パスユーティリティ関数
    getParentPath(path) {
        if (path === '/' || path === '') return '/';
        const parts = path.split('/').filter(part => part !== '');
        parts.pop();
        return '/' + parts.join('/');
    }
    
    joinPaths(basePath, relativePath) {
        const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
        const relative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
        return base + '/' + relative;
    }
    
    normalizePath(path) {
        const parts = path.split('/').filter(part => part !== '' && part !== '.');
        const normalized = [];
        
        for (const part of parts) {
            if (part === '..') {
                normalized.pop();
            } else {
                normalized.push(part);
            }
        }
        
        return '/' + normalized.join('/');
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
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('Search', 'Please enter a search term', 'warning');
            }
            return;
        }
        
        // 検索モードに入る際の状態保存
        if (!this.isInSearchMode) {
            this.isInSearchMode = true;
            this.originalViewMode = this.fileManager.ui.viewMode;
        }
        
        this.lastSearchTerm = searchTerm;
        this.currentPage = page;
        
        try {
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showLoading();
            }
            
            const offset = page * this.pageSize;
            
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    term: searchTerm,
                    path: this.fileManager ? this.fileManager.router.getCurrentPath() : '/',
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
                if (this.fileManager && this.fileManager.ui) {
                    this.fileManager.ui.showToast('Search Error', result ? result.message : 'Unknown error', 'error');
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('Search Error', 'Failed to perform search', 'error');
            }
        } finally {
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.hideLoading();
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
                    path: this.fileManager ? this.fileManager.router.getCurrentPath() : '/',
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
                <button class="search-back-btn">
                    ← Back to Files
                </button>
            </div>
        `;
        
        const paginationControls = this.createPaginationControls(page, totalPages);
        header.querySelector('.search-controls').appendChild(paginationControls);

        container.appendChild(header);

        header.querySelector('.search-back-btn').addEventListener('click', () => this.exitSearchMode());
        
        // ビューモード切り替えボタンを追加（検索モード専用の処理）
        const viewToggle = document.createElement('div');
        viewToggle.className = 'view-toggle';
        viewToggle.innerHTML = `
            <button class="view-toggle-btn ${this.fileManager.ui.viewMode === 'grid' ? 'active' : ''}" data-view="grid">Grid</button>
            <button class="view-toggle-btn ${this.fileManager.ui.viewMode === 'list' ? 'active' : ''}" data-view="list">List</button>
        `;
        container.appendChild(viewToggle);

        viewToggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.fileManager.ui.setViewMode(e.target.dataset.view));
        });
        
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
        if (this.fileManager.ui.viewMode === 'list') {
            this.renderListView(pageResults, container);
        } else {
            this.renderGridView(pageResults, container);
        }
        
        // ページネーションコントロールを下部にも追加
        if (totalPages > 1) {
            const footerPagination = document.createElement('div');
            footerPagination.className = 'search-pagination-footer';
            footerPagination.appendChild(this.createPaginationControls(page, totalPages));
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
        
        // cdモード関連の状態をリセット
        this.isCdMode = false;
        this.isAria2cMode = false;
        this.hideCompletions();
        
        // 元のビューモードに復元
        if (this.originalViewMode) {
            this.fileManager.ui.viewMode = this.originalViewMode;
            this.originalViewMode = null;
        }
        
        // 通常のファイル一覧を再読み込み
        this.fileManager.loadFiles(this.fileManager.router.getCurrentPath());
    }

    // フォルダに移動し、検索モードを終了
    async navigateToFolderAndExitSearch(path) {
        try {
            // APIを使ってフォルダの存在確認
            const encodedPath = encodeURIComponent(path);
            const response = await fetch(`/api/files?path=${encodedPath}`);
            const result = await response.json();

            if (result.success) {
                // 検索関連の状態をリセット
                this.isInSearchMode = false;
                this.lastSearchResults = null;
                this.lastSearchTerm = '';
                this.currentPage = 0;

                const searchInput = document.querySelector('.search-input');
                if (searchInput) {
                    searchInput.value = '';
                }
                this.isCdMode = false;
                this.isAria2cMode = false;
                this.hideCompletions();

                if (this.originalViewMode) {
                    this.fileManager.ui.viewMode = this.originalViewMode;
                    this.originalViewMode = null;
                }
                
                // フォルダに移動
                this.fileManager.router.navigate(path);

            } else {
                throw new Error(result.message || 'Directory not found');
            }
        } catch (error) {
            console.error('Navigation error:', error);
            if (this.fileManager && this.fileManager.ui) {
                this.fileManager.ui.showToast('Error', `Could not navigate to folder: ${error.message}`, 'error');
            }
        }
    }
    
    // Grid表示のレンダリング
    renderGridView(files, container) {
        const fileGrid = document.createElement('div');
        fileGrid.className = 'file-grid';
        
        files.forEach(file => {
            const fileItem = this.fileManager.ui.createFileItem(file);
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
                <th class="sortable ${this.sortField === 'name' ? this.sortDirection : ''}" data-sort="name">
                    Name ${this.sortField === 'name' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortField === 'size' ? this.sortDirection : ''}" data-sort="size">
                    Size ${this.sortField === 'size' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortField === 'modified' ? this.sortDirection : ''}" data-sort="modified">
                    Modified ${this.sortField === 'modified' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th class="sortable ${this.sortField === 'type' ? this.sortDirection : ''}" data-sort="type">
                    Type ${this.sortField === 'type' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Actions</th>
            </tr>
        `;
        table.appendChild(thead);

        const headers = thead.querySelectorAll('.sortable');
        headers[0].addEventListener('click', () => this.setSort('name'));
        headers[1].addEventListener('click', () => this.setSort('size'));
        headers[2].addEventListener('click', () => this.setSort('modified'));
        headers[3].addEventListener('click', () => this.setSort('type'));
        
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
        this.fileManager.ui.setFileItemData(tr, file);
        
        tr.innerHTML = `
            <td>
                <div class="file-icon ${this.fileManager.ui.getFileIconClass(file)}"></div>
                <span class="file-name">${file.name}</span>
            </td>
            <td>${file.is_dir ? '-' : this.fileManager.ui.formatFileSize(file.size)}</td>
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
                this.fileManager.events.handleFileClick(tr, e);
            }
        });
        
        tr.addEventListener('dblclick', (e) => {
            this.fileManager.events.handleFileDoubleClick(tr);
        });
        
        // アクションボタンのイベントバインド
        tr.querySelectorAll('.file-action-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.fileManager.events.handleFileActionClick(button, tr);
            });
        });
        
        return tr;
    }
    
    createPaginationControls(currentPage, totalPages) {
        if (totalPages <= 1) return document.createDocumentFragment();

        const controls = document.createElement('div');
        controls.className = 'pagination-controls';

        const prevDisabled = currentPage === 0;
        const nextDisabled = currentPage === totalPages - 1;

        const prevButton = document.createElement('button');
        prevButton.className = 'pagination-btn';
        prevButton.textContent = '← Previous';
        prevButton.disabled = prevDisabled;
        if (!prevDisabled) {
            prevButton.addEventListener('click', () => this.performSearch(currentPage - 1));
        }

        const nextButton = document.createElement('button');
        nextButton.className = 'pagination-btn';
        nextButton.textContent = 'Next →';
        nextButton.disabled = nextDisabled;
        if (!nextDisabled) {
            nextButton.addEventListener('click', () => this.performSearch(currentPage + 1));
        }

        const pageNumbers = document.createElement('div');
        pageNumbers.className = 'page-numbers';

        const startPage = Math.max(0, currentPage - 2);
        const endPage = Math.min(totalPages - 1, currentPage + 2);

        if (startPage > 0) {
            const btn = document.createElement('button');
            btn.className = 'page-btn';
            btn.textContent = '1';
            btn.addEventListener('click', () => this.performSearch(0));
            pageNumbers.appendChild(btn);
            if (startPage > 1) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'page-ellipsis';
                ellipsis.textContent = '...';
                pageNumbers.appendChild(ellipsis);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-btn';
            if (i === currentPage) {
                btn.classList.add('active');
            }
            btn.textContent = i + 1;
            btn.addEventListener('click', () => this.performSearch(i));
            pageNumbers.appendChild(btn);
        }

        if (endPage < totalPages - 1) {
            if (endPage < totalPages - 2) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'page-ellipsis';
                ellipsis.textContent = '...';
                pageNumbers.appendChild(ellipsis);
            }
            const btn = document.createElement('button');
            btn.className = 'page-btn';
            btn.textContent = totalPages;
            btn.addEventListener('click', () => this.performSearch(totalPages - 1));
            pageNumbers.appendChild(btn);
        }
        
        controls.appendChild(prevButton);
        controls.appendChild(pageNumbers);
        controls.appendChild(nextButton);

        return controls;
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