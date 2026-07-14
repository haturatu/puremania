// A bounded, priority-aware image scheduler. It intentionally keeps only URL
// metadata in the queue; decoded image pixels remain under the browser cache's
// normal memory management rather than being retained by application code.
export class ImageLoader {
    constructor({ concurrency = navigator.connection?.saveData ? 1 : (matchMedia('(max-width: 768px)').matches ? 4 : 12), maxQueue = matchMedia('(max-width: 768px)').matches ? 120 : 240 } = {}) {
        this.concurrency = concurrency;
        this.maxQueue = maxQueue;
        this.pending = new Map();
        this.active = 0;
        this.generation = 0;
    }

    enqueue({ key, src, priority = 0, onLoad, onError, onCancel }) {
        if (!key || !src) return false;
        const existing = this.pending.get(key);
        if (existing) {
            if (!existing.started) existing.priority = priority;
            return true;
        }
        if (this.pending.size >= this.maxQueue) {
            const farthest = [...this.pending.values()].filter(job => !job.started).sort((a, b) => b.priority - a.priority)[0];
            if (!farthest || farthest.priority <= priority) return false;
            this.pending.delete(farthest.key);
            farthest.onCancel?.();
        }
        this.pending.set(key, { key, src, priority, onLoad, onError, onCancel, started: false, generation: this.generation });
        this.pump();
        return true;
    }

    cancel(key) {
        const job = this.pending.get(key);
        if (!job) return false;
        job.cancelled = true;
        this.pending.delete(key);
        job.onCancel?.();
        return true;
    }

    clear() {
        this.generation++;
        // Active Image requests cannot be reliably aborted cross-browser, but
        // removing their jobs allows the new view to queue the same URL and the
        // generation check prevents stale DOM updates when they finish.
        this.pending.clear();
    }

    pump() {
        while (this.active < this.concurrency) {
            const job = [...this.pending.values()].filter(item => !item.started).sort((a, b) => a.priority - b.priority)[0];
            if (!job) return;
            job.started = true;
            this.active++;
            const image = new Image();
            image.decoding = 'async';
            image.onload = async () => {
                try { if (image.decode) await image.decode(); } catch (_) { /* decoded enough to display */ }
                this.finish(job, () => job.onLoad?.(image));
            };
            image.onerror = () => this.finish(job, () => job.onError?.());
            image.src = job.src;
        }
    }

    finish(job, callback) {
        this.active--;
        if (this.pending.get(job.key) === job) this.pending.delete(job.key);
        if (!job.cancelled && job.generation === this.generation) callback();
        this.pump();
    }
}
