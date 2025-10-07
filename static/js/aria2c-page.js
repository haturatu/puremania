import { getTemplateContent } from './template.js';

export class Aria2cPageHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.isInAria2cMode = false;
        this.updateInterval = null;
        this.lastStatus = null;
        this.previousPath = '/'; // Store the path before entering this page
        this.torrentsToCancel = new Set(); // Track torrents scheduled for cancellation
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
        
        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = 'none';
    }

    exitAria2cMode() {
        if (!this.isInAria2cMode) return;
        this.isInAria2cMode = false;
        clearInterval(this.updateInterval);
        this.updateInterval = null;
        this.lastStatus = null;

        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = '';

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

        container.innerHTML = '';

        const header = this.createHeader();
        container.appendChild(header);

        if (!status) {
            container.appendChild(this.createNoDownloadsMessage());
            return;
        }

        const activeDownloads = Array.isArray(status['aria2.tellActive']) ? status['aria2.tellActive'] : [];
        const waitingDownloads = Array.isArray(status['aria2.tellWaiting']) ? status['aria2.tellWaiting'] : [];
        let stoppedDownloads = Array.isArray(status['aria2.tellStopped']) ? status['aria2.tellStopped'] : [];

        for (const item of activeDownloads) {
            if (!item.bittorrent) continue;
            const totalLength = parseInt(item.totalLength, 10);
            const completedLength = parseInt(item.completedLength, 10);
            const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
            const gid = item.gid;

            if (progress >= 100 && !this.torrentsToCancel.has(gid)) {
                this.torrentsToCancel.add(gid);
                setTimeout(() => {
                    this.handleDownloadAction('cancel', gid).finally(() => {
                        this.torrentsToCancel.delete(gid);
                    });
                }, 30000);
            }
        }

        stoppedDownloads = stoppedDownloads.filter(item => {
            if (item.followedBy && item.followedBy.length > 0) return false;
            if (item.bittorrent && item.status !== 'complete') return false;
            return true;
        });

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
        const template = getTemplateContent('/static/templates/components/aria2c_header.html');
        header.appendChild(template);
        header.querySelector('.aria2c-back-btn').addEventListener('click', () => this.exitAria2cMode());
        return header;
    }

    createNoDownloadsMessage() {
        const noResults = document.createElement('div');
        noResults.className = 'no-search-results';
        const template = getTemplateContent('/static/templates/components/aria2c_no_downloads.html');
        noResults.appendChild(template);
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
        const template = getTemplateContent('/static/templates/components/aria2c_table.html');
        table.appendChild(template);
        
        const tbody = table.querySelector('tbody');
        downloads.forEach(item => {
            const tr = this.createTableRow(item, isActive);
            tbody.appendChild(tr);
        });
        return table;
    }

    createTableRow(item, isActive) {
        const tr = document.createElement('tr');
        tr.dataset.gid = item.gid;

        const template = getTemplateContent('/static/templates/components/aria2c_table_row.html');
        const fileName = item.files && item.files.length > 0 ? this.getFileName(item.files[0].path) : 'N/A';
        const totalLength = parseInt(item.totalLength, 10);
        const completedLength = parseInt(item.completedLength, 10);
        const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
        const downloadSpeed = parseInt(item.downloadSpeed, 10);

        template.querySelector('.file-name').textContent = fileName;
        template.querySelector('.file-name').title = fileName;
        template.querySelector('.file-size').textContent = this.fileManager.ui.formatFileSize(totalLength);
        template.querySelector('.progress-bar-fill').style.width = `${progress.toFixed(2)}%`;
        template.querySelector('.progress-text').textContent = `${progress.toFixed(2)}%`;
        template.querySelector('.status').textContent = item.status;
        template.querySelector('.speed').textContent = `${this.fileManager.ui.formatFileSize(downloadSpeed)}/s`;
        template.querySelector('.actions').innerHTML = this.createActionButtons(item.status, item.gid);
        
        tr.appendChild(template);
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
        if (action === 'clear') {
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
                this.loadAria2cStatus();
            } else {
                this.fileManager.ui.showToast('Aria2c Error', result.message || `Action '${action}' failed.`, 'error');
            }
        } catch (error) {
            console.error(`Aria2c action '${action}' error:`, error);
            this.fileManager.ui.showToast('Aria2c Error', `Failed to perform action '${action}'.`, 'error');
        }
    }
}