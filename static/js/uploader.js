// Resumable uploader: file bytes stay in the browser File object and each
// request owns only one Blob slice. IndexedDB stores session metadata only.
import { FileSystemPicker } from './file-system-picker.js';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MIN_CONCURRENT_FILES = 2;
const AIMD_DECISION_INTERVAL_MS = 1500;
const AIMD_DECREASE_FACTOR = 0.7;
// 1 Gbps / many 1 MiB objects benefits from overlapping request lifecycle
// latency. AIMD normally settles below this ceiling when disk or network
// contention appears.
const MAX_CONCURRENT_FILES = 32;
const MAX_RETRIES = 5;
const PREPARE_BATCH_SIZE = 500;
const DB_NAME = 'puremania-upload-sessions';
const DB_STORE = 'sessions';

// Web Crypto is only exposed in secure contexts by some browsers. Uploads are
// also supported over a local HTTP connection, so retain SHA-256 fingerprints
// with a small synchronous fallback when crypto.subtle is unavailable.
const SHA256_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotateRight = (value, amount) => (value >>> amount) | (value << (32 - amount));
const hexDigest = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

function sha256Fallback(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const words = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
        for (let index = 16; index < 64; index++) {
            const a = words[index - 15];
            const b = words[index - 2];
            words[index] = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) + words[index - 16] +
                (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) + words[index - 7];
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index++) {
            const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temp1 = (h + sigma1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
            const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sigma0 + majority) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
    }
    const result = new Uint8Array(32);
    const resultView = new DataView(result.buffer);
    hash.forEach((value, index) => resultView.setUint32(index * 4, value));
    return hexDigest(result);
}

async function sha256Hex(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle?.digest) {
        try { return hexDigest(new Uint8Array(await subtle.digest('SHA-256', bytes))); }
        catch (error) { console.warn('Web Crypto digest failed; using the upload fingerprint fallback', error); }
    }
    return sha256Fallback(bytes);
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Upload interrupted', 'AbortError')); }, { once: true });
});
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

class AdaptiveUploadController {
    constructor() {
        this.target = MIN_CONCURRENT_FILES;
        this.speedEWMA = 0;
        this.lastDecisionAt = performance.now();
        this.serverCap = MAX_CONCURRENT_FILES;
        this.congested = false;
    }

    record({ bytes, elapsed, queueDelay = 0, writeTime = 0, capacity = 0, active = 0 }) {
        const speed = elapsed > 0 ? bytes / elapsed * 1000 : 0;
        this.speedEWMA = this.speedEWMA ? this.speedEWMA * 0.75 + speed * 0.25 : speed;
        if (capacity > 0) {
            this.serverCap = Math.max(1, Math.min(MAX_CONCURRENT_FILES, capacity));
            this.serverActive = Math.max(0, active);
        }
        // Queueing longer than the write itself is a server-side congestion signal.
        this.congested ||= queueDelay > 100 && queueDelay > writeTime;
    }

    recordFailure(status = 0) {
        if (!status || status === 429 || status >= 500) this.congested = true;
    }

    adjust() {
        const now = performance.now();
        if (now - this.lastDecisionAt < AIMD_DECISION_INTERVAL_MS) return this.target;
        const heap = performance.memory;
        const memoryPressure = heap && heap.jsHeapSizeLimit > 0 && heap.usedJSHeapSize / heap.jsHeapSizeLimit > 0.80;
        const ceiling = Math.min(MAX_CONCURRENT_FILES, this.serverCap);
        const floor = Math.min(MIN_CONCURRENT_FILES, ceiling);
        if (this.congested || memoryPressure) {
            this.target = Math.max(floor, Math.floor(this.target * AIMD_DECREASE_FACTOR));
        } else if (this.target > ceiling) {
            this.target = ceiling;
        } else if (this.target < ceiling) {
            // Canonical AIMD: increase additively whenever no congestion
            // signal is present. The EWMA remains useful for telemetry, but
            // it must not gate progress on an arbitrary 7% improvement.
            this.target++;
        }
        this.lastDecisionAt = now;
        this.congested = false;
        return this.target;
    }
}

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
            let result;
            request.onsuccess = () => { result = request.result; };
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        });
    }
}

export { AdaptiveUploadController };

export class Uploader {
    constructor(app) {
        this.app = app;
        this._processingDrop = false;
        this.store = new UploadSessionStore();
        this.filePicker = new FileSystemPicker();
        this.resumeRequest = null;
        this.createResumeInputs();
    }

