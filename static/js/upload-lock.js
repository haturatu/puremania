const LOCK_NAME = 'puremania-upload';

export class OriginUploadLock {
    constructor(lockManager = globalThis.navigator?.locks) {
        this.lockManager = lockManager;
    }

    async run(task) {
        // Best-effort browser coordination only. Unsupported/insecure contexts
        // fall back to the uploader unchanged; the Go semaphore remains the
        // authoritative server-side concurrency limit in every browser.
        if (typeof this.lockManager?.request !== 'function') {
            return { acquired: true, result: await task() };
        }

        let acquired = false;
        const result = await this.lockManager.request(
            LOCK_NAME,
            { mode: 'exclusive', ifAvailable: true },
            async lock => {
                if (!lock) return undefined;
                acquired = true;
                return task();
            }
        );
        return { acquired, result };
    }
}
