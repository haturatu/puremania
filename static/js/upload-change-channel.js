const CHANNEL_NAME = 'puremania';
const MESSAGE_TYPE = 'upload-changed';

// Cross-tab messages are invalidation hints, never transfer state. IndexedDB
// caches resume metadata and the server upload-session endpoint remains the
// authoritative source for received bytes. This matches the SSE contract when
// both PRs are integrated: either hint causes UploadPage to reload state.
export class UploadChangeChannel {
    constructor(onChange, BroadcastChannelClass = globalThis.BroadcastChannel) {
        this.onChange = onChange;
        this.channel = typeof BroadcastChannelClass === 'function'
            ? new BroadcastChannelClass(CHANNEL_NAME)
            : null;
        this.channel?.addEventListener('message', event => {
            if (event.data?.type !== MESSAGE_TYPE) return;
            this.onChange({ uploadId: event.data.uploadId ?? null, remote: true });
        });
    }

    notify(uploadId = null) {
        const detail = { uploadId, remote: false };
        this.onChange(detail);
        this.channel?.postMessage({ type: MESSAGE_TYPE, uploadId });
    }

    close() {
        this.channel?.close();
        this.channel = null;
    }
}
