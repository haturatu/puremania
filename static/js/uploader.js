export class Uploader {
    constructor(app) {
        this.app = app;
        this._processingDrop = false;
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
            const inFlight = [];
    
            while (batchIndex < batches.length || inFlight.length > 0) {
                while (batchIndex < batches.length && inFlight.length < MAX_PARALLEL_BATCHES) {
                    const currentBatchIndex = batchIndex;
                    const batch = batches[currentBatchIndex];
    
                    this.app.progressManager.safeUpdateProgress({
                        currentFile: `Starting batch ${currentBatchIndex + 1}/${batches.length}...`,
                        percentage: (totalProcessed / files.length) * 90,
                        processed: totalProcessed,
                        total: files.length,
                        status: `Batch ${currentBatchIndex + 1}/${batches.length}: ${batch.length} files`
                    });
    
                    const promise = this.uploadBatch(batch, currentBatchIndex + 1, batches.length)
                        .then(result => {
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
            console.error('Error in parallel batch upload:', error);
            this.handleUploadError('Parallel batch upload failed: ' + error.message);
        } finally {
            const uploadArea = document.querySelector('.upload-area');
            if (uploadArea) uploadArea.classList.remove('uploading');
        }
    }

    async uploadBatch(batchFiles, batchNumber, totalBatches) {
        const CONCURRENT_UPLOADS = 50;
        
        return new Promise((resolve) => {
            let completedFiles = 0;
            let successfulFiles = 0;
            let failedFiles = 0;
            
            const processFileChunk = async (fileChunk, chunkIndex) => {
                const uploadPromises = fileChunk.map((file, fileIndex) => {
                    return new Promise((fileResolve) => {
                        const formData = new FormData();
                        formData.append('path', this.app.router.getCurrentPath());
                        formData.append('file', file);
                        
                        const relativePath = file.webkitRelativePath || file.name;
                        formData.append('relativePath[]', relativePath);
                        
                        const xhr = new XMLHttpRequest();
                        
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
                                } catch (error) {
                                    failedFiles++;
                                }
                            } else {
                                failedFiles++;
                            }
                            
                            fileResolve();
                        });
                        
                        xhr.addEventListener('error', () => {
                            completedFiles++;
                            failedFiles++;
                            fileResolve();
                        });
                        
                        xhr.addEventListener('timeout', () => {
                            completedFiles++;
                            failedFiles++;
                            fileResolve();
                        });
                        
                        xhr.open('POST', '/api/files/upload');
                        xhr.send(formData);
                    });
                });
                
                await Promise.all(uploadPromises);
            };
            
            const processAllChunks = async () => {
                const chunks = [];
                for (let i = 0; i < batchFiles.length; i += CONCURRENT_UPLOADS) {
                    chunks.push(batchFiles.slice(i, i + CONCURRENT_UPLOADS));
                }
                
                for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                    const chunk = chunks[chunkIndex];
                    
                    this.app.progressManager.safeUpdateProgress({
                        currentFile: `Batch ${batchNumber}: Processing chunk ${chunkIndex + 1}/${chunks.length}`,
                        percentage: ((batchNumber - 1) / totalBatches) * 90 + (chunkIndex / chunks.length) * (90 / totalBatches),
                        processed: completedFiles,
                        total: batchFiles.length,
                        status: `Batch ${batchNumber}/${totalBatches}: Starting parallel uploads`
                    });
                    
                    await processFileChunk(chunk, chunkIndex);
                    
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
                
                resolve({
                    successful: successfulFiles,
                    failed: failedFiles,
                });
            };
            
            processAllChunks().catch(() => {
                resolve({
                    successful: successfulFiles,
                    failed: batchFiles.length - successfulFiles,
                });
            });
        });
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
