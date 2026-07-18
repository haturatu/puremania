let uniqueIdCounter = 0;

export function createUniqueId(cryptoProvider = globalThis.crypto) {
    if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID();

    if (typeof cryptoProvider?.getRandomValues === 'function') {
        const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    }

    uniqueIdCounter += 1;
    return `${Date.now().toString(36)}-${uniqueIdCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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

export function buildUrl(path, query = {}, base = window.location.origin) {
    const url = new URL(path, base);

    Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(item => url.searchParams.append(key, item));
            return;
        }

        url.searchParams.set(key, value);
    });

    return url;
}

export function buildApiUrl(path, query = {}) {
    return buildUrl(path, query).toString();
}

export function isValidPath(path) {
    return Boolean(path && path.length > 0 && !path.includes('..'));
}

export function getParentPath(path) {
    const parts = path.split('/').filter(part => part !== '');
    if (parts.length <= 1) return '/';
    parts.pop();
    return '/' + parts.join('/');
}

export function getBaseName(path) {
    const parts = path.split('/').filter(part => part !== '');
    return parts.length > 0 ? parts[parts.length - 1] : '';
}

export function isEditableFile(path) {
    const ext = path.split('.').pop().toLowerCase();
    const editableExts = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'py', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'bat', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env'];
    return editableExts.includes(ext);
}
