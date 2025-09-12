export class ApiClient {
    constructor(app) {
        this.app = app;
        this.directoryEtags = new Map(); // ETagを保存するマップ
        this.directoryCache = new Map(); // ディレクトリの内容をキャッシュするマップ
    }

    async loadFiles(path) {
        try {
            this.app.ui.showLoading();
            
            const headers = {};
            const etag = this.directoryEtags.get(path);
            if (etag) {
                headers['If-None-Match'] = etag;
            }

            const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { headers });

            if (response.status === 304) {
                console.log(`Content for ${path} not modified. Using cache.`);
                if (this.directoryCache.has(path)) {
                    const cachedData = this.directoryCache.get(path);
                    this.app.ui.displayFiles(cachedData);
                    this.app.ui.updateBreadcrumb(path);
                    this.app.ui.updateSidebarActiveState(path);
                    this.app.router.updatePath(path);
                    this.app.ui.updateToolbar();
                }
                return;
            }

            if (!response.ok) {
                const errorResult = await response.json().catch(() => null);
                const message = errorResult?.message || `Failed to load files (status: ${response.status})`;
                this.app.ui.showToast('Error', message, 'error');
                this.app.ui.displayFiles([]);
                this.app.router.updatePath(path);
                return;
            }
            
            const newEtag = response.headers.get('ETag');
            if (newEtag) {
                this.directoryEtags.set(path, newEtag);
            }

            const result = await response.json();
            
            if (result.success) {
                this.directoryCache.set(path, result.data); // キャッシュに保存
                this.app.ui.displayFiles(result.data);
                this.app.ui.updateBreadcrumb(path);
                this.app.ui.updateSidebarActiveState(path);
                this.app.router.updatePath(path);
                this.app.ui.updateToolbar();
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
                this.app.ui.displayFiles([]);
                this.app.router.updatePath(path);
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to load files', 'error');
            console.error('Error loading files:', error);
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
        
        try {
            this.app.ui.showLoading();
            
            const response = await fetch('/api/files/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: path,
                    targetPath: newPath
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.app.ui.showToast('Success', 'File renamed successfully', 'success');
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(currentPath);
                this.app.loadFiles(currentPath);
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to rename file', 'error');
            console.error('Error renaming file:', error);
        } finally {
            this.app.ui.hideLoading();
        }
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
        
        try {
            this.app.ui.showLoading();
            
            const response = await fetch('/api/files/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: sourcePath,
                    targetPath: targetPath
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.app.ui.showToast('Success', `Moved "${fileName}" successfully`, 'success');
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(this.app.util.getParentPath(sourcePath));
                this.directoryEtags.delete(targetDir);
                this.app.loadFiles(currentPath);
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to move file', 'error');
            console.error('Error moving file:', error);
        } finally {
            this.app.ui.hideLoading();
        }
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
                    const response = await fetch('/api/files/move', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            sourcePath: sourcePath,
                            targetPath: targetPath
                        })
                    });
                    
                    const result = await response.json();
                    
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
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(currentPath);
                this.directoryEtags.delete(targetDir);
                this.app.loadFiles(currentPath);
                this.app.clearSelection();
            } else {
                this.app.ui.showToast('Error', 'All items failed to move', 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to move items', 'error');
            console.error('Error moving items:', error);
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async createNewFolder() {
        const folderName = prompt('Enter folder name:');
        if (!folderName) return;
        
        try {
            const response = await fetch('/api/files/mkdir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.app.router.getCurrentPath(),
                    name: folderName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.app.ui.showToast('Success', 'Folder created successfully', 'success');
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(currentPath);
                this.app.loadFiles(currentPath);
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to create folder', 'error');
            console.error('Error creating folder:', error);
        }
    }

    async createNewFile() {
        const fileName = prompt('Enter file name:');
        if (!fileName) return;
        
        try {
            const response = await fetch('/api/files/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.app.router.getCurrentPath(),
                    name: fileName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.app.ui.showToast('Success', 'File created successfully', 'success');
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(currentPath);
                this.app.loadFiles(currentPath);
                
                if (this.app.util.isEditableFile(result.data.path)) {
                    setTimeout(() => {
                        this.app.editFile(result.data.path);
                    }, 500);
                }
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to create file', 'error');
            console.error('Error creating file:', error);
        }
    }

    async deleteFile(path) {
        if (!confirm(`Are you sure you want to delete "${this.app.util.getBaseName(path)}?`)) return;

        try {
            const response = await fetch('/api/files/batch-delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ paths: [path] })
            });

            const result = await response.json();

            if (result.success) {
                this.app.ui.showToast('Success', 'File deleted successfully', 'success');
                this.app.clearSelection();
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(currentPath);
                this.app.loadFiles(currentPath);
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to delete file', 'error');
            console.error('Error deleting file:', error);
        }
    }

    async deleteSelectedFiles() {
        if (this.app.selectedFiles.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${this.app.selectedFiles.size} items?`)) return;

        try {
            const response = await fetch('/api/files/batch-delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ paths: Array.from(this.app.selectedFiles) })
            });

            const result = await response.json();

            if (result.success) {
                this.app.ui.showToast('Success', 'Files deleted successfully', 'success');
                this.app.clearSelection();
                const currentPath = this.app.router.getCurrentPath();
                this.directoryEtags.delete(currentPath);
                this.app.loadFiles(currentPath);
            } else {
                this.app.ui.showToast('Error', result.message, 'error');
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to delete files', 'error');
            console.error('Error deleting files:', error);
        }
    }

    downloadFile(path) {
        window.open(`/api/files/download?path=${encodeURIComponent(path)}`, '_blank');
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
                window.URL.revokeObjectURL(url);
                
                let message = `Downloaded ${successfulFiles} files successfully`;
                if (failedFiles > 0) {
                    message += `, ${failedFiles} files failed to be included.`;
                }
                this.app.ui.showToast('Success', message, 'success');
                this.app.progressManager.hide();

            } else {
                const error = await response.json();
                this.app.ui.showToast('Error', error.message || 'Failed to create zip archive', 'error');
                this.app.progressManager.hide();
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to download files', 'error');
            console.error('Error downloading files:', error);
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
                this.app.ui.showToast('Error', result.message, 'error');
                return null;
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to load file for editing', 'error');
            console.error('Error loading file:', error);
            return null;
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async getSpecificDirs() {
        try {
            const response = await fetch('/api/specific-dirs');
            const result = await response.json();
            
            if (result.success) {
                return result.data;
            } else {
                this.app.ui.showToast('Error', 'Failed to load specific directories', 'error');
                return [];
            }
        } catch (error) {
            this.app.ui.showToast('Error', 'Failed to load specific directories', 'error');
            console.error('Error fetching specific dirs:', error);
            return [];
        }
    }
}
