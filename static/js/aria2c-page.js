import { getTemplateContent } from './template.js';

export class Aria2cPageHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.pollEnabled = false;
        this.updateInterval = null;
        this.lastStatus = null;
        this.previousPath = '/'; // Store the path before entering this page
        this.torrentsToCancel = new Set(); // Track torrents scheduled for cancellation
        this.polling = false;
        this.pollTimer = null;
    }

    get isInAria2cMode() {
        return this.fileManager.store.getState().route.page === 'aria2c';
    }

    init() {
        // No initial event binding needed, will be triggered by router
    }

    enterAria2cMode() {
        if (this.pollEnabled) return;

        const currentPath = this.fileManager.router.getCurrentPath();
        if (currentPath !== '/system/aria2c') {
            this.previousPath = currentPath;
        }

        this.pollEnabled = true;
        this.fileManager.ui.showLoading();
        this.loadAria2cStatus();
        
        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = 'none';
    }

    exitAria2cMode(navigate = true) {
        if (!this.pollEnabled) return;
        this.pollEnabled = false;
        clearTimeout(this.pollTimer);
        this.updateInterval = null;
        this.lastStatus = null;

        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = '';

        if (navigate) this.fileManager.router.navigate(this.previousPath);
    }

    async loadAria2cStatus() {
        if (!this.pollEnabled || !this.isInAria2cMode || this.polling) return;
        this.polling = true;
        try {
            const status = await this.fileManager.api.getAria2cStatus();
            if (status) {
                this.lastStatus = status;
                if (this.isInAria2cMode && this.fileManager.router.getCurrentPath() === '/system/aria2c') this.render(status);
            } else {
                // API method failed and should have shown a toast.
                // Stop polling.
                this.pollEnabled = false;
            }
        } finally {
            this.polling = false;
            this.fileManager.ui.hideLoading();
            if (this.pollEnabled && this.isInAria2cMode) this.pollTimer = setTimeout(() => this.loadAria2cStatus(), 2000);
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
        template.querySelector('.ui-progress__fill').style.width = `${progress.toFixed(2)}%`;
        template.querySelector('.progress-text').textContent = `${progress.toFixed(2)}%`;
        template.querySelector('.status').textContent = item.status;
        template.querySelector('.speed').textContent = `${this.fileManager.ui.formatFileSize(downloadSpeed)}/s`;
        template.querySelector('.actions').replaceChildren(...this.createActionButtons(item.status, item.gid));
        
        tr.appendChild(template);
        return tr;
    }
    
    getFileName(path) {
        return path.split('/').pop();
    }

    createActionButtons(status, gid) {
        const buttons = [];
        const addButton = (label, action, className) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `btn btn-sm ${className}`;
            button.dataset.action = action;
            button.dataset.gid = gid;
            button.textContent = label;
            buttons.push(button);
        };
        switch (status) {
            case 'active':
                addButton('Pause', 'pause', 'btn-warning');
                addButton('Cancel', 'cancel', 'btn-danger');
                break;
            case 'paused':
                addButton('Resume', 'resume', 'btn-success');
                addButton('Cancel', 'cancel', 'btn-danger');
                break;
            case 'complete':
                addButton('Clear', 'clear', 'btn-info');
                break;
            case 'error':
            case 'removed':
                addButton('Clear', 'clear', 'btn-info');
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

        const success = await this.fileManager.api.controlAria2cDownload(gid, apiAction);
        
        if (success) {
            this.loadAria2cStatus();
        }
    }
}
