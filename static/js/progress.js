export class ProgressManager {
    constructor() {
        this.progressOverlay = null;
        this.currentUpload = null;
        this.isCompleted = false;
        this.init();
    }

    init() {
        this.createProgressOverlay();
    }

    createProgressOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'progress-overlay';
        overlay.innerHTML = `
            <div class="progress-modal">
                <div class="progress-header">
                    <div class="progress-title">Uploading Files</div>
                    <button class="progress-close" style="display: none;">Cancel</button>
                </div>
                <div class="progress-info">
                    <span class="progress-current">Preparing files...</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill"></div>
                </div>
                <div class="progress-details">
                    <span class="progress-percentage">0%</span>
                    <span class="progress-stats">0 files processed</span>
                </div>
                <div class="progress-status">Initializing...</div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.progressOverlay = overlay;

        // Only allow closing when explicitly shown
        overlay.querySelector('.progress-close').addEventListener('click', () => {
            if (this.isCompleted || confirm('Cancel upload? This will stop the current upload process.')) {
                this.hide();
                if (this.currentUpload && !this.isCompleted) {
                    this.currentUpload.abort();
                }
            }
        });
    }

    showError(message) {
        if (!this.progressOverlay) return;

        const statusElement = this.progressOverlay.querySelector('.progress-status');
        const modal = this.progressOverlay.querySelector('.progress-modal');
        const closeBtn = this.progressOverlay.querySelector('.progress-close');

        if (statusElement) {
            statusElement.innerHTML = `Error: ${message}<br><strong>Click close to dismiss</strong>`;
            statusElement.style.color = 'var(--error, #f44336)';
        }

        if (modal) {
            modal.style.border = '2px solid var(--error, #f44336)';
        }

        if (closeBtn) {
            closeBtn.style.display = 'block';
            closeBtn.style.background = 'var(--error, #f44336)';
            closeBtn.style.color = 'white';
        }

        this.isCompleted = true;
    }

    resetError() {
        if (!this.progressOverlay) return;

        const statusElement = this.progressOverlay.querySelector('.progress-status');
        const modal = this.progressOverlay.querySelector('.progress-modal');
        const closeBtn = this.progressOverlay.querySelector('.progress-close');

        if (statusElement) {
            statusElement.style.color = '';
        }

        if (modal) {
            modal.style.border = '';
        }

        if (closeBtn) {
            closeBtn.style.background = '';
            closeBtn.style.color = '';
        }

        this.isCompleted = false;
    }

    // Core update method - handles the actual DOM updates
    updateProgress(progress) {
        if (!this.progressOverlay) return;

        const {
            currentFile = '',
            percentage = 0,
            processed = 0,
            total = 0,
            status = ''
        } = progress;

        // Validate and sanitize values
        const safePercentage = Math.max(0, Math.min(100, percentage));
        const safeProcessed = Math.max(0, Math.min(total, processed));
        const safeTotal = Math.max(0, total);

        const percentageText = Math.round(safePercentage) + '%';
        const statsText = safeTotal > 0 ?
            `${safeProcessed}/${safeTotal} files` :
            `${safeProcessed} files processed`;

        // Update DOM elements
        const elements = {
            current: this.progressOverlay.querySelector('.progress-current'),
            barFill: this.progressOverlay.querySelector('.progress-bar-fill'),
            percentage: this.progressOverlay.querySelector('.progress-percentage'),
            stats: this.progressOverlay.querySelector('.progress-stats'),
            status: this.progressOverlay.querySelector('.progress-status')
        };

        if (elements.current) elements.current.textContent = currentFile;
        if (elements.barFill) elements.barFill.style.width = percentageText;
        if (elements.percentage) elements.percentage.textContent = percentageText;
        if (elements.stats) elements.stats.textContent = statsText;
        if (elements.status && status) elements.status.textContent = status;

        // Mark as completed when at 100%
        if (safePercentage >= 100) {
            this.isCompleted = true;
        }
    }

    // Safe wrapper method - handles errors gracefully
    safeUpdateProgress(progress) {
        try {
            this.updateProgress(progress);
        } catch (error) {
            console.error('Error updating progress:', error);
            // Fallback: try to at least update the status
            try {
                const statusElement = this.progressOverlay?.querySelector('.progress-status');
                if (statusElement) {
                    statusElement.textContent = 'Updating progress...';
                }
            } catch (fallbackError) {
                console.error('Fallback progress update also failed:', fallbackError);
            }
        }
    }

    show(title = 'Uploading Files') {
        if (this.progressOverlay) {
            const titleElement = this.progressOverlay.querySelector('.progress-title');
            if (titleElement) titleElement.textContent = title;

            const closeBtn = this.progressOverlay.querySelector('.progress-close');
            if (closeBtn) {
                closeBtn.style.display = 'block';
            }

            this.progressOverlay.style.display = 'flex';
            this.resetError();
            this.resetProgress();
        }
    }

    hide() {
        if (this.progressOverlay) {
            const closeBtn = this.progressOverlay.querySelector('.progress-close');
            if (closeBtn) {
                closeBtn.style.display = 'none';
            }
            this.progressOverlay.style.display = 'none';
        }
        this.currentUpload = null;
        this.isCompleted = false;
    }

    resetProgress() {
        this.safeUpdateProgress({
            currentFile: 'Preparing files...',
            percentage: 0,
            processed: 0,
            total: 0,
            status: 'Initializing...'
        });
    }

    setCurrentUpload(upload) {
        this.currentUpload = upload;
        this.isCompleted = false;
    }
}
