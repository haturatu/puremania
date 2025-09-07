class Router {
    constructor() {
        this.routes = {};
        this.currentPath = '';
        this.isInitialized = false;
        
        // popstateイベントリスナーを追加
        window.addEventListener('popstate', (e) => {
            this.handleRouteChange();
        });
        
        // DOMContentLoadedの後に初期化を実行
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initialize();
            });
        } else {
            this.initialize();
        }
    }
    
    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        
        // 初期化時に現在のURLを処理
        this.handleInitialRoute();
    }
    
    handleInitialRoute() {
        const currentPath = this.getCurrentPath();
        console.log('Initial route:', currentPath);
        
        // URLが既にファイルパスを含んでいる場合、そのパスをロード
        if (currentPath && currentPath !== '/') {
            this.currentPath = currentPath;
            if (typeof this.onRouteChange === 'function') {
                // 少し遅延させてFileManagerAppが初期化されるのを待つ
                setTimeout(() => {
                    this.onRouteChange(currentPath);
                }, 100);
            }
        } else {
            // ルートパスの場合
            this.currentPath = '/';
            if (typeof this.onRouteChange === 'function') {
                setTimeout(() => {
                    this.onRouteChange('/');
                }, 100);
            }
        }
    }
    
    add(path, callback) {
        this.routes[path] = callback;
    }
    
    navigate(path) {
        // ルートパスの正規化
        let cleanPath = this.normalizePath(path);
        
        // 現在のパスと同じ場合は何もしない
        if (cleanPath === this.currentPath) return;
        
        console.log('Navigating to:', cleanPath);
        history.pushState({ path: cleanPath }, '', cleanPath);
        this.currentPath = cleanPath;
        this.handleRouteChange();
    }
    
    updatePath(path) {
        // パスの正規化
        let cleanPath = this.normalizePath(path);
        
        console.log('Updating path to:', cleanPath);
        
        // URLを更新（履歴に追加せず）
        history.replaceState({ path: cleanPath }, '', cleanPath);
        this.currentPath = cleanPath;
    }
    
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
    
    getCurrentPath() {
        let path = window.location.pathname;
        
        // デコードされたパスを使用
        try {
            path = decodeURIComponent(path);
        } catch (e) {
            console.warn('Failed to decode path:', path);
        }
        
        return this.normalizePath(path);
    }
    
    handleRouteChange() {
        const path = this.getCurrentPath();
        console.log('Route changed to:', path);
        
        // 現在のパスと同じ場合は処理をスキップ
        if (path === this.currentPath) {
            return;
        }
        
        this.currentPath = path;
        
        // 登録されたルートとマッチするかチェック
        for (const routePath in this.routes) {
            if (this.matchRoute(routePath, path)) {
                console.log('Route matched:', routePath);
                this.routes[routePath](path);
                return;
            }
        }
        
        // デフォルトのルート変更ハンドラーを呼び出し
        if (typeof this.onRouteChange === 'function') {
            console.log('Calling onRouteChange with:', path);
            this.onRouteChange(path);
        }
    }
    
    matchRoute(route, path) {
        // 完全一致チェック
        if (route === path) return true;
        
        // パラメータを含むルートのマッチング
        const routeParts = route.split('/').filter(part => part !== '');
        const pathParts = path.split('/').filter(part => part !== '');
        
        if (routeParts.length !== pathParts.length) return false;
        
        for (let i = 0; i < routeParts.length; i++) {
            // パラメータ（:で始まる）の場合はスキップ
            if (routeParts[i].startsWith(':')) continue;
            // 通常の部分は完全一致が必要
            if (routeParts[i] !== pathParts[i]) return false;
        }
        
        return true;
    }
    
    getParams(route, path) {
        const params = {};
        const routeParts = route.split('/').filter(part => part !== '');
        const pathParts = path.split('/').filter(part => part !== '');
        
        for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
                const paramName = routeParts[i].substring(1);
                params[paramName] = decodeURIComponent(pathParts[i] || '');
            }
        }
        
        return params;
    }
    
    onChange(callback) {
        this.onRouteChange = callback;
        
        // 既に初期化済みの場合は、現在のパスでコールバックを呼び出し
        if (this.isInitialized && this.currentPath) {
            setTimeout(() => {
                callback(this.currentPath);
            }, 10);
        }
    }
    
    // ブラウザの戻る/進むボタンが押された時の処理
    back() {
        history.back();
    }
    
    forward() {
        history.forward();
    }
    
    // 現在のパスを強制的に再ロード
    refresh() {
        if (typeof this.onRouteChange === 'function') {
            this.onRouteChange(this.currentPath);
        }
    }
}
