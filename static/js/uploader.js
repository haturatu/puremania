// Resumable uploader: file bytes stay in the browser File object and each
// request owns only one Blob slice. IndexedDB stores session metadata only.
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CONCURRENT_FILES = 3;
const MAX_RETRIES = 5;
const DB_NAME = 'puremania-upload-sessions';
const DB_STORE = 'sessions';

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

class UploadSessionStore {
    async db() {
        if (this._db) return this._db;
        this._db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE, { keyPath: 'key' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this._db;
    }

    async get(key) { return this.transaction('readonly', store => store.get(key)); }
    async getAll() { return this.transaction('readonly', store => store.getAll()); }
    async put(value) { return this.transaction('readwrite', store => store.put(value)); }
    async remove(key) { return this.transaction('readwrite', store => store.delete(key)); }

    async transaction(mode, action) {
        const db = await this.db();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, mode);
            const request = action(tx.objectStore(DB_STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
        });
    }
}

export class Uploader {
    constructor(app) {
        this.app = app;
        this._processingDrop = false;
        this.activeUploadSession = null;
        this.store = new UploadSessionStore();
        this.progress = new Map();
        this.resumeRequestedKey = null;
    }

    createUploadSession() {
        const controller = new AbortController();
        const xhrs = new Set();
        return {
            signal: controller.signal,
            aborted: false,
            abort: () => {
                if (controller.signal.aborted) return;
                controller.abort();
                xhrs.forEach(xhr => xhr.abort());
                xhrs.clear();
            },
            trackXhr: xhr => {
                if (controller.signal.aborted) { xhr.abort(); return false; }
                xhrs.add(xhr);
                xhr.addEventListener('loadend', () => xhrs.delete(xhr), { once: true });
                return true;
            }
        };
    }

    ensureActive(session) {
        if (!session || session.signal.aborted) throw new DOMException('Upload interrupted', 'AbortError');
    }

    isAbortError(error) { return error?.name === 'AbortError'; }

    notifyJobsChanged() { window.dispatchEvent(new CustomEvent('puremania:upload-jobs-changed')); }

    showUploadDialog() { document.querySelector('.upload-input-files')?.click(); }

