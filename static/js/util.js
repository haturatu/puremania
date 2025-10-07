export function normalizePath(path) {
    if (!path || path === '/') return '/';
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

export class Util {
    constructor(app) {
        this.app = app;
    }

    isValidPath(path) {
        return path && path.length > 0 && !path.includes('..');
    }
    
    getParentPath(path) {
        const parts = path.split('/').filter(part => part !== '');
        if (parts.length <= 1) return '/';
        parts.pop();
        return '/' + parts.join('/');
    }
    
    getBaseName(path) {
        const parts = path.split('/').filter(part => part !== '');
        return parts.length > 0 ? parts[parts.length - 1] : '';
    }

    isEditableFile(path) {
        const ext = path.split('.').pop().toLowerCase();
        const editableExts = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'py', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'bat', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env'];
        return editableExts.includes(ext);
    }

    normalizePath(path) {
        return normalizePath(path);
    }
}