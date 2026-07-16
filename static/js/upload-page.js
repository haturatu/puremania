// Uploads page deliberately shares aria2c's table classes: transfers have the
// same lifecycle (active, paused, complete) even though their transport differs.
export class UploadPageHandler {
    constructor(app) {
        this.app = app;
        this.active = false;
        this.interval = null;
        this.selectedKeys = new Set();
        this.polling = false;
        this.timer = null;
        this.onJobsChanged = () => this.refresh();
    }

    enter() {
        if (this.active) return;
        this.active = true;
        window.addEventListener('puremania:upload-jobs-changed', this.onJobsChanged);
        this.refresh();
        document.querySelector('.breadcrumbs')?.style.setProperty('display', 'none');
    }

    exit() {
        if (!this.active) return;
        this.active = false;
        clearTimeout(this.timer);
        window.removeEventListener('puremania:upload-jobs-changed', this.onJobsChanged);
        document.querySelector('.breadcrumbs')?.style.removeProperty('display');
    }

    async refresh() {
        if (!this.active || this.polling) return;
        this.polling = true;
        try {
            const jobs = await this.app.uploader.listJobs();
            if (this.active) this.render(jobs);
        } finally {
            this.polling = false;
            if (this.active) this.timer = setTimeout(() => this.refresh(), 3000);
        }
    }

    render(jobs) {
        this.selectedKeys = new Set([...this.selectedKeys].filter(key => jobs.some(job => job.key === key)));
        const container = document.querySelector('.file-browser');
        if (!container) return;
        container.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'aria2c-header';
        header.innerHTML = '<div class="aria2c-title">Uploads</div><div class="aria2c-controls"><button class="btn upload-back-btn">Back</button></div>';
        header.querySelector('.upload-back-btn').addEventListener('click', () => this.app.router.navigate('/'));
        container.appendChild(header);
        if (!jobs.length) {
            const empty = document.createElement('div');
            empty.className = 'no-search-results';
            empty.innerHTML = '<div class="no-search-results-title">No resumable uploads</div><div class="no-search-results-subtext">Interrupted uploads will appear here and can be resumed by selecting the original file.</div>';
            container.appendChild(empty);
            return;
        }
        const section = document.createElement('div');
        section.className = 'aria2c-section';
        section.innerHTML = `<h3>Resumable Uploads (${jobs.length})</h3><div class="upload-bulk-actions"><button class="btn btn-sm bulk-resume">Resume selected</button><button class="btn btn-sm btn-danger bulk-discard">Discard selected</button><button class="btn btn-sm btn-danger bulk-discard-all">Discard all</button></div>`;
        const table = document.createElement('table');
        table.className = 'table-view aria2c-table upload-jobs-table';
        table.innerHTML = '<thead><tr><th><input type="checkbox" class="upload-select-all" aria-label="Select all uploads"></th><th>Name</th><th>Size</th><th>Progress</th><th>Status</th><th>Destination</th><th>Actions</th></tr></thead><tbody></tbody>';
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
        row.innerHTML = `<td><input type="checkbox" class="upload-select" aria-label="Select upload"></td><td class="file-name"></td><td class="file-size"></td><td class="upload-progress-cell"><div class="ui-progress"><div class="ui-progress__fill"></div><span class="progress-text"></span></div></td><td class="status"></td><td class="upload-destination"></td><td class="actions"></td>`;
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