    bindUploadEvents() {
        const area = document.querySelector('.upload-area');
        if (!area) return;
        const filesInput = area.querySelector('.upload-input-files');
        const foldersInput = area.querySelector('.upload-input-folders');
        const selectFiles = area.querySelector('.btn-select-files');
        const selectFolders = area.querySelector('.btn-select-folders');
        const selected = input => {
            if (!input.files?.length) return;
            const files = Array.from(input.files, file => ({ file, relativePath: file.webkitRelativePath || file.name }));
            input.value = '';
            if (this.resumeRequestedKey) {
                const requested = this.resumeRequestedKey;
                this.resumeRequestedKey = null;
                if (!files.some(item => this.fileKey(item, this.savedDestinationFromKey(requested)) === requested)) {
                    this.app.ui.showToast('Resume upload', 'Choose the original file to resume this upload.', 'warning');
                    return;
                }
            }
            void this.handleFileUpload(files);
        };
        filesInput.addEventListener('change', () => selected(filesInput));
        foldersInput.addEventListener('change', () => selected(foldersInput));
        selectFiles.addEventListener('click', event => { event.preventDefault(); filesInput.click(); });
        selectFolders.addEventListener('click', event => { event.preventDefault(); foldersInput.click(); });
        let dragDepth = 0;
        area.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; area.classList.add('dragover'); });
        area.addEventListener('dragover', event => event.preventDefault());
        area.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; area.classList.remove('dragover'); } });
        area.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; area.classList.remove('dragover'); void this.handleFileDrop(event); });
    }

    fileKey(item, destination) {
        const { file, relativePath } = item;
        return `${destination}|${relativePath}|${file.size}|${file.lastModified}`;
    }

    savedDestinationFromKey(key) { return key.split('|', 1)[0]; }

    async requestResume(key) {
        this.resumeRequestedKey = key;
        const record = await this.store.get(key);
        const isFolderUpload = record?.relativePath?.includes('/');
        const input = document.querySelector(isFolderUpload ? '.upload-input-folders' : '.upload-input-files');
        if (!input) throw new Error('Upload file selector is unavailable');
        input.click();
    }

    async listJobs() {
        let records = [];
        try { records = await this.store.getAll(); } catch (_) { return []; }
        const jobs = await Promise.all(records.map(async record => {
            try {
                const status = await this.apiJSON(record.url);
                const active = this.activeUploadSession && this.progress.has(record.key);
                return { ...record, uploadedBytes: status.uploadedBytes, totalBytes: status.totalBytes, completed: status.completed, state: status.completed ? 'completed' : active ? 'active' : 'paused' };
            } catch (error) {
                if (error.status === 404) { await this.store.remove(record.key); return null; }
                return { ...record, uploadedBytes: record.uploadedBytes || 0, totalBytes: record.size, state: 'offline' };
            }
        }));
        return jobs.filter(Boolean);
    }

    async discardJob(key) {
        const record = await this.store.get(key);
        if (!record) return;
        try { await fetch(record.url, { method: 'DELETE' }); } finally { await this.store.remove(key); this.notifyJobsChanged(); }
    }

    async apiJSON(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
        if (!response.ok) {
            const error = new Error((await response.json().catch(() => ({}))).message || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    async getOrCreateRemoteSession(item, destination, session) {
        const key = this.fileKey(item, destination);
        let saved;
        try { saved = await this.store.get(key); } catch (error) { console.warn('IndexedDB unavailable; upload cannot survive reload', error); }
        if (saved) {
            try {
                const status = await this.apiJSON(saved.url, { signal: session.signal });
                if (!status.completed && status.totalBytes === item.file.size) return { key, ...saved, uploadedBytes: status.uploadedBytes };
                if (status.completed) await this.store.remove(key);
            } catch (error) {
                if (this.isAbortError(error)) throw error;
                if (error.status === 404) try { await this.store.remove(key); } catch (_) { /* storage is optional */ }
            }
        }
        const created = await this.apiJSON('/api/files/upload-sessions', {
            method: 'POST', signal: session.signal,
            body: JSON.stringify({ path: destination, relativePath: item.relativePath, size: item.file.size })
        });
        const record = { key, id: created.uploadId, url: created.uploadURL, destination, relativePath: item.relativePath, size: item.file.size, updatedAt: Date.now() };
        try { await this.store.put(record); this.notifyJobsChanged(); } catch (_) { /* upload itself must still work */ }
        return { ...record, uploadedBytes: created.uploadedBytes || 0 };
    }

    async queryPosition(record, session) {
        const state = await this.apiJSON(record.url, { signal: session.signal });
        return state.uploadedBytes;
    }

    sendChunk(record, blob, start, end, total, session, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abort = () => xhr.abort();
            session.signal.addEventListener('abort', abort, { once: true });
            const cleanup = () => session.signal.removeEventListener('abort', abort);
            xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(start + event.loaded); };
            xhr.onload = () => {
                cleanup();
                if (xhr.status >= 200 && xhr.status < 400) {
                    try { resolve(JSON.parse(xhr.responseText)); } catch (_) { resolve({ uploadedBytes: end + 1 }); }
                } else reject(new Error(`Chunk rejected (${xhr.status})`));
            };
            xhr.onerror = () => { cleanup(); reject(new Error('Network error while sending chunk')); };
            xhr.onabort = () => { cleanup(); reject(new DOMException('Upload interrupted', 'AbortError')); };
            if (!session.trackXhr(xhr)) { cleanup(); reject(new DOMException('Upload interrupted', 'AbortError')); return; }
            xhr.open('PUT', `${record.url}/chunks`);
            xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.send(blob);
        });
    }

    async uploadFile(item, destination, session) {
        const record = await this.getOrCreateRemoteSession(item, destination, session);
        let offset = record.uploadedBytes;
        this.setFileProgress(record.key, item, offset, 'Uploading');
        while (offset < item.file.size) {
            this.ensureActive(session);
            const end = Math.min(offset + CHUNK_SIZE, item.file.size) - 1;
            let completed = false;
            for (let attempt = 0; attempt < MAX_RETRIES && !completed; attempt++) {
                try {
                    // Blob.slice is lazy; it does not load the complete file into JS memory.
                    const result = await this.sendChunk(record, item.file.slice(offset, end + 1), offset, end, item.file.size, session,
                        uploaded => this.setFileProgress(record.key, item, uploaded, 'Uploading'));
                    offset = result.uploadedBytes ?? end + 1;
                    completed = true;
                } catch (error) {
                    if (this.isAbortError(error)) throw error;
                    try { offset = await this.queryPosition(record, session); } catch (statusError) {
                        if (this.isAbortError(statusError)) throw statusError;
                    }
                    if (offset > end) { completed = true; break; }
                    if (attempt === MAX_RETRIES - 1) throw error;
                    this.setFileProgress(record.key, item, offset, `Retrying in ${2 ** attempt}s`);
                    await pause((2 ** attempt) * 1000 + Math.floor(Math.random() * 250));
                }
            }
            try { await this.store.put({ ...record, uploadedBytes: offset, updatedAt: Date.now() }); this.notifyJobsChanged(); } catch (_) { /* optional */ }
        }
        await this.apiJSON(`${record.url}/complete`, { method: 'POST', signal: session.signal });
        try { await this.store.remove(record.key); this.notifyJobsChanged(); } catch (_) { /* optional */ }
        this.setFileProgress(record.key, item, item.file.size, 'Completed');
    }

    setFileProgress(key, item, uploaded, state) {
        this.progress.set(key, { name: item.relativePath, total: item.file.size, uploaded: Math.min(uploaded, item.file.size), state });
        const values = [...this.progress.values()];
        const total = values.reduce((sum, value) => sum + value.total, 0);
        const done = values.reduce((sum, value) => sum + value.uploaded, 0);
        const complete = values.filter(value => value.state === 'Completed').length;
        const active = values.find(value => value.state !== 'Completed');
        this.app.progressManager.safeUpdateProgress({
            currentFile: active ? `${active.state}: ${active.name}` : 'Upload complete',
            percentage: total ? (done / total) * 100 : 100,
            processed: complete, total: values.length,
            status: `${complete}/${values.length} files · ${(done / (1024 * 1024)).toFixed(1)} / ${(total / (1024 * 1024)).toFixed(1)} MiB`
        });
    }

    async handleFileUpload(items) {
        if (!items?.length) return;
        const session = this.createUploadSession();
        this.activeUploadSession = session;
        this.app.progressManager.setCurrentUpload(session);
        this.progress.clear();
        const destination = this.app.router.getCurrentPath();
        items.forEach(item => this.setFileProgress(this.fileKey(item, destination), item, 0, 'Queued'));
        document.querySelector('.upload-area')?.classList.add('uploading');
        this.app.progressManager.show('Uploading files');
        let cursor = 0, succeeded = 0, failed = 0;
        const next = async () => {
            while (true) {
                this.ensureActive(session);
                const index = cursor++;
                if (index >= items.length) return;
                try { await this.uploadFile(items[index], destination, session); succeeded++; }
                catch (error) { if (this.isAbortError(error)) throw error; failed++; console.error('Upload failed', items[index].relativePath, error); this.setFileProgress(this.fileKey(items[index], destination), items[index], 0, 'Failed'); }
                await yieldToBrowser();
            }
        };
        try {
            await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_FILES, items.length) }, next));
            this.app.ui.showToast(failed ? 'Upload completed with errors' : 'Upload complete', `${succeeded} uploaded${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'success');
            this.app.api.directoryEtags.delete(destination);
            await this.app.loadFiles(destination);
        } catch (error) {
            if (this.isAbortError(error)) this.app.ui.showToast('Upload paused', 'Progress has been saved. Select the same files again to resume.', 'info');
            else this.handleUploadError(error.message);
        } finally {
            document.querySelector('.upload-area')?.classList.remove('uploading');
            if (this.activeUploadSession === session) this.activeUploadSession = null;
            if (this.app.progressManager.currentUpload === session) this.app.progressManager.setCurrentUpload(null);
            this.notifyJobsChanged();
        }
    }

    async handleFileDrop(event) {
        if (this._processingDrop) return;
        this._processingDrop = true;
        try {
            this.app.progressManager.show('Scanning dropped files');
            const items = await this.processDroppedItems(event.dataTransfer);
            if (items.length) await this.handleFileUpload(items);
            else { this.app.progressManager.hide(); this.app.ui.showToast('Info', 'No files found to upload', 'info'); }
        } catch (error) { this.handleUploadError('Failed to scan dropped items: ' + error.message); }
        finally { this._processingDrop = false; }
    }

    async processDroppedItems(dataTransfer) {
        const files = [];
        let scanned = 0;
        const visit = async (entry, parent = '') => {
            if (entry.isFile) {
                const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                files.push({ file, relativePath: parent + file.name });
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                while (true) {
                    const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
                    if (!entries.length) break;
                    for (const child of entries) { await visit(child, `${parent}${entry.name}/`); if (++scanned % 50 === 0) await yieldToBrowser(); }
                }
            }
        };
        if (dataTransfer.items) for (const item of dataTransfer.items) { const entry = item.webkitGetAsEntry?.(); if (entry) await visit(entry); }
        else for (const file of dataTransfer.files) files.push({ file, relativePath: file.name });
        return files;
    }

    handleUploadError(message) {
        console.error(message);
        this.app.progressManager.showError(message);
        this.app.ui.showToast('Upload error', message, 'error');
    }
}
