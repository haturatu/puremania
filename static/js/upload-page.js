// Uploads page deliberately shares aria2c's table classes: transfers have the
// same lifecycle (active, paused, complete) even though their transport differs.
export class UploadPageHandler {
    constructor(app) {
        this.app = app;
        this.active = false;
        this.interval = null;
        this.onJobsChanged = () => this.refresh();
    }

    enter() {
        if (this.active) return;
        this.active = true;
        window.addEventListener('puremania:upload-jobs-changed', this.onJobsChanged);
        this.refresh();
        this.interval = setInterval(() => this.refresh(), 3000);
        document.querySelector('.breadcrumbs')?.style.setProperty('display', 'none');
    }

    exit() {
        if (!this.active) return;
        this.active = false;
        clearInterval(this.interval);
        window.removeEventListener('puremania:upload-jobs-changed', this.onJobsChanged);
        document.querySelector('.breadcrumbs')?.style.removeProperty('display');
    }

    async refresh() {
        if (!this.active) return;
        const jobs = await this.app.uploader.listJobs();
        if (this.active) this.render(jobs);
    }

    render(jobs) {
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
        section.innerHTML = `<h3>Resumable Uploads (${jobs.length})</h3>`;
        const table = document.createElement('table');
        table.className = 'table-view aria2c-table upload-jobs-table';
        table.innerHTML = '<thead><tr><th>Name</th><th>Size</th><th>Progress</th><th>Status</th><th>Destination</th><th>Actions</th></tr></thead><tbody></tbody>';
        const body = table.querySelector('tbody');
        jobs.forEach(job => body.appendChild(this.row(job)));
        section.appendChild(table);
        container.appendChild(section);
    }

    row(job) {
        const row = document.createElement('tr');
        const total = job.totalBytes || job.size || 0;
        const uploaded = Math.min(job.uploadedBytes || 0, total);
        const progress = total ? uploaded / total * 100 : 100;
        const name = job.relativePath.split('/').pop();
        row.innerHTML = `<td class="file-name"></td><td class="file-size"></td><td><div class="ui-progress"><div class="ui-progress__fill"></div></div><span class="progress-text"></span></td><td class="status"></td><td class="upload-destination"></td><td class="actions"></td>`;
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
}
