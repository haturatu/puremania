export class ViewTransitionController {
    constructor(
        documentObject = globalThis.document,
        matchMedia = globalThis.matchMedia?.bind(globalThis)
    ) {
        this.document = documentObject;
        this.matchMedia = matchMedia;
        this.activeTransition = null;
    }

    prefersReducedMotion() {
        return this.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    isSkippedTransition(error) {
        return error?.name === 'AbortError' || error?.message?.includes?.('Transition was skipped');
    }

    observeTransitionPromises(transition) {
        for (const property of ['ready', 'updateCallbackDone', 'finished']) {
            const promise = transition?.[property];
            if (typeof promise?.catch === 'function') void promise.catch(() => {});
        }
    }

    run(update, { animate = true } = {}) {
        if (!animate || this.prefersReducedMotion() || typeof this.document?.startViewTransition !== 'function') {
            return Promise.resolve().then(update);
        }

        const activeTransition = this.activeTransition;
        if (activeTransition) {
            // Native ViewTransition.finished rejects when skipTransition() is
            // called. The ready and updateCallbackDone promises can reject as
            // part of the same cancellation, so observe all three before
            // skipping to keep Chromium from reporting an unhandled error.
            this.observeTransitionPromises(activeTransition);
            activeTransition.skipTransition?.();
        }
        const transition = this.document.startViewTransition(() => Promise.resolve().then(update));
        this.activeTransition = transition;
        this.observeTransitionPromises(transition);
        const finished = transition.finished || transition.updateCallbackDone || Promise.resolve();
        const completion = Promise.resolve(finished).catch(error => {
            if (this.isSkippedTransition(error)) return;
            throw error;
        });
        return completion.finally(() => {
            if (this.activeTransition === transition) this.activeTransition = null;
        });
    }
}
