
export class Aria2cPageHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.isInAria2cMode = false;
        this.updateInterval = null;
        this.lastStatus = null;
        this.previousPath = '/'; // Store the path before entering this page
    }

    init() {
        // No initial event binding needed, will be triggered by router
    }

    enterAria2cMode() {
        if (this.isInAria2cMode) return;

        const currentPath = this.fileManager.router.getCurrentPath();
        if (currentPath !== '/system/aria2c') {
            this.previousPath = currentPath;
        }

        this.isInAria2cMode = true;
        this.fileManager.ui.showLoading();
        this.loadAria2cStatus();
        this.updateInterval = setInterval(() => this.loadAria2cStatus(), 2000); // Update every 2 seconds
        
        // Hide file browser elements not relevant to this page
        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = 'none';
    }

    exitAria2cMode() {
        if (!this.isInAria2cMode) return;
        this.isInAria2cMode = false;
        clearInterval(this.updateInterval);
        this.updateInterval = null;
        this.lastStatus = null;

        // Restore file browser elements
        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = '';

        // Navigate back to the previous path
        this.fileManager.router.navigate(this.previousPath);
    }

    async loadAria2cStatus() {
        try {
            const response = await fetch('/api/system/aria2c/status');
            const result = await response.json();

            if (result.success) {
                this.lastStatus = result.data;
                this.render(result.data);
            } else {
                this.fileManager.ui.showToast('Aria2c Error', result.message || 'Could not fetch status', 'error');
                // Stop trying if there is a persistent error
                clearInterval(this.updateInterval);
            }
        } catch (error) {
            console.error('Aria2c status fetch error:', error);
            this.fileManager.ui.showToast('Aria2c Error', 'Failed to connect to server for status', 'error');
            clearInterval(this.updateInterval);
        } finally {
            this.fileManager.ui.hideLoading();
        }
    }

    render(status) {
        const container = document.querySelector('.file-browser');
        if (!container) return;

        container.innerHTML = ''; // Clear previous content

        const header = this.createHeader();
        container.appendChild(header);

        if (!status) {
            container.appendChild(this.createNoDownloadsMessage());
            return;
        }

        const activeDownloads = status['aria2.tellActive'] || [];
        const waitingDownloads = Array.isArray(status['aria2.tellWaiting']) ? status['aria2.tellWaiting'] : [];
        const stoppedDownloads = status['aria2.tellStopped'] || [];

        if (activeDownloads.length === 0 && waitingDownloads.length === 0 && stoppedDownloads.length === 0) {
            container.appendChild(this.createNoDownloadsMessage());
            return;
        }
        
        container.appendChild(this.createSection('Active Downloads', activeDownloads, true));
        container.appendChild(this.createSection('Waiting Downloads', waitingDownloads, false));
        container.appendChild(this.createSection('Stopped/Finished Downloads', stoppedDownloads, false));
        
        this.bindActionEvents();
    }

    createHeader() {
        const header = document.createElement('div');
        header.className = 'aria2c-header';
        header.innerHTML = `
            <div class="aria2c-title">Aria2c Downloads</div>
            <div class="aria2c-controls">
                <button class="aria2c-back-btn btn">
                    <i class="fas fa-arrow-left"></i> Back to Files
                </button>
            </div>
        `;
        header.querySelector('.aria2c-back-btn').addEventListener('click', () => this.exitAria2cMode());
        return header;
    }

    createNoDownloadsMessage() {
        const noResults = document.createElement('div');
        noResults.className = 'no-search-results'; // Re-use style
        noResults.innerHTML = `
            <div class="no-search-results-icon">📥</div>
            <div class="no-search-results-text">No active or recent downloads</div>
            <div class="no-search-results-subtext">Use 'aria2c <URL>' in the search bar to start a new download.</div>
        `;
        return noResults;
    }

    createSection(title, downloads, isActive) {
        const section = document.createElement('div');
        section.className = 'aria2c-section';

        const h3 = document.createElement('h3');
        h3.textContent = `${title} (${downloads.length})`;
        section.appendChild(h3);

        if (downloads.length > 0) {
            const table = this.createTable(downloads, isActive);
            section.appendChild(table);
        }

        return section;
    }

    createTable(downloads, isActive) {
        const table = document.createElement('table');
        table.className = 'table-view aria2c-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>File Name</th>
                    <th>Size</th>
                    <th>Progress</th>
                    <th>Status</th>
                    <th>Speed</th>
                    <th>Actions</th>
                </tr>
            </thead>
        `;
        const tbody = document.createElement('tbody');
        downloads.forEach(item => {
            const tr = this.createTableRow(item, isActive);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
    }

    createTableRow(item, isActive) {
        const tr = document.createElement('tr');
        tr.dataset.gid = item.gid;

        const fileName = item.files && item.files.length > 0 ? this.getFileName(item.files[0].path) : 'N/A';
        const totalLength = parseInt(item.totalLength, 10);
        const completedLength = parseInt(item.completedLength, 10);
        const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
        const downloadSpeed = parseInt(item.downloadSpeed, 10);

        tr.innerHTML = `
            <td class="file-name" title="${fileName}">${fileName}</td>
            <td>${this.fileManager.ui.formatFileSize(totalLength)}</td>
            <td>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.toFixed(2)}%;"></div>
                    <span class="progress-text">${progress.toFixed(2)}%</span>
                </div>
            </td>
            <td>${item.status}</td>
            <td>${this.fileManager.ui.formatFileSize(downloadSpeed)}/s</td>
            <td class="actions">
                ${this.createActionButtons(item.status, item.gid)}
            </td>
        `;
        return tr;
    }
    
    getFileName(path) {
        return path.split('/').pop();
    }

    createActionButtons(status, gid) {
        let buttons = '';
        switch (status) {
            case 'active':
                buttons += `<button class="btn btn-sm btn-warning" data-action="pause" data-gid="${gid}">Pause</button>`;
                buttons += `<button class="btn btn-sm btn-danger" data-action="cancel" data-gid="${gid}">Cancel</button>`;
                break;
            case 'paused':
                buttons += `<button class="btn btn-sm btn-success" data-action="resume" data-gid="${gid}">Resume</button>`;
                buttons += `<button class="btn btn-sm btn-danger" data-action="cancel" data-gid="${gid}">Cancel</button>`;
                break;
            case 'complete':
                 buttons += `<button class="btn btn-sm btn-info" data-action="clear" data-gid="${gid}">Clear</button>`;
                break;
            case 'error':
            case 'removed':
                 buttons += `<button class="btn btn-sm btn-info" data-action="clear" data-gid="${gid}">Clear</button>`;
                break;
        }
        return buttons;
    }
    
    bindActionEvents() {
        const container = document.querySelector('.file-browser');
        container.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const gid = e.target.dataset.gid;
                this.handleDownloadAction(action, gid);
            });
        });
    }

    async handleDownloadAction(action, gid) {
        let apiAction = action;
        let method = 'POST';
        
        if (action === 'clear') {
            // 'clear' is a frontend action, translates to 'removeResult' on the backend
            apiAction = 'removeResult';
        }

        try {
            const response = await fetch('/api/system/aria2c/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: apiAction, gid: gid })
            });
            const result = await response.json();
            if (result.success) {
                this.fileManager.ui.showToast('Aria2c', `Action '${action}' successful for GID ${gid}.`, 'success');
                this.loadAria2cStatus(); // Refresh list
            } else {
                this.fileManager.ui.showToast('Aria2c Error', result.message || `Action '${action}' failed.`, 'error');
            }
        } catch (error) {
            console.error(`Aria2c action '${action}' error:`, error);
            this.fileManager.ui.showToast('Aria2c Error', `Failed to perform action '${action}'.`, 'error');
        }
    }
}
