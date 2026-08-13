const CHANNEL_NAME = 'puremania';
const MESSAGE_TYPE = 'upload-changed';

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
