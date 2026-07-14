// A bounded, priority-aware image scheduler. It intentionally keeps only URL
// metadata in the queue; decoded image pixels remain under the browser cache's
// normal memory management rather than being retained by application code.
export class ImageLoader {
    constructor({ concurrency = navigator.connection?.saveData ? 1 : (matchMedia('(max-width: 768px)').matches ? 2 : 8), maxQueue = 80 } = {}) {
        this.concurrency = concurrency;
        this.maxQueue = maxQueue;
        this.pending = new Map();
        this.active = 0;
        this.generation = 0;
    }

    enqueue({ key, src, priority = 0, onLoad, onError }) {
        if (!key || !src || this.pending.has(key)) return false;
        if (this.pending.size >= this.maxQueue) {
            const farthest = [...this.pending.values()].filter(job => !job.started).sort((a, b) => b.priority - a.priority)[0];
            if (!farthest || farthest.priority <= priority) return false;
            this.pending.delete(farthest.key);
        }
        this.pending.set(key, { key, src, priority, onLoad, onError, started: false, generation: this.generation });
        this.pump();
        return true;
    }

    cancel(key) {
        const job = this.pending.get(key);
        if (job && !job.started) this.pending.delete(key);
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
        if (job.generation === this.generation) callback();
        this.pump();
    }
}
