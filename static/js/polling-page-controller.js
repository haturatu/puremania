export class PollingPageController {
    constructor({ interval, isCurrentPage, fetchData, render, onError = console.error, onSettled = () => {} }) {
        this.interval = interval;
        this.isCurrentPage = isCurrentPage;
        this.fetchData = fetchData;
        this.render = render;
        this.onError = onError;
        this.onSettled = onSettled;
        this.active = false;
        this.polling = false;
        this.timer = null;
        this.controller = null;
    }

    start() {
        if (this.active) return false;
        this.active = true;
        void this.refresh();
        return true;
    }

    stop() {
        if (!this.active) return false;
        this.active = false;
        clearTimeout(this.timer);
        this.timer = null;
        this.controller?.abort();
        this.controller = null;
        return true;
    }

    async refresh() {
        if (!this.active || !this.isCurrentPage() || this.polling) return;
        this.polling = true;
        const controller = new AbortController();
        this.controller = controller;
        try {
            const data = await this.fetchData(controller.signal);
            if (data == null) {
                this.stop();
                return;
            }
            if (this.active && this.isCurrentPage() && !controller.signal.aborted) this.render(data);
        } catch (error) {
            if (error.name !== 'AbortError') this.onError(error);
        } finally {
            if (this.controller === controller) this.controller = null;
            this.polling = false;
            this.onSettled();
            if (this.active && this.isCurrentPage()) {
                this.timer = setTimeout(() => this.refresh(), this.interval);
            }
        }
    }
}
