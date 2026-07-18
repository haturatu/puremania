import { PollingPageController } from './polling-page-controller.js';
import { getTemplateContent } from './template.js';

const template = name => getTemplateContent(`/static/templates/components/upload_page_${name}.html`);

// Uploads page deliberately shares aria2c's table classes: transfers have the
// same lifecycle (active, paused, complete) even though their transport differs.
export class UploadPageHandler {
    constructor(app) {
        this.app = app;
        this.selectedKeys = new Set();
        this.poller = new PollingPageController({
            interval: 3000,
            isCurrentPage: () => this.isActive,
            fetchData: signal => this.app.uploader.listJobs(signal),
            render: jobs => this.render(jobs),
            onError: error => console.error('Failed to refresh uploads', error)
        });
        this.onJobsChanged = () => this.refresh();
    }

    get isActive() {
        return this.app.store.getState().route.page === 'uploads';
    }

    enter() {
        if (!this.poller.start()) return;
        window.addEventListener('puremania:upload-jobs-changed', this.onJobsChanged);
        document.querySelector('.breadcrumbs')?.style.setProperty('display', 'none');
    }

    exit() {
        if (!this.poller.stop()) return;
        window.removeEventListener('puremania:upload-jobs-changed', this.onJobsChanged);
        document.querySelector('.breadcrumbs')?.style.removeProperty('display');
    }

    async refresh() {
        await this.poller.refresh();
    }

    render(jobs) {
        this.selectedKeys = new Set([...this.selectedKeys].filter(key => jobs.some(job => job.key === key)));
        const container = document.querySelector('.file-browser');
        if (!container) return;
        container.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'aria2c-header';
        header.appendChild(template('header'));
        header.querySelector('.upload-back-btn').addEventListener('click', () => this.app.router.navigate('/'));
        container.appendChild(header);
        if (!jobs.length) {
            const empty = document.createElement('div');
            empty.className = 'no-search-results';
            empty.appendChild(template('empty'));
            container.appendChild(empty);
            return;
        }
        const section = document.createElement('div');
        section.className = 'aria2c-section';
        section.appendChild(template('section'));
        section.querySelector('.upload-page-count').textContent = `Resumable Uploads (${jobs.length})`;
        const table = document.createElement('table');
        table.className = 'table-view aria2c-table upload-jobs-table';
        table.appendChild(template('table'));
        const body = table.querySelector('tbody');
        jobs.forEach(job => body.appendChild(this.row(job)));
        const selected = () => jobs.filter(job => this.selectedKeys.has(job.key));
        const selectAll = table.querySelector('.upload-select-all');
        selectAll.checked = jobs.length > 0 && jobs.every(job => this.selectedKeys.has(job.key));
        selectAll.addEventListener('change', () => {
            jobs.forEach(job => selectAll.checked ? this.selectedKeys.add(job.key) : this.selectedKeys.delete(job.key));
            this.render(jobs);
        });
        section.querySelector('.bulk-resume').addEventListener('click', () => {
            const resumable = selected().filter(job => job.state === 'paused' || job.state === 'offline');
            if (!resumable.length) return this.app.ui.showToast('Resume upload', 'Select paused uploads first.', 'info');
            this.app.uploader.requestResumeMany(resumable.map(job => job.key)).catch(error => this.app.ui.showToast('Resume upload', error.message, 'error'));
        });
        section.querySelector('.bulk-discard').addEventListener('click', () => this.discardMany(selected()));
        section.querySelector('.bulk-discard-all').addEventListener('click', () => this.discardMany(jobs));
        section.appendChild(table);
        container.appendChild(section);
    }

    row(job) {
        const row = document.createElement('tr');
        const total = job.totalBytes || job.size || 0;
        const uploaded = Math.min(job.uploadedBytes || 0, total);
        const progress = total ? uploaded / total * 100 : 100;
        const name = job.relativePath.split('/').pop();
        row.appendChild(template('row'));
        const checkbox = row.querySelector('.upload-select');
        checkbox.checked = this.selectedKeys.has(job.key);
        checkbox.addEventListener('change', () => { checkbox.checked ? this.selectedKeys.add(job.key) : this.selectedKeys.delete(job.key); });
        row.querySelector('.file-name').textContent = name;
        row.querySelector('.file-name').title = job.relativePath;
        row.querySelector('.file-size').textContent = this.app.ui.formatFileSize(total);
        row.querySelector('.ui-progress__fill').style.width = `${progress.toFixed(2)}%`;
        row.querySelector('.progress-text').textContent = `${progress.toFixed(2)}%`;
        row.querySelector('.status').textContent = job.state;
        row.querySelector('.upload-destination').textContent = job.destination;
        const actions = row.querySelector('.actions');
        if (job.state === 'active') {
            const show = document.createElement('button');
            show.className = 'btn btn-sm btn-info'; show.textContent = 'Show progress';
            show.addEventListener('click', () => this.app.progressManager.restore());
            actions.appendChild(show);
        } else if (job.state === 'paused' || job.state === 'offline') {
            const resume = document.createElement('button');
            resume.className = 'btn btn-sm btn-success'; resume.textContent = 'Select file to resume';
            resume.addEventListener('click', () => this.app.uploader.requestResume(job.key).catch(error => this.app.ui.showToast('Resume upload', error.message, 'error')));
            actions.appendChild(resume);
        }
        const discard = document.createElement('button');
        discard.className = 'btn btn-sm btn-danger'; discard.textContent = 'Discard';
        discard.addEventListener('click', () => this.app.uploader.discardJob(job.key).then(() => this.refresh()));
        actions.appendChild(discard);
        return row;
    }

    async discardMany(jobs) {
        if (!jobs.length) return this.app.ui.showToast('Discard upload', 'Select uploads first.', 'info');
        for (const job of jobs) await this.app.uploader.discardJob(job.key);
        this.selectedKeys.clear();
        await this.refresh();
    }
}
