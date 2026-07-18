import { getTemplateContent } from './template.js';
import { PollingPageController } from './polling-page-controller.js';
import { TEMPLATES } from './template-registry.js';

export class Aria2cPageHandler {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.previousPath = '/'; // Store the path before entering this page
        this.torrentsToCancel = new Set(); // Track torrents scheduled for cancellation
        this.initialLoadPending = false;
        this.poller = new PollingPageController({
            interval: 2000,
            isCurrentPage: () => this.isInAria2cMode,
            fetchData: signal => this.fileManager.api.getAria2cStatus(signal),
            render: status => this.render(status),
            onSettled: () => {
                if (!this.initialLoadPending) return;
                this.initialLoadPending = false;
                this.fileManager.ui.hideLoading();
            }
        });
    }

    get isInAria2cMode() {
        return this.fileManager.store.getState().route.page === 'aria2c';
    }

    init() {
        // No initial event binding needed, will be triggered by router
    }

    enterAria2cMode() {
        if (this.poller.active) return;

        const currentPath = this.fileManager.router.getCurrentPath();
        if (currentPath !== '/system/aria2c') {
            this.previousPath = currentPath;
        }

        this.initialLoadPending = true;
        this.fileManager.ui.showLoading();
        this.poller.start();
        
        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = 'none';
    }

    exitAria2cMode(navigate = true) {
        if (!this.poller.stop()) return;

        const breadcrumbs = document.querySelector('.breadcrumbs');
        if (breadcrumbs) breadcrumbs.style.display = '';

        if (navigate) this.fileManager.router.navigate(this.previousPath);
    }

    async loadAria2cStatus() {
        await this.poller.refresh();
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
        const template = getTemplateContent(TEMPLATES.aria2Header);
        header.appendChild(template);
        header.querySelector('.aria2c-back-btn').addEventListener('click', () => this.exitAria2cMode());
        return header;
    }

    createNoDownloadsMessage() {
        const noResults = document.createElement('div');
        noResults.className = 'no-search-results';
        const template = getTemplateContent(TEMPLATES.aria2Empty);
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
        const template = getTemplateContent(TEMPLATES.aria2Table);
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

        const template = getTemplateContent(TEMPLATES.aria2Row);
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
