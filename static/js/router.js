class Router {
    constructor() {
        this.routes = {};
        this.currentPath = '';
        
        window.addEventListener('popstate', (e) => {
            this.handleRouteChange();
        });
        
        this.handleRouteChange();
    }
    
    add(path, callback) {
        this.routes[path] = callback;
    }
    
    navigate(path) {
        // ルートパスの処理を修正
        let cleanPath = path;
        if (cleanPath === '' || cleanPath === '/') {
            cleanPath = '/';
        } else {
            cleanPath = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
            // 重複するスラッシュを除去
            cleanPath = cleanPath.replace(/\/+/g, '/');
        }
        
        history.pushState({}, '', cleanPath);
        this.handleRouteChange();
    }
    
    updatePath(path) {
        let cleanPath = path;
        if (cleanPath === '' || cleanPath === '/') {
            cleanPath = '/';
        } else {
            cleanPath = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
            cleanPath = cleanPath.replace(/\/+/g, '/');
        }
        
        history.replaceState({}, '', cleanPath);
        this.currentPath = cleanPath;
    }
    
    getCurrentPath() {
        return window.location.pathname;
    }
    
    handleRouteChange() {
        const path = this.getCurrentPath();
        
        if (path === this.currentPath) return;
        
        this.currentPath = path;
        
        for (const routePath in this.routes) {
            if (this.matchRoute(routePath, path)) {
                this.routes[routePath](path);
                return;
            }
        }
        
        if (typeof this.onRouteChange === 'function') {
            this.onRouteChange(path);
        }
    }
    
    matchRoute(route, path) {
        const routeParts = route.split('/');
        const pathParts = path.split('/');
        
        if (routeParts.length !== pathParts.length) return false;
        
        for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) continue;
            if (routeParts[i] !== pathParts[i]) return false;
        }
        
        return true;
    }
    
    getParams(route, path) {
        const params = {};
        const routeParts = route.split('/');
        const pathParts = path.split('/');
        
        for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
                const paramName = routeParts[i].substring(1);
                params[paramName] = pathParts[i];
            }
        }
        
        return params;
    }
    
    onChange(callback) {
        this.onRouteChange = callback;
    }
}
