export class UploadMetadataStorage {
    constructor(storageManager = globalThis.navigator?.storage) {
        this.storageManager = storageManager;
        this.preparation = null;
    }

    prepare() {
        if (!this.preparation) this.preparation = this.prepareOnce();
        return this.preparation;
    }

    async prepareOnce() {
        const storage = this.storageManager;
        if (!storage) return { supported: false, persisted: false, usage: null, quota: null };

        let persisted = false;
        try {
            persisted = typeof storage.persisted === 'function' && await storage.persisted();
            if (!persisted && typeof storage.persist === 'function') {
                persisted = await storage.persist();
            }
        } catch (error) {
            console.warn('Persistent upload metadata storage is unavailable', error);
        }

        let estimate = {};
        try {
            if (typeof storage.estimate === 'function') estimate = await storage.estimate();
        } catch (error) {
            console.warn('Could not estimate browser storage', error);
        }

        return {
            supported: true,
            persisted,
            usage: Number.isFinite(estimate.usage) ? estimate.usage : null,
            quota: Number.isFinite(estimate.quota) ? estimate.quota : null
        };
    }
}
