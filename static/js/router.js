export class Router {
    constructor() {
        this.routes = {};
        this.currentPath = '';
        this.isInitialized = false;
        this.onRouteChange = null;
        
        this._setupEventListeners();
        this._initializeWhenReady();
    }

    /**
     * イベントリスナーの設定
     * @private
     */
    _setupEventListeners() {
        window.addEventListener('popstate', () => {
            this.handleRouteChange();
        });
    }

    /**
     * DOM準備完了時に初期化
     * @private
     */
    _initializeWhenReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initialize();
            });
        } else {
            this.initialize();
        }
    }

    /**
     * ルーターの初期化
     */
    initialize() {
        if (this.isInitialized) return;
        
        this.isInitialized = true;
        this._handleInitialRoute();
    }

    /**
     * 初期ルートの処理
     * @private
     */
    _handleInitialRoute() {
        const currentPath = this.getCurrentPath();
        console.log('Initial route:', currentPath);
        
        this.currentPath = currentPath;
        
        if (this.onRouteChange) {
            // FileManagerAppの初期化を待つための遅延
            setTimeout(() => {
                this.onRouteChange(currentPath);
            }, 100);
        }
    }

    /**
     * ルートとコールバックを登録
     * @param {string} path - ルートパス
     * @param {Function} callback - コールバック関数
     */
    add(path, callback) {
        this.routes[path] = callback;
    }

    /**
     * 指定したパスにナビゲート（履歴に追加）
     * @param {string} path - 移動先のパス
     */
    navigate(path) {
        const cleanPath = this.normalizePath(path);
        
        if (cleanPath === this.currentPath) return;
        
        console.log('Navigating to:', cleanPath);
        
        this._updateBrowserHistory(cleanPath, 'push');
        this.currentPath = cleanPath;
        this.handleRouteChange();
    }

    /**
     * パスを更新（履歴に追加しない）
     * @param {string} path - 更新するパス
     */
    updatePath(path) {
        const cleanPath = this.normalizePath(path);
        
        console.log('Updating path to:', cleanPath);
        
        this._updateBrowserHistory(cleanPath, 'replace');
        this.currentPath = cleanPath;
    }

    /**
     * ブラウザ履歴の更新
     * @param {string} path - パス
     * @param {string} method - 'push' または 'replace'
     * @private
     */
    _updateBrowserHistory(path, method) {
        const displayPath = this._encodeForDisplay(path);
        const historyMethod = method === 'push' ? 'pushState' : 'replaceState';
        
        history[historyMethod]({ path }, '', displayPath);
    }

    /**
     * ブラウザ表示用にパスをエンコード
     * @param {string} path - エンコードするパス
     * @returns {string} エンコードされたパス
     * @private
     */
    _encodeForDisplay(path) {
        // encodeURIでエンコードし、#文字は手動でエンコード
        return encodeURI(path).replace(/#/g, '%23');
    }

    /**
     * 現在のパスを取得
     * @returns {string} 現在のパス
     */
    getCurrentPath() {
        let path = this._extractPathFromURL();
        path = this._decodePath(path);
        return this.normalizePath(path);
    }

    /**
     * URLから完全なパスを抽出
     * @returns {string} 抽出されたパス
     * @private
     */
    _extractPathFromURL() {
        let path = window.location.pathname;
        
        // クエリパラメータを追加
        if (window.location.search) {
            path += window.location.search;
        }
        
        // ハッシュフラグメントを追加（ファイルパスの一部として）
        if (window.location.hash && window.location.hash !== '#') {
            path += window.location.hash;
        }
        
        return path;
    }

    /**
     * パスのデコード処理
     * @param {string} path - デコードするパス
     * @returns {string} デコードされたパス
     * @private
     */
    _decodePath(path) {
        try {
            return decodeURIComponent(path);
        } catch (error) {
            console.warn('Failed to decode path:', path, error);
            return path;
        }
    }

    /**
     * パスの正規化
     * @param {string} path - 正規化するパス
     * @returns {string} 正規化されたパス
     */
    normalizePath(path) {
        if (!path || path === '' || path === '/') {
            return '/';
        }
        
        // 先頭にスラッシュを追加
        let cleanPath = path.startsWith('/') ? path : '/' + path;
        
        // 重複するスラッシュを除去
        cleanPath = cleanPath.replace(/\/+/g, '/');
        
        // 末尾のスラッシュを除去（ルート以外）
        if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
            cleanPath = cleanPath.slice(0, -1);
        }
        
        return cleanPath;
    }

    /**
     * ルート変更の処理
     */
    handleRouteChange() {
        const path = this.getCurrentPath();
        console.log('Route changed to:', path);
        
        // 既に同じパスの場合は処理をスキップ
        if (path === this.currentPath) {
            return;
        }
        
        this.currentPath = path;
        
        // 登録されたルートのマッチングを試行
        const matchedRoute = this._findMatchingRoute(path);
        if (matchedRoute) {
            console.log('Route matched:', matchedRoute);
            this.routes[matchedRoute](path);
            return;
        }
        
        // デフォルトハンドラーを呼び出し
        if (this.onRouteChange) {
            console.log('Calling onRouteChange with:', path);
            this.onRouteChange(path);
        }
    }

    /**
     * パスにマッチするルートを検索
     * @param {string} path - マッチング対象のパス
     * @returns {string|null} マッチしたルート
     * @private
     */
    _findMatchingRoute(path) {
        for (const routePath in this.routes) {
            if (this.matchRoute(routePath, path)) {
                return routePath;
            }
        }
        return null;
    }

    /**
     * ルートパターンとパスのマッチング
     * @param {string} route - ルートパターン
     * @param {string} path - マッチング対象のパス
     * @returns {boolean} マッチするかどうか
     */
    matchRoute(route, path) {
        // 完全一致チェック
        if (route === path) return true;
        
        return this._matchRouteWithParams(route, path);
    }

    /**
     * パラメータ付きルートのマッチング
     * @param {string} route - ルートパターン
     * @param {string} path - マッチング対象のパス
     * @returns {boolean} マッチするかどうか
     * @private
     */
    _matchRouteWithParams(route, path) {
        const routeParts = this._splitPath(route);
        const pathParts = this._splitPath(path);
        
        if (routeParts.length !== pathParts.length) return false;
        
        return routeParts.every((routePart, i) => {
            return routePart.startsWith(':') || routePart === pathParts[i];
        });
    }

    /**
     * パスを分割してセグメントの配列を取得
     * @param {string} path - 分割するパス
     * @returns {string[]} パスセグメントの配列
     * @private
     */
    _splitPath(path) {
        return path.split('/').filter(part => part !== '');
    }

    /**
     * ルートパラメータの抽出
     * @param {string} route - ルートパターン
     * @param {string} path - 対象パス
     * @returns {Object} パラメータのオブジェクト
     */
    getParams(route, path) {
        const params = {};
        const routeParts = this._splitPath(route);
        const pathParts = this._splitPath(path);
        
        routeParts.forEach((routePart, i) => {
            if (routePart.startsWith(':')) {
                const paramName = routePart.substring(1);
                params[paramName] = decodeURIComponent(pathParts[i] || '');
            }
        });
        
        return params;
    }

    /**
     * ルート変更コールバックの登録
     * @param {Function} callback - コールバック関数
     */
    onChange(callback) {
        this.onRouteChange = callback;
        
        // 既に初期化済みの場合は即座にコールバックを実行
        if (this.isInitialized && this.currentPath) {
            setTimeout(() => {
                callback(this.currentPath);
            }, 10);
        }
    }

    /**
     * ブラウザの戻るボタン
     */
    back() {
        history.back();
    }

    /**
     * ブラウザの進むボタン
     */
    forward() {
        history.forward();
    }

    /**
     * 現在のパスを強制的に再ロード
     */
    refresh() {
        if (this.onRouteChange) {
            this.onRouteChange(this.currentPath);
        }
    }
}
