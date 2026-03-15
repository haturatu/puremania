export class Uploader {
    constructor(app) {
        this.app = app;
        this._processingDrop = false;
        this.activeUploadSession = null;
    }

    createUploadSession() {
        const controller = new AbortController();
        const xhrs = new Set();
        const session = {
            signal: controller.signal,
            aborted: false,
            abort: () => {
                if (session.aborted) return;
                session.aborted = true;
                controller.abort();
                xhrs.forEach(xhr => xhr.abort());
                xhrs.clear();
            },
            trackXhr: (xhr) => {
                if (session.signal.aborted) {
                    xhr.abort();
                    return false;
                }
                xhrs.add(xhr);
                xhr.addEventListener('loadend', () => {
                    xhrs.delete(xhr);
                }, { once: true });
                return true;
            }
        };
        return session;
    }

    ensureUploadActive(session) {
        if (!session || session.signal.aborted) {
            throw new DOMException('Upload aborted', 'AbortError');
        }
    }

    isAbortError(error) {
        return error?.name === 'AbortError';
    }

    showUploadDialog() {
        const uploadFilesInput = document.querySelector('.upload-input-files');
        if (uploadFilesInput) {
            uploadFilesInput.click();
        } else {
            console.error("Upload file input not found.");
            this.app.ui.showToast('Error', 'Could not initiate upload. Input not found.', 'error');
        }
    }

    bindUploadEvents() {
        const uploadArea = document.querySelector('.upload-area');
        if (!uploadArea) return;

        const uploadFilesInput = uploadArea.querySelector('.upload-input-files');
        const uploadFoldersInput = uploadArea.querySelector('.upload-input-folders');
        const btnSelectFiles = uploadArea.querySelector('.btn-select-files');
        const btnSelectFolders = uploadArea.querySelector('.btn-select-folders');

        const handleFiles = (files, isFolder = false) => {
            if (files && files.length > 0) {
                this.app.progressManager.show('Processing Files');
                this.app.progressManager.safeUpdateProgress({
                    currentFile: 'Preparing files...',
                    percentage: 0,
                    processed: 0,
                    total: files.length,
                    status: `Processing ${files.length} files`
                });

                const hasFolderStructure = !!files[0].webkitRelativePath;
                if (hasFolderStructure || isFolder) {
                    const folderName = files[0].webkitRelativePath ? 
                        files[0].webkitRelativePath.split('/')[0] : 
                        'selected folder';
                    this.app.ui.showToast('Info', `Uploading folder: ${folderName}`, 'info');
                }
                
                return this.handleFileUpload(files);
            }
            return Promise.resolve();
        };

        uploadFilesInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files);
                e.target.value = '';
                handleFiles(files, false);
            }
        });

        uploadFoldersInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files);
                e.target.value = '';
                handleFiles(files, true);
            }
        });

        btnSelectFiles.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadFilesInput.click();
        });
        
        btnSelectFolders.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadFoldersInput.click();
        });

        let dragCounter = 0;
        uploadArea.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter++;
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        
        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                uploadArea.classList.remove('dragover');
            }
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            uploadArea.classList.remove('dragover');
            
            if (e.target.closest('.upload-area')) {
                this.handleFileDrop(e);
            }
        });
    }

    async handleFileUpload(files) {
        if (!files || files.length === 0) return;
        const uploadSession = this.createUploadSession();
        const inFlight = [];
        this.activeUploadSession = uploadSession;
        this.app.progressManager.setCurrentUpload(uploadSession);
    
        try {
            if (!this.app.progressManager.progressOverlay ||
                this.app.progressManager.progressOverlay.style.display === 'none') {
                this.app.progressManager.show('Uploading Files');
            }
    
            this.app.progressManager.safeUpdateProgress({
                currentFile: 'Preparing parallel batch upload...',
                percentage: 0,
                processed: 0,
                total: files.length,
                status: `Preparing ${files.length} files for parallel processing`
            });
    
            const uploadArea = document.querySelector('.upload-area');
            if (uploadArea) uploadArea.classList.add('uploading');
    
            const BATCH_SIZE = 50;
            const MAX_PARALLEL_BATCHES = 5;
            const batches = [];
    
            for (let i = 0; i < files.length; i += BATCH_SIZE) {
                batches.push(Array.from(files).slice(i, i + BATCH_SIZE));
            }
    
            let totalProcessed = 0;
            let totalSuccessful = 0;
            let totalFailed = 0;
    
            let batchIndex = 0;
    
            while (batchIndex < batches.length || inFlight.length > 0) {
                this.ensureUploadActive(uploadSession);

                while (batchIndex < batches.length && inFlight.length < MAX_PARALLEL_BATCHES) {
                    this.ensureUploadActive(uploadSession);
                    const currentBatchIndex = batchIndex;
                    const batch = batches[currentBatchIndex];
    
                    this.app.progressManager.safeUpdateProgress({
                        currentFile: `Starting batch ${currentBatchIndex + 1}/${batches.length}...`,
                        percentage: (totalProcessed / files.length) * 90,
                        processed: totalProcessed,
                        total: files.length,
                        status: `Batch ${currentBatchIndex + 1}/${batches.length}: ${batch.length} files`
                    });
    
                    const promise = this.uploadBatch(batch, currentBatchIndex + 1, batches.length, uploadSession)
                        .then(result => {
                            this.ensureUploadActive(uploadSession);
                            totalSuccessful += result.successful;
                            totalFailed += result.failed;
                            totalProcessed += batch.length;
    
                            this.app.progressManager.safeUpdateProgress({
                                currentFile: `Batch ${currentBatchIndex + 1} completed`,
                                percentage: (totalProcessed / files.length) * 90,
                                processed: totalProcessed,
                                total: files.length,
                                status: `Completed: ${totalSuccessful} successful, ${totalFailed} failed`
                            });
                        })
                        .catch(error => {
                            if (this.isAbortError(error)) {
                                throw error;
                            }
                            console.error(`Batch ${currentBatchIndex + 1} failed:`, error);
                            totalFailed += batch.length;
                            totalProcessed += batch.length;
    
                            this.app.progressManager.safeUpdateProgress({
                                currentFile: `Batch ${currentBatchIndex + 1} failed`,
                                percentage: (totalProcessed / files.length) * 90,
                                processed: totalProcessed,
                                total: files.length,
                                status: `Batch error occurred, continuing...`
                            });
                        })
                        .finally(() => {
                            const idx = inFlight.indexOf(promise);
                            if (idx > -1) inFlight.splice(idx, 1);
                        });
    
                    inFlight.push(promise);
                    batchIndex++;
                }

                await Promise.race(inFlight);
            }

            this.ensureUploadActive(uploadSession);
    
            const finalResult = {
                successful: totalSuccessful,
                failedCount: totalFailed,
                total: files.length,
                message: `Parallel batch upload completed: ${totalSuccessful} files uploaded successfully`
            };
    
            this.app.progressManager.safeUpdateProgress({
                currentFile: 'Parallel upload complete!',
                percentage: 100,
                processed: totalSuccessful,
                total: files.length,
                status: `Completed: ${totalSuccessful} successful${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`
            });
    
            if (totalFailed > 0) {
                this.app.ui.showToast('Upload Complete',
                    `${finalResult.message}, ${totalFailed} failed`,
                    'warning');
            } else {
                this.app.ui.showToast('Success', finalResult.message, 'success');
            }
    
            this.showUploadCompleteDialog(finalResult).then(() => {
                this.app.progressManager.hide();
                const currentPath = this.app.router.getCurrentPath();
                this.app.api.directoryEtags.delete(currentPath); // Invalidate ETag
                this.app.loadFiles(currentPath);
            });
    
        } catch (error) {
            if (this.isAbortError(error) || uploadSession.signal.aborted) {
                await Promise.allSettled(inFlight);
                this.app.progressManager.hide();
                this.app.ui.showToast('Info', 'Upload canceled', 'info');
                return;
            }
            console.error('Error in parallel batch upload:', error);
            this.handleUploadError('Parallel batch upload failed: ' + error.message);
        } finally {
            const uploadArea = document.querySelector('.upload-area');
            if (uploadArea) uploadArea.classList.remove('uploading');
            if (this.activeUploadSession === uploadSession) {
                this.activeUploadSession = null;
            }
            if (this.app.progressManager.currentUpload === uploadSession) {
                this.app.progressManager.setCurrentUpload(null);
            }
        }
    }

    async uploadBatch(batchFiles, batchNumber, totalBatches, uploadSession) {
        const CONCURRENT_UPLOADS = 50;
        let completedFiles = 0;
        let successfulFiles = 0;
        let failedFiles = 0;

        const processFileChunk = async (fileChunk) => {
            const uploadPromises = fileChunk.map((file) => {
                return new Promise((fileResolve, fileReject) => {
                    this.ensureUploadActive(uploadSession);

                    const formData = new FormData();
                    formData.append('path', this.app.router.getCurrentPath());
                    formData.append('file', file);

                    const relativePath = file.webkitRelativePath || file.name;
                    formData.append('relativePath[]', relativePath);

                    const xhr = new XMLHttpRequest();
                    const handleAbort = () => {
                        xhr.abort();
                    };
                    const cleanupAbortListener = () => {
                        uploadSession.signal.removeEventListener('abort', handleAbort);
                    };

                    xhr.upload.addEventListener('progress', (e) => {
                        if (e.lengthComputable) {
                            const fileProgress = (e.loaded / e.total) * 100;
                            const overallProgress = ((batchNumber - 1) / totalBatches) * 90 +
                                ((completedFiles + (fileProgress / 100)) / batchFiles.length) * (90 / totalBatches);

                            this.app.progressManager.safeUpdateProgress({
                                currentFile: `Batch ${batchNumber}: Uploading ${file.name} (${Math.round(fileProgress)}%)`,
                                percentage: overallProgress,
                                processed: completedFiles,
                                total: batchFiles.length,
                                status: `Batch ${batchNumber}/${totalBatches}: ${completedFiles}/${batchFiles.length} completed`
                            });
                        }
                    });

                    xhr.addEventListener('load', () => {
                        completedFiles++;

                        if (xhr.status >= 200 && xhr.status < 300) {
                            try {
                                const response = JSON.parse(xhr.responseText);
                                if (response.success || (response.data && response.data.successful > 0)) {
                                    successfulFiles++;
                                } else {
                                    failedFiles++;
                                }
                            } catch (_) {
                                failedFiles++;
                            }
                        } else {
                            failedFiles++;
                        }

                        cleanupAbortListener();
                        fileResolve();
                    });

                    xhr.addEventListener('error', () => {
                        cleanupAbortListener();
                        completedFiles++;
                        failedFiles++;
                        fileResolve();
                    });

                    xhr.addEventListener('timeout', () => {
                        cleanupAbortListener();
                        completedFiles++;
                        failedFiles++;
                        fileResolve();
                    });

                    xhr.addEventListener('abort', () => {
                        cleanupAbortListener();
                        fileReject(new DOMException('Upload aborted', 'AbortError'));
                    });

                    uploadSession.signal.addEventListener('abort', handleAbort, { once: true });
                    if (!uploadSession.trackXhr(xhr)) {
                        cleanupAbortListener();
                        fileReject(new DOMException('Upload aborted', 'AbortError'));
                        return;
                    }

                    xhr.open('POST', '/api/files/upload');
                    xhr.send(formData);
                });
            });

            await Promise.all(uploadPromises);
        };

        const chunks = [];
        for (let i = 0; i < batchFiles.length; i += CONCURRENT_UPLOADS) {
            chunks.push(batchFiles.slice(i, i + CONCURRENT_UPLOADS));
        }

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            this.ensureUploadActive(uploadSession);
            const chunk = chunks[chunkIndex];

            this.app.progressManager.safeUpdateProgress({
                currentFile: `Batch ${batchNumber}: Processing chunk ${chunkIndex + 1}/${chunks.length}`,
                percentage: ((batchNumber - 1) / totalBatches) * 90 + (chunkIndex / chunks.length) * (90 / totalBatches),
                processed: completedFiles,
                total: batchFiles.length,
                status: `Batch ${batchNumber}/${totalBatches}: Starting parallel uploads`
            });

            await processFileChunk(chunk);

            if (chunkIndex < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        this.app.progressManager.safeUpdateProgress({
            currentFile: `Batch ${batchNumber} completed`,
            percentage: (batchNumber / totalBatches) * 90,
            processed: completedFiles,
            total: batchFiles.length,
            status: `Batch ${batchNumber} completed: ${successfulFiles} successful, ${failedFiles} failed`
        });

        return {
            successful: successfulFiles,
            failed: failedFiles,
        };
    }

    handleUploadError(message) {
        const uploadArea = document.querySelector('.upload-area');
        if (uploadArea) {
            uploadArea.classList.remove('uploading');
        }
        
        this.app.progressManager.showError(message);
        this.app.ui.showToast('Error', message, 'error');
        
        setTimeout(() => {
            this.app.progressManager.hide();
        }, 5000);
    }

    async handleFileDrop(e) {
        if (this._processingDrop) {
            return;
        }
        this._processingDrop = true;
        
        try {
            e.preventDefault();
            
            this.app.progressManager.show('Processing Files');
            this.app.progressManager.safeUpdateProgress({
                currentFile: 'Analyzing dropped items...',
                percentage: 0,
                processed: 0,
                total: 0,
                status: 'Scanning files and folders'
            });
    
            const allFiles = await this.processDroppedItems(e.dataTransfer);
            
            if (allFiles.length > 0) {
                this.app.progressManager.safeUpdateProgress({
                    currentFile: 'Starting upload...',
                    percentage: 0,
                    processed: 0,
                    total: allFiles.length,
                    status: `Found ${allFiles.length} files to upload`
                });
                
                await this.handleFileUpload(allFiles);
            } else {
                this.app.progressManager.hide();
                this.app.ui.showToast('Info', 'No files found to upload', 'info');
            }
        } catch (error) {
            console.error('Error processing dropped items:', error);
            this.app.progressManager.showError('Failed to process dropped items');
        } finally {
            this._processingDrop = false;
        }
    }

    async processDroppedItems(dataTransfer) {
        const allFiles = [];
        const processingPromises = [];
    
        if (dataTransfer.items) {
            for (let i = 0; i < dataTransfer.items.length; i++) {
                const item = dataTransfer.items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                        processingPromises.push(this.processEntry(entry, ''));
                    }
                }
            }
        } else {
            for (let i = 0; i < dataTransfer.files.length; i++) {
                allFiles.push(dataTransfer.files[i]);
            }
        }
    
        if (processingPromises.length > 0) {
            const results = await Promise.all(processingPromises);
            results.forEach(files => {
                allFiles.push(...files);
            });
        }
    
        this.app.progressManager.safeUpdateProgress({
            currentFile: 'Scan complete',
            percentage: 10,
            processed: 0,
            total: allFiles.length,
            status: `Ready to upload ${allFiles.length} files`
        });
    
        return allFiles;
    }

    async processEntry(entry, basePath = '') {
        const files = [];
        
        if (entry.isFile) {
            return new Promise((resolve) => {
                entry.file((file) => {
                    const relativePath = basePath + file.name;
                    Object.defineProperty(file, 'webkitRelativePath', {
                        value: relativePath,
                        configurable: true
                    });
                    resolve([file]);
                }, () => {
                    resolve([]);
                });
            });
        } else if (entry.isDirectory) {
            return new Promise((resolve) => {
                const reader = entry.createReader();
                
                const readAllEntries = async () => {
                    const allEntries = [];
                    
                    const readBatch = () => {
                        return new Promise((resolveBatch) => {
                            reader.readEntries((entries) => {
                                if (entries.length === 0) {
                                    resolveBatch(allEntries);
                                } else {
                                    allEntries.push(...entries);
                                    readBatch().then(resolveBatch);
                                }
                            }, () => {
                                resolveBatch(allEntries);
                            });
                        });
                    };
                    
                    return readBatch();
                };
                
                readAllEntries().then(async (entries) => {
                    const subPromises = entries.map(subEntry => 
                        this.processEntry(subEntry, basePath + entry.name + '/')
                    );
                    
                    try {
                        const results = await Promise.all(subPromises);
                        const flatFiles = results.flat();
                        resolve(flatFiles);
                    } catch {
                        resolve([]);
                    }
                });
            });
        }
        
        return [];
    }
    
    showUploadCompleteDialog(result) {
        return new Promise((resolve) => {
            const progressOverlay = this.app.progressManager.progressOverlay;
            if (!progressOverlay) {
                resolve();
                return;
            }
            
            const modal = progressOverlay.querySelector('.progress-modal');
            const statusElement = progressOverlay.querySelector('.progress-status');
            const closeBtn = progressOverlay.querySelector('.progress-close');
            
            if (statusElement) {
                if (result.failedCount > 0) {
                    statusElement.innerHTML = `
                        Upload completed with ${result.failedCount} errors.<br>
                        <strong>Click close to continue</strong>
                    `;
                    statusElement.style.color = 'var(--warning, #ff9800)';
                } else {
                    statusElement.innerHTML = `
                        All files uploaded successfully!<br>
                        <strong>Click close to continue</strong>
                    `;
                    statusElement.style.color = 'var(--success, #4caf50)';
                }
            }
            
            if (modal) {
                modal.style.border = result.failedCount > 0 ? 
                    '2px solid var(--warning, #ff9800)' : 
                    '2px solid var(--success, #4caf50)';
            }
            
            if (closeBtn) {
                closeBtn.style.display = 'block';
                closeBtn.style.background = result.failedCount > 0 ? 
                    'var(--warning, #ff9800)' : 
                    'var(--success, #4caf50)';
                closeBtn.style.color = 'white';
                closeBtn.style.fontWeight = 'bold';
                
                const newCloseBtn = closeBtn.cloneNode(true);
                closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                
                newCloseBtn.addEventListener('click', () => {
                    resolve();
                });
            }
            
            setTimeout(() => {
                resolve();
            }, 10000);
        });
    }
}