    get activeBatch() {
        const uploads = this.app.store.getState().uploads;
        return uploads.activeBatchId ? uploads.batches.get(uploads.activeBatchId) : null;
    }
    get activeUploadSession() { return this.activeBatch?.session || null; }
    set activeUploadSession(session) {
        if (!session) {
            this.app.store.update('uploads', { activeBatchId: null, batches: new Map(), status: 'idle' }, 'UPLOAD_BATCH_CHANGED');
            return;
        }
        const id = createUniqueId();
        const batch = { id, session, progress: new Map(), stats: null, status: 'running' };
        this.app.store.update('uploads', { activeBatchId: id, batches: new Map([[id, batch]]), status: 'running' }, 'UPLOAD_BATCH_CHANGED');
    }
    get progress() { return this.activeBatch?.progress || new Map(); }
    get uploadStats() { return this.activeBatch?.stats || null; }
    set uploadStats(stats) {
        const batch = this.activeBatch;
        if (!batch) return;
        const updated = { ...batch, stats };
        this.app.store.update('uploads', { batches: new Map([[batch.id, updated]]) }, 'UPLOAD_STATS_CHANGED');
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

    async showUploadDialog(fallbackSelector = '.upload-input-files') {
        return this.openPicker(
            () => this.filePicker.pickFiles(),
            () => document.querySelector(fallbackSelector)?.click()
        );
    }

    async showDirectoryDialog(fallbackSelector = '.upload-input-folders') {
        return this.openPicker(
            () => this.filePicker.pickDirectory(),
            () => document.querySelector(fallbackSelector)?.click()
        );
    }

    async openPicker(pick, fallback) {
        try {
            const items = await pick();
            if (items === null) {
                fallback();
                return 'fallback';
            } else if (items.length) {
                await this.handleUploadItems(items);
            }
            return 'selected';
        } catch (error) {
            if (error.name === 'AbortError') return 'cancelled';
            console.warn('Native file picker unavailable; using the input fallback', error);
            fallback();
            return 'fallback';
        }
    }

    createResumeInputs() {
        const create = (className, directory) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.hidden = true;
            input.className = className;
            if (directory) input.setAttribute('webkitdirectory', '');
            input.addEventListener('change', () => { void this.handleSelectedFileList(input); });
            input.addEventListener('cancel', () => { this.resumeRequest = null; });
            document.body.appendChild(input);
        };
        create('resume-upload-input-files', false);
        create('resume-upload-input-folders', true);
    }

    async handleSelectedFileList(input) {
        if (!input.files?.length) return;
        const files = await this.createUploadItems(input.files);
        input.value = '';
        await this.handleUploadItems(files);
    }

    async handleUploadItems(files) {
        let destination = null;
        if (this.resumeRequest) {
            const request = this.resumeRequest;
            this.resumeRequest = null;
            destination = request.destination;
            const requestedFiles = [];
            for (let index = 0; index < files.length; index++) {
                if (request.keys.has(this.fileKey(files[index], destination))) requestedFiles.push(files[index]);
                if (index > 0 && index % PREPARE_BATCH_SIZE === 0) await yieldToBrowser();
            }
            if (requestedFiles.length !== request.keys.size) {
                this.app.ui.showToast('Resume upload', 'Choose the original file or folder to resume this upload.', 'warning');
                return;
            }
            await this.discardWrongRouteDuplicates(requestedFiles, destination);
            await this.handleFileUpload(requestedFiles, destination);
            return;
        }
        await this.handleFileUpload(files, destination);
    }

