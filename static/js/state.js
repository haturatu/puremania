export class AppStateStore {
    constructor() {
        this.state = {
            route: { page: 'files', path: '/' },
            directory: { path: '/', renderedPath: null, status: 'idle', requestId: 0, files: [], page: null },
            selection: { paths: new Set(), anchorPath: null },
            search: { active: false, query: '', status: 'idle', requestId: 0, commandMode: null, results: null, page: 0, cursorHistory: [''], nextCursor: '', hasMore: false },
            editor: { path: null, status: 'closed', originalContent: '', currentContent: '', dirty: false, loadRequestId: 0, saveRevision: 0, error: null },
            uploads: { activeBatchId: null, batches: new Map(), status: 'idle' },
            ui: { pendingOperations: 0 }
        };
        this.listeners = new Set();
    }

    getState() {
        return this.state;
    }

    update(slice, patch, action = slice) {
        const previous = this.state;
        this.state = { ...previous, [slice]: { ...previous[slice], ...patch } };
        this.listeners.forEach(listener => listener(this.state, previous, action));
        return this.state[slice];
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
