export class ApiClient {
    constructor(app) {
        this.app = app;
        this.directoryEtags = new Map();
        this.directoryCache = new Map();
    }

    async postJson(url, payload) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await response.json();
    }

    getApiErrorMessage(result, fallbackMessage = 'Request failed') {
        return result?.message || fallbackMessage;
    }

    notifyApiError(message, { error = null, context = '' } = {}) {
        this.app.ui.showToast('Error', message, 'error');
        if (error) {
            const prefix = context ? `Error ${context}:` : 'Error:';
            console.error(prefix, error);
        }
    }

    async requestJson(url, {
        context = url,
        fallbackMessage = 'Request failed',
        toastOnError = true,
        validateSuccess = false
    } = {}) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                let apiError = null;
                try {
                    apiError = await response.json();
                } catch (_) {
                    // ignore parse errors for non-JSON error bodies
                }
                throw new Error(this.getApiErrorMessage(apiError, `${fallbackMessage} (status: ${response.status})`));
            }

            const result = await response.json();
            if (validateSuccess && !result.success) {
                throw new Error(this.getApiErrorMessage(result, fallbackMessage));
            }
            return result;
        } catch (error) {
            if (toastOnError) {
                this.notifyApiError(error.message || fallbackMessage, { error, context });
            } else {
                console.error(`Error ${context}:`, error);
            }
            return null;
        }
    }

    invalidateDirectory(path) {
        if (!path) return;
        this.directoryEtags.delete(path);
        this.directoryCache.delete(path);
    }

    invalidateDirectories(paths) {
        paths.forEach(path => this.invalidateDirectory(path));
    }

    async refreshCurrentDirectory(extraPaths = [], clearSelection = false) {
        const currentPath = this.app.router.getCurrentPath();
        this.invalidateDirectories([currentPath, ...extraPaths]);
        if (clearSelection) {
            this.app.clearSelection();
        }
        await this.app.loadFiles(currentPath);
    }

    async runMutation({
        endpoint,
        payload,
        successMessage,
        errorMessage,
        showLoading = false,
        onSuccess = null,
        logContext = endpoint
    }) {
        try {
            if (showLoading) this.app.ui.showLoading();
            const result = await this.postJson(endpoint, payload);

            if (!result.success) {
                this.notifyApiError(this.getApiErrorMessage(result, errorMessage));
                return { success: false, result };
            }

            if (successMessage) {
                this.app.ui.showToast('Success', successMessage, 'success');
            }

            if (onSuccess) {
                await onSuccess(result);
            }
            return { success: true, result };
        } catch (error) {
            this.notifyApiError(errorMessage, { error, context: logContext });
            return { success: false, error };
        } finally {
            if (showLoading) this.app.ui.hideLoading();
        }
    }

    async getFiles(path) {
        try {
            const headers = {};
            const etag = this.directoryEtags.get(path);
            if (etag && this.directoryCache.has(path)) {
                headers['If-None-Match'] = etag;
            }

            const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { headers });

            if (response.status === 304) {
                console.log(`Content for ${path} not modified. Using cache.`);
                return this.directoryCache.get(path);
            }

            if (!response.ok) {
                const errorResult = await response.json().catch(() => null);
                throw new Error(errorResult?.message || `Failed to fetch files (status: ${response.status})`);
            }
            
            const newEtag = response.headers.get('ETag');
            const result = await response.json();
            
            if (result.success) {
                const files = result.data || [];
                if (newEtag) {
                    this.directoryEtags.set(path, newEtag);
                }
                this.directoryCache.set(path, files);
                return files;
            } else {
                throw new Error(result.message || 'API returned success:false');
            }
        } catch (error) {
            console.error(`Error in getFiles for path ${path}:`, error);
            return null;
        }
    }

    async loadFiles(path) {
        try {
            this.app.ui.showLoading();
            const files = await this.getFiles(path);

            if (files !== null) {
                this.app.ui.displayFiles(files);
                this.app.ui.updateBreadcrumb(path);
                this.app.ui.updateSidebarActiveState(path);
                this.app.router.updatePath(path);
                this.app.ui.updateToolbar();
            } else {
                this.notifyApiError(`Failed to load directory: ${path}`);
                this.app.ui.displayFiles([]);
                this.app.router.updatePath(path);
            }
        } catch (error) {
            this.notifyApiError('An unexpected error occurred while loading files.', { error, context: 'in loadFiles' });
            this.app.ui.displayFiles([]);
            this.app.router.updatePath(path);
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async renameFile(path) {
        const newName = prompt('Enter new name:', this.app.util.getBaseName(path));
        if (!newName) return;
        
        const newPath = this.app.util.getParentPath(path) + '/' + newName;

        await this.runMutation({
            endpoint: '/api/files/move',
            payload: { sourcePath: path, targetPath: newPath },
            successMessage: 'File renamed successfully',
            errorMessage: 'Failed to rename file',
            showLoading: true,
            onSuccess: async () => this.refreshCurrentDirectory(),
            logContext: 'renaming file'
        });
    }

    async moveFile(sourcePath) {
        const fileName = this.app.util.getBaseName(sourcePath);
        const currentPath = this.app.router.getCurrentPath();
        const suggestedPath = currentPath !== '/' ? currentPath : this.app.util.getParentPath(sourcePath);
        
        const targetDir = prompt(`Move "${fileName}" to directory:`, suggestedPath);
        if (!targetDir) return;
        
        if (!this.app.util.isValidPath(targetDir)) {
            this.app.ui.showToast('Error', 'Invalid target path', 'error');
            return;
        }
        
        const targetPath = targetDir.endsWith('/') ? 
            targetDir + fileName : 
            targetDir + '/' + fileName;
        
        if (sourcePath === targetPath) {
            this.app.ui.showToast('Info', 'Source and target are the same', 'info');
            return;
        }
        
        await this.runMutation({
            endpoint: '/api/files/move',
            payload: { sourcePath, targetPath },
            successMessage: `Moved "${fileName}" successfully`,
            errorMessage: 'Failed to move file',
            showLoading: true,
            onSuccess: async () => {
                await this.refreshCurrentDirectory([this.app.util.getParentPath(sourcePath), targetDir]);
            },
            logContext: 'moving file'
        });
    }

    async moveSelected() {
        if (this.app.selectedFiles.size === 0) return;
        
        if (this.app.selectedFiles.size === 1) {
            const path = Array.from(this.app.selectedFiles)[0];
            this.moveFile(path);
        } else {
            await this.moveMultipleFiles();
        }
    }

    async moveMultipleFiles() {
        const firstFile = Array.from(this.app.selectedFiles)[0];
        const currentPath = this.app.router.getCurrentPath();
        const suggestedPath = currentPath !== '/' ? currentPath : this.app.util.getParentPath(firstFile);
        
        const targetDir = prompt(`Move ${this.app.selectedFiles.size} items to directory:`, suggestedPath);
        if (!targetDir) return;
        
        if (!this.app.util.isValidPath(targetDir)) {
            this.app.ui.showToast('Error', 'Invalid target path', 'error');
            return;
        }
        
        try {
            this.app.ui.showLoading();
            let successCount = 0;
            let failCount = 0;
            
            for (const sourcePath of this.app.selectedFiles) {
                const fileName = this.app.util.getBaseName(sourcePath);
                const targetPath = targetDir.endsWith('/') ? 
                    targetDir + fileName : 
                    targetDir + '/' + fileName;
                
                if (sourcePath === targetPath) {
                    failCount++;
                    continue;
                }
                
                try {
                    const result = await this.postJson('/api/files/move', { sourcePath, targetPath });
                    
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (error) {
                    failCount++;
                }
            }
            
            if (successCount > 0) {
                const message = `Moved ${successCount} item(s) successfully`;
                if (failCount > 0) {
                    this.app.ui.showToast('Move Complete', `${message}, ${failCount} failed`, 'warning');
                } else {
                    this.app.ui.showToast('Success', message, 'success');
                }
                await this.refreshCurrentDirectory([targetDir], true);
            } else {
                this.app.ui.showToast('Error', 'All items failed to move', 'error');
            }
        } catch (error) {
            this.notifyApiError('Failed to move items', { error, context: 'moving items' });
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async createNewFolder() {
        const folderName = prompt('Enter folder name:');
        if (!folderName) return;

        await this.runMutation({
            endpoint: '/api/files/mkdir',
            payload: { path: this.app.router.getCurrentPath(), name: folderName },
            successMessage: 'Folder created successfully',
            errorMessage: 'Failed to create folder',
            onSuccess: async () => this.refreshCurrentDirectory(),
            logContext: 'creating folder'
        });
    }

    async createNewFile() {
        const fileName = prompt('Enter file name:');
        if (!fileName) return;

        await this.runMutation({
            endpoint: '/api/files/create',
            payload: { path: this.app.router.getCurrentPath(), name: fileName },
            successMessage: 'File created successfully',
            errorMessage: 'Failed to create file',
            onSuccess: async (result) => {
                await this.refreshCurrentDirectory();
                if (this.app.util.isEditableFile(result.data.path)) {
                    setTimeout(() => {
                        this.app.editFile(result.data.path);
                    }, 500);
                }
            },
            logContext: 'creating file'
        });
    }

    async extractFile(path) {
        if (!confirm(`Are you sure you want to extract "${this.app.util.getBaseName(path)}"?`)) return;

        await this.runMutation({
            endpoint: '/api/files/extract',
            payload: { path },
            successMessage: 'File extracted successfully',
            errorMessage: 'Failed to extract file',
            showLoading: true,
            onSuccess: async () => this.refreshCurrentDirectory(),
            logContext: 'extracting file'
        });
    }

    async deleteFile(path) {
        if (!confirm(`Are you sure you want to delete "${this.app.util.getBaseName(path)}?`)) return;

        await this.runMutation({
            endpoint: '/api/files/delete',
            payload: { paths: [path] },
            successMessage: 'File deleted successfully',
            errorMessage: 'Failed to delete file',
            onSuccess: async () => this.refreshCurrentDirectory([], true),
            logContext: 'deleting file'
        });
    }

    async deleteSelectedFiles() {
        if (this.app.selectedFiles.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${this.app.selectedFiles.size} items?`)) return;

        await this.runMutation({
            endpoint: '/api/files/delete',
            payload: { paths: Array.from(this.app.selectedFiles) },
            successMessage: 'Files deleted successfully',
            errorMessage: 'Failed to delete files',
            onSuccess: async () => this.refreshCurrentDirectory([], true),
            logContext: 'deleting files'
        });
    }

    downloadFile(path) {
        // window.open can be blocked by iOS Safari popup blockers.
        // Changing window.location.href is more reliable for downloads.
        window.location.href = `/api/files/download?path=${encodeURIComponent(path)}`;
    }

    async downloadSelected() {
        if (this.app.selectedFiles.size === 0) return;
        
        let hasDirectory = false;
        for (const path of this.app.selectedFiles) {
            const fileItem = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
            if (fileItem && fileItem.dataset.isDir === 'true') {
                hasDirectory = true;
                break;
            }
        }
        
        if (this.app.selectedFiles.size === 1 && !hasDirectory) {
            const path = Array.from(this.app.selectedFiles)[0];
            this.downloadFile(path);
        } else {
            await this.downloadMultipleFiles();
        }
    }

    async downloadMultipleFiles() {
        try {
            this.app.progressManager.show('Preparing Download');
            this.app.progressManager.updateProgress({
                currentFile: 'Creating archive...',
                percentage: 0,
                processed: 0,
                total: this.app.selectedFiles.size,
                status: 'Initializing'
            });
            
            const response = await fetch('/api/files/download-zip', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    paths: Array.from(this.app.selectedFiles)
                })
            });
            
            if (response.ok) {
                const contentLength = response.headers.get('content-length');
                const successfulFiles = parseInt(response.headers.get('X-Zip-Successful-Files') || '0');
                const failedFiles = parseInt(response.headers.get('X-Zip-Failed-Files') || '0');
                
                const reader = response.body.getReader();
                const chunks = [];
                let receivedLength = 0;
                
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        break;
                    }
                    
                    chunks.push(value);
                    receivedLength += value.length;
                    
                    if (contentLength) {
                        const percentage = (receivedLength / parseInt(contentLength)) * 100;
                        this.app.progressManager.updateProgress({
                            currentFile: 'Downloading archive...',
                            percentage: percentage,
                            processed: Math.floor((percentage / 100) * this.app.selectedFiles.size),
                            total: this.app.selectedFiles.size,
                            status: `${Math.round(percentage)}% downloaded`
                        });
                    }
                }
                
                const blob = new Blob(chunks);
                
                this.app.progressManager.updateProgress({
                    currentFile: 'Saving files...',
                    percentage: 100,
                    processed: this.app.selectedFiles.size,
                    total: this.app.selectedFiles.size,
                    status: 'Complete'
                });
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'files.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                // Delay revoking the object URL to allow iOS Safari time to process the download
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                }, 30000); // 30 seconds delay
                
                let message = `Downloaded ${successfulFiles} files successfully`;
                if (failedFiles > 0) {
                    message += `, ${failedFiles} files failed to be included.`;
                }
                this.app.ui.showToast('Success', message, 'success');
                this.app.progressManager.hide();

            } else {
                const error = await response.json();
                this.notifyApiError(this.getApiErrorMessage(error, 'Failed to create zip archive'));
                this.app.progressManager.hide();
            }
        } catch (error) {
            this.notifyApiError('Failed to download files', { error, context: 'downloading files' });
            this.app.progressManager.hide();
        }
    }

    async fetchFileContent(path) {
        try {
            this.app.ui.showLoading();
            
            const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
            const result = await response.json();
            
            if (result.success) {
                return result.data.content;
            } else {
                this.notifyApiError(this.getApiErrorMessage(result, 'Failed to load file for editing'));
                return null;
            }
        } catch (error) {
            this.notifyApiError('Failed to load file for editing', { error, context: 'loading file' });
            return null;
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async getSpecificDirs() {
        const result = await this.requestJson('/api/specific-dirs', {
            context: 'fetching specific dirs',
            fallbackMessage: 'Failed to load specific directories',
            validateSuccess: true
        });
        if (!result) {
            return [];
        }
        return result.data;
    }

    async getAria2cStatus() {
        const result = await this.requestJson('/api/system/aria2c/status', {
            context: 'fetching aria2c status',
            fallbackMessage: 'Failed to fetch aria2c status',
            validateSuccess: true
        });
        if (!result) {
            return null;
        }
        return result.data;
    }

    async controlAria2cDownload(gid, action) {
        try {
            const response = await fetch('/api/system/aria2c/control', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gid, action })
            });
            const result = await response.json();
            if (result.success) {
                this.app.ui.showToast('Success', result.data.message || `Action ${action} successful`, 'success');
                return true;
            } else {
                throw new Error(result.message || `Failed to ${action} download`);
            }
        } catch (error) {
            this.notifyApiError(error.message, { error, context: `${action} download` });
            return false;
        }
    }

    async getConfig() {
        const result = await this.requestJson('/api/config', {
            context: 'fetching config',
            fallbackMessage: 'Could not load server configuration.',
            validateSuccess: true
        });
        if (!result) {
            return null;
        }
        return result.data;
    }

    async search(term, path, options, limit, offset) {
        const body = {
            term: term,
            path: path,
            useRegex: options.useRegex,
            caseSensitive: options.caseSensitive,
            scope: options.scope,
            maxResults: 10000, // This seems high, but matching original logic
            offset: offset,
            limit: limit
        };

        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    }

    async startAria2cDownload(url, path) {
        const response = await fetch('/api/system/aria2c/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                path: path
            })
        });
        return await response.json();
    }

    async getStorageInfo() {
        const result = await this.requestJson('/api/storage-info', {
            context: 'fetching storage info',
            fallbackMessage: 'Failed to fetch storage info',
            toastOnError: false
        });
        return result || { success: false, message: 'Failed to fetch storage info' };
    }
}
