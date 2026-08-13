export class RealtimeEvents {
    constructor(app, EventSourceClass = globalThis.EventSource) {
        this.app = app;
        this.EventSourceClass = EventSourceClass;
        this.source = null;
        this.latestEvents = new Map();
        this.aria2Enabled = false;
    }

    start() {
        if (this.source || typeof this.EventSourceClass !== 'function') return false;
        const url = this.aria2Enabled ? '/api/events?aria2=1' : '/api/events';
        this.source = new this.EventSourceClass(url);
        for (const type of ['aria2', 'upload']) {
            this.source.addEventListener(type, event => this.handle(type, event));
        }
        return true;
    }

    handle(type, event) {
        try {
            const detail = JSON.parse(event.data);
            this.latestEvents.set(type, detail);
            this.app.emit(`server:${type}`, detail);
        } catch (error) {
            console.warn(`Ignored malformed ${type} server event`, error);
        }
    }

    latest(type) {
        return this.latestEvents.get(type) ?? null;
    }

    setAria2Enabled(enabled) {
        if (this.aria2Enabled === enabled) return Boolean(this.source);
        this.aria2Enabled = enabled;
        this.latestEvents.delete('aria2');
        if (!this.source) return this.start();
        this.close();
        return this.start();
    }

    close() {
        this.source?.close();
        this.source = null;
    }
}
