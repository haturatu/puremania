import { getTemplateContent } from './template.js';
import { TEMPLATES } from './template-registry.js';

export class ProgressManager {
    constructor() {
        this.progressOverlay = null;
        this.isCompleted = false;
        this.startTime = null;
        this.timerInterval = null;
        this.lastUpdateTime = 0;
        this.updateThrottle = 250; // ms
        this.isMinimized = false;
    }

    init() {
        this.createProgressOverlay();
    }

    createProgressOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'progress-overlay';
        const template = getTemplateContent(TEMPLATES.progressOverlay);
        overlay.appendChild(template);

        document.body.appendChild(overlay);
        this.progressOverlay = overlay;

        // Closing or minimizing the panel never cancels an upload. Cancellation
        // is an explicit action on the Uploads page so progress is not lost.
        overlay.querySelector('.progress-close').addEventListener('click', () => this.hide());
        overlay.querySelector('.progress-minimize').addEventListener('click', () => this.minimize());
        overlay.querySelector('.upload-restore').addEventListener('click', () => this.restore());
    }

    startTimer() {
        if (this.timerInterval !== null) {
            clearInterval(this.timerInterval);
        }
        this.startTime = Date.now();
        this.timerInterval = setInterval(() => {
            if (!this.isCompleted) {
                const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                const timeElement = this.progressOverlay.querySelector('.progress-time');
                if (timeElement) {
                    timeElement.textContent = `Elapsed: ${elapsedTime}s`;
                }
            }
        }, 1000);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        if (this.startTime) {
            const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
            const timeElement = this.progressOverlay.querySelector('.progress-time');
            if (timeElement) {
                timeElement.textContent = `Completed in: ${elapsedTime}s`;
            }
        }
    }

    showError(message) {
        if (!this.progressOverlay) return;

        this.stopTimer();
        const statusElement = this.progressOverlay.querySelector('.progress-status');
        const modal = this.progressOverlay.querySelector('.progress-modal');
        const closeBtn = this.progressOverlay.querySelector('.progress-close');

        if (statusElement) {
            statusElement.setAttribute('role', 'alert');
            statusElement.setAttribute('aria-live', 'assertive');
            statusElement.replaceChildren();
            statusElement.append(document.createTextNode(`Error: ${message}`), document.createElement('br'));
            const dismissHint = document.createElement('strong');
            dismissHint.textContent = 'Click close to dismiss';
            statusElement.appendChild(dismissHint);
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
            statusElement.setAttribute('role', 'status');
            statusElement.setAttribute('aria-live', 'polite');
            statusElement.style.color = '';
        }

        if (modal) {
            modal.style.border = '';
        }

        if (closeBtn) {
            closeBtn.style.display = 'block';
            closeBtn.style.background = '';
            closeBtn.style.color = '';
        }

        this.isCompleted = false;
    }

    updateProgress(progress) {
        if (!this.progressOverlay) return;

        const {
            currentFile = '',
            percentage = 0,
            processed = 0,
            total = 0,
            status = ''
        } = progress;

        const safePercentage = Math.max(0, Math.min(100, percentage));
        const safeProcessed = Math.max(0, Math.min(total, processed));
        const safeTotal = Math.max(0, total);

        const percentageText = Math.round(safePercentage) + '%';
        const statsText = safeTotal > 0 ?
            `${safeProcessed}/${safeTotal} files` :
            `${safeProcessed} files processed`;

        const elements = {
            current: this.progressOverlay.querySelector('.progress-current'),
            progressBar: this.progressOverlay.querySelector('.ui-progress'),
            percentage: this.progressOverlay.querySelector('.progress-percentage'),
            stats: this.progressOverlay.querySelector('.progress-stats'),
            status: this.progressOverlay.querySelector('.progress-status')
        };

        if (elements.current) elements.current.textContent = currentFile;
        if (elements.progressBar) {
            elements.progressBar.value = safePercentage;
            elements.progressBar.textContent = percentageText;
        }
        if (elements.percentage) elements.percentage.textContent = percentageText;
        if (elements.stats) elements.stats.textContent = statsText;
        if (elements.status && status) elements.status.textContent = status;

        if (safePercentage >= 100) {
            this.isCompleted = true;
            this.stopTimer();
        }
    }

    safeUpdateProgress(progress) {
        const now = Date.now();
        const isFinalUpdate = progress.percentage >= 100;

        if (!isFinalUpdate && now - this.lastUpdateTime < this.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;

        try {
            this.updateProgress(progress);
        } catch (error) {
            console.error('Error updating progress:', error);
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

            this.progressOverlay.style.display = 'flex';
            this.progressOverlay.classList.toggle('minimized', this.isMinimized);
            this.resetError();
            this.resetProgress();
            this.startTimer();
        }
    }

    hide() {
        if (this.progressOverlay) {
            this.progressOverlay.style.display = 'none';
        }
        this.isCompleted = false;
        this.isMinimized = false;
        this.stopTimer();
        this.startTime = null;
    }

    minimize() {
        if (!this.progressOverlay) return;
        this.isMinimized = true;
        this.progressOverlay.style.display = 'flex';
        this.progressOverlay.classList.add('minimized');
    }

    restore() {
        if (!this.progressOverlay) return;
        this.isMinimized = false;
        this.progressOverlay.style.display = 'flex';
        this.progressOverlay.classList.remove('minimized');
    }

    resetProgress() {
        this.isCompleted = false;
        this.safeUpdateProgress({
            currentFile: 'Preparing files...',
            percentage: 0,
            processed: 0,
            total: 0,
            status: 'Initializing...'
        });
        const timeElement = this.progressOverlay.querySelector('.progress-time');
        if (timeElement) {
            timeElement.textContent = 'Elapsed: 0s';
        }
    }

}
