export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function createRequestSignal(manualSignal, {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    AbortSignalClass = globalThis.AbortSignal,
    AbortControllerClass = globalThis.AbortController
} = {}) {
    const cleanupCallbacks = [];
    let timeoutSignal = null;

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        if (typeof AbortSignalClass?.timeout === 'function') {
            timeoutSignal = AbortSignalClass.timeout(timeoutMs);
        } else {
            const timeoutController = new AbortControllerClass();
            const timer = setTimeout(() => {
                timeoutController.abort(new DOMException('The request timed out.', 'TimeoutError'));
            }, timeoutMs);
            cleanupCallbacks.push(() => clearTimeout(timer));
            timeoutSignal = timeoutController.signal;
        }
    }

    const signals = [manualSignal, timeoutSignal].filter(Boolean);
    let signal = signals[0] ?? null;
    if (signals.length > 1) {
        if (typeof AbortSignalClass?.any === 'function') {
            signal = AbortSignalClass.any(signals);
        } else {
            const combinedController = new AbortControllerClass();
            const abort = source => {
                if (!combinedController.signal.aborted) combinedController.abort(source.reason);
            };
            for (const source of signals) {
                if (source.aborted) {
                    abort(source);
                    break;
                }
                const listener = () => abort(source);
                source.addEventListener('abort', listener, { once: true });
                cleanupCallbacks.push(() => source.removeEventListener('abort', listener));
            }
            signal = combinedController.signal;
        }
    }

    return {
        signal,
        cleanup: () => cleanupCallbacks.splice(0).forEach(cleanup => cleanup())
    };
}
