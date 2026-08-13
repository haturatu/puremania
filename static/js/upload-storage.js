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
        if (!storage) return { supported: false, persisted: false };

        let persisted = false;
        try {
            persisted = typeof storage.persisted === 'function' && await storage.persisted();
            if (!persisted && typeof storage.persist === 'function') {
                persisted = await storage.persist();
            }
        } catch (error) {
            console.warn('Persistent upload metadata storage is unavailable', error);
        }

        return { supported: true, persisted };
    }
}
