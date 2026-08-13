const LOCK_NAME = 'puremania-upload';

export class OriginUploadLock {
    constructor(lockManager = globalThis.navigator?.locks) {
        this.lockManager = lockManager;
    }

    async run(task) {
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
