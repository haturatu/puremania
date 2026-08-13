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

    run(update, { animate = true } = {}) {
        if (!animate || this.prefersReducedMotion() || typeof this.document?.startViewTransition !== 'function') {
            return Promise.resolve().then(update);
        }

        this.activeTransition?.skipTransition?.();
        const transition = this.document.startViewTransition(() => Promise.resolve().then(update));
        this.activeTransition = transition;
        const updated = transition.updateCallbackDone || transition.finished || Promise.resolve();
        return Promise.resolve(updated).finally(() => {
            if (this.activeTransition === transition) this.activeTransition = null;
        });
    }
}