    bindUploadEvents() {
        const area = document.querySelector('.upload-area');
        if (!area) return;
        const filesInput = area.querySelector('.upload-input-files');
        const foldersInput = area.querySelector('.upload-input-folders');
        const selectFiles = area.querySelector('.btn-select-files');
        const selectFolders = area.querySelector('.btn-select-folders');
        filesInput.addEventListener('change', () => { void this.handleSelectedFileList(filesInput); });
        foldersInput.addEventListener('change', () => { void this.handleSelectedFileList(foldersInput); });
        filesInput.addEventListener('cancel', () => { this.resumeRequest = null; });
        foldersInput.addEventListener('cancel', () => { this.resumeRequest = null; });
        selectFiles.addEventListener('click', event => { event.preventDefault(); void this.showUploadDialog(); });
        selectFolders.addEventListener('click', event => { event.preventDefault(); void this.showDirectoryDialog(); });
        let dragDepth = 0;
        area.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; area.classList.add('dragover'); });
        area.addEventListener('dragover', event => event.preventDefault());
        area.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; area.classList.remove('dragover'); } });
        area.addEventListener('drop', event => {
            event.preventDefault();
            event.stopPropagation();
            dragDepth = 0;
            area.classList.remove('dragover');
            void this.handleFileDrop(event);
        });
    }

    fileKey(item, destination) {
        const { file, relativePath } = item;
        return `${destination}|${relativePath}|${file.size}|${file.lastModified}`;
    }

    async fileFingerprint(file) {
        const sample = 1024 * 1024;
        const first = await file.slice(0, sample).arrayBuffer();
        const last = await file.slice(Math.max(0, file.size - sample)).arrayBuffer();
        const bytes = new Uint8Array(first.byteLength + last.byteLength + 8);
        bytes.set(new Uint8Array(first));
        bytes.set(new Uint8Array(last), first.byteLength);
        new DataView(bytes.buffer).setFloat64(bytes.length - 8, file.size);
        return sha256Hex(bytes);
    }

    async fileRangeFingerprint(file, offset, length) {
        const bytes = await file.slice(offset, offset + length).arrayBuffer();
        return sha256Hex(bytes);
    }

    async createUploadItems(fileList) {
        const items = new Array(fileList.length);
        for (let index = 0; index < fileList.length; index++) {
            const file = fileList[index];
            items[index] = { file, relativePath: file.webkitRelativePath || file.name };
            if (index > 0 && index % PREPARE_BATCH_SIZE === 0) await yieldToBrowser();
        }
        return items;
    }

    async initializeUploadStats(items, session) {
        let totalBytes = 0;
        for (let index = 0; index < items.length; index++) {
            totalBytes += items[index].file.size;
            if (index > 0 && index % PREPARE_BATCH_SIZE === 0) {
                this.ensureActive(session);
                await yieldToBrowser();
            }
        }
        this.uploadStats = { total: items.length, totalBytes, uploadedBytes: 0, completed: 0, failed: 0 };
    }

    async requestResume(key) {
        return this.requestResumeMany([key]);
    }

    async requestResumeMany(keys) {
        const records = (await Promise.all(keys.map(key => this.store.get(key)))).filter(Boolean);
        if (!records.length) throw new Error('Saved upload sessions were not found');
        const destinations = new Set(records.map(record => record.destination));
        if (destinations.size !== 1) throw new Error('Select uploads with the same destination to resume together');
        const hasFolderUpload = records.some(record => record.relativePath.includes('/'));
        this.resumeRequest = { keys: new Set(records.map(record => record.key)), destination: records[0].destination };
        let result;
        if (hasFolderUpload) {
            result = await this.showDirectoryDialog('.resume-upload-input-folders');
        } else {
            result = await this.showUploadDialog('.resume-upload-input-files');
        }
        if (result === 'cancelled') this.resumeRequest = null;
    }

    async listJobs(signal) {
        let records = [];
        try { records = await this.store.getAll(); } catch (_) { return []; }
        // /system/uploads is a client-side route, not a writable virtual path.
        // Remove sessions created by the pre-fix resume flow so they cannot
        // continue as duplicate uploads or remain misleading in this list.
        const invalidRouteRecords = records.filter(record => record.destination === '/system/uploads');
        if (invalidRouteRecords.length) {
            await mapWithConcurrency(invalidRouteRecords, 6, record => this.discardJob(record.key));
            records = records.filter(record => record.destination !== '/system/uploads');
        }
        const jobs = await mapWithConcurrency(records, 6, async record => {
            try {
                const status = await this.apiJSON(record.url, { signal });
                const active = this.activeUploadSession && this.progress.has(record.key);
                return { ...record, uploadedBytes: status.uploadedBytes, totalBytes: status.totalBytes, completed: status.completed, state: status.completed ? 'completed' : active ? 'active' : 'paused' };
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                if (error.status === 404) { await this.store.remove(record.key); return null; }
                return { ...record, uploadedBytes: record.uploadedBytes || 0, totalBytes: record.size, state: 'offline' };
            }
        });
        return jobs.filter(Boolean);
    }

    async discardJob(key) {
        const record = await this.store.get(key);
        if (!record) return;
        try { await fetch(record.url, { method: 'DELETE' }); } finally { await this.store.remove(key); this.notifyJobsChanged(); }
    }

    async discardWrongRouteDuplicates(items, destination) {
        if (destination === '/system/uploads') return;
        let records;
        try { records = await this.store.getAll(); } catch (_) { return; }
        const wrongKeys = new Set(items.map(item => this.fileKey(item, '/system/uploads')));
        const wrong = records.filter(record => record.destination === '/system/uploads' && wrongKeys.has(record.key));
        await Promise.all(wrong.map(record => this.discardJob(record.key)));
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
        const fingerprint = await this.fileFingerprint(item.file);
        let saved;
        try { saved = await this.store.get(key); } catch (error) { console.warn('IndexedDB unavailable; upload cannot survive reload', error); }
        if (saved) {
            try {
                const status = await this.apiJSON(saved.url, { signal: session.signal });
                const resumeMatches = !status.resumeFingerprint ||
                    status.resumeFingerprint === await this.fileRangeFingerprint(item.file, status.resumeOffset, status.uploadedBytes - status.resumeOffset);
                if (!status.completed && status.totalBytes === item.file.size && status.fingerprint === fingerprint && resumeMatches) return { key, ...saved, uploadedBytes: status.uploadedBytes };
                if (status.completed) await this.store.remove(key);
            } catch (error) {
                if (this.isAbortError(error)) throw error;
                if (error.status === 404) try { await this.store.remove(key); } catch (_) { /* storage is optional */ }
            }
        }
        const created = await this.apiJSON('/api/files/upload-sessions', {
            method: 'POST', signal: session.signal,
            body: JSON.stringify({ path: destination, relativePath: item.relativePath, size: item.file.size, fingerprint })
        });
        const record = { key, id: created.uploadId, url: created.uploadURL, destination, relativePath: item.relativePath, size: item.file.size, fingerprint, updatedAt: Date.now() };
        try { await this.store.put(record); this.notifyJobsChanged(); } catch (_) { /* upload itself must still work */ }
        return { ...record, uploadedBytes: created.uploadedBytes || 0 };
    }

    async queryPosition(record, session) {
        const state = await this.apiJSON(record.url, { signal: session.signal });
        return state.uploadedBytes;
    }

    sendChunk(record, blob, start, end, total, session, onProgress, controller) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const startedAt = performance.now();
            const abort = () => xhr.abort();
            session.signal.addEventListener('abort', abort, { once: true });
            const cleanup = () => session.signal.removeEventListener('abort', abort);
            xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(start + event.loaded); };
            xhr.onload = () => {
                cleanup();
                if (xhr.status === 200 || xhr.status === 308) {
                    controller?.record({
                        bytes: end - start + 1,
                        elapsed: performance.now() - startedAt,
                        queueDelay: Number(xhr.getResponseHeader('Upload-Queue-Delay')) || 0,
                        writeTime: Number(xhr.getResponseHeader('Upload-Write-Time')) || 0,
                        capacity: Number(xhr.getResponseHeader('Upload-Concurrency-Capacity')) || 0,
                        active: Number(xhr.getResponseHeader('Upload-Concurrency-Active')) || 0
                    });
                    try {
                        const result = JSON.parse(xhr.responseText);
                        if (!Number.isInteger(result.uploadedBytes) || result.uploadedBytes < start || result.uploadedBytes > end + 1) throw new Error('Invalid upload position');
                        resolve(result);
                    } catch (error) { reject(error); }
                } else { controller?.recordFailure(xhr.status); reject(new Error(`Chunk rejected (${xhr.status})`)); }
            };
            xhr.onerror = () => { cleanup(); controller?.recordFailure(); reject(new Error('Network error while sending chunk')); };
            xhr.onabort = () => { cleanup(); reject(new DOMException('Upload interrupted', 'AbortError')); };
            if (!session.trackXhr(xhr)) { cleanup(); reject(new DOMException('Upload interrupted', 'AbortError')); return; }
            xhr.open('PUT', `${record.url}/chunks`);
            xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.send(blob);
        });
    }

    async uploadFile(item, destination, session, controller) {
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
                        uploaded => this.setFileProgress(record.key, item, uploaded, 'Uploading'), controller);
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
                    await pause((2 ** attempt) * 1000 + Math.floor(Math.random() * 250), session.signal);
                }
            }
            try { await this.store.put({ ...record, uploadedBytes: offset, updatedAt: Date.now() }); this.notifyJobsChanged(); } catch (_) { /* optional */ }
        }
        await this.apiJSON(`${record.url}/complete`, { method: 'POST', signal: session.signal });
        try { await this.store.remove(record.key); this.notifyJobsChanged(); } catch (_) { /* optional */ }
        this.setFileProgress(record.key, item, item.file.size, 'Completed');
        this.progress.delete(record.key);
    }

    setFileProgress(key, item, uploaded, state) {
        const previous = this.progress.get(key);
        const current = Math.min(uploaded, item.file.size);
        this.progress.set(key, { name: item.relativePath, total: item.file.size, uploaded: current, state });
        if (this.uploadStats) this.uploadStats.uploadedBytes += current - (previous?.uploaded || 0);
        const values = [...this.progress.values()];
        const total = this.uploadStats?.totalBytes || values.reduce((sum, value) => sum + value.total, 0);
        const done = this.uploadStats?.uploadedBytes || values.reduce((sum, value) => sum + value.uploaded, 0);
        const complete = (this.uploadStats?.completed || 0) + (this.uploadStats?.failed || 0);
        const active = values.find(value => value.state !== 'Completed');
        this.app.progressManager.safeUpdateProgress({
            currentFile: active ? `${active.state}: ${active.name}` : 'Upload complete',
            percentage: total ? (done / total) * 100 : 100,
            processed: complete, total: this.uploadStats?.total || values.length,
            status: `${complete}/${this.uploadStats?.total || values.length} files · ${(done / (1024 * 1024)).toFixed(1)} / ${(total / (1024 * 1024)).toFixed(1)} MiB`
        });
    }

    async handleFileUpload(items, destinationOverride = null) {
        if (!items?.length) return;
        if (this.activeUploadSession) {
            this.app.ui.showToast('Upload in progress', 'Pause or finish the current upload first.', 'warning');
            return;
        }
        const session = this.createUploadSession();
        this.activeUploadSession = session;
        const destination = destinationOverride || this.app.router.getCurrentPath();
        this.progress.clear();
        document.querySelector('.upload-area')?.classList.add('uploading');
        this.app.progressManager.show('Uploading files');
        await this.initializeUploadStats(items, session);
        let cursor = 0, succeeded = 0, failed = 0;
        const controller = new AdaptiveUploadController();
        const inFlight = new Set();
        const start = (item) => {
            let task;
            task = (async () => {
                try { await this.uploadFile(item, destination, session, controller); succeeded++; this.uploadStats.completed++; }
                catch (error) { if (this.isAbortError(error)) throw error; controller.recordFailure(error.status); failed++; this.uploadStats.failed++; console.error('Upload failed', item.relativePath, error); this.setFileProgress(this.fileKey(item, destination), item, 0, 'Failed'); this.progress.delete(this.fileKey(item, destination)); }
                finally { inFlight.delete(task); }
            })();
            inFlight.add(task);
        };
        try {
            while (cursor < items.length || inFlight.size) {
                this.ensureActive(session);
                const target = Math.min(items.length, controller.adjust());
                while (cursor < items.length && inFlight.size < target) start(items[cursor++]);
                if (inFlight.size) await Promise.race(inFlight);
                await yieldToBrowser();
            }
            this.app.progressManager.safeUpdateProgress({
                currentFile: 'Upload complete', percentage: 100, processed: succeeded + failed, total: items.length,
                status: `${succeeded}/${items.length} files uploaded${failed ? `, ${failed} failed` : ''}`
            });
            this.app.ui.showToast(failed ? 'Upload completed with errors' : 'Upload complete', `${succeeded} uploaded${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'success');
            this.app.api.directoryEtags.delete(destination);
            if (this.app.router.getCurrentPath() === destination) await this.app.loadFiles(destination);
        } catch (error) {
            if (this.isAbortError(error)) this.app.ui.showToast('Upload paused', 'Progress has been saved. Select the same files again to resume.', 'info');
            else this.handleUploadError(error.message);
        } finally {
            document.querySelector('.upload-area')?.classList.remove('uploading');
            if (this.activeUploadSession === session) this.activeUploadSession = null;
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
                const file = await new Promise(resolve => entry.file(resolve, () => resolve(null)));
                if (file) files.push({ file, relativePath: parent + file.name });
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                while (true) {
                    const entries = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
                    if (!entries.length) break;
                    for (const child of entries) {
                        await visit(child, `${parent}${entry.name}/`);
                        if (++scanned % 50 === 0) await yieldToBrowser();
                    }
                }
            }
        };
        const entries = dataTransfer.items ? [...dataTransfer.items]
            .filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter(Boolean) : [];
        if (entries.length) {
            // Each top-level directory is walked independently; readEntries is
            // called until empty, as required by Chromium's directory API.
            for (const entry of entries) await visit(entry);
        } else {
            for (const file of dataTransfer.files || []) files.push({ file, relativePath: file.webkitRelativePath || file.name });
        }
        return files;
    }

    handleUploadError(message) {
        console.error(message);
        this.app.progressManager.showError(message);
        this.app.ui.showToast('Upload error', message, 'error');
    }
}
import { createUniqueId } from './util.js';
