import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ViewTransitionController } from './view-transition.js';

test('runs route rendering inside a native view transition', async () => {
    const calls = [];
    const documentObject = {
        startViewTransition: callback => {
            calls.push('transition');
            const updateCallbackDone = callback();
            return { updateCallbackDone };
        }
    };
    const controller = new ViewTransitionController(documentObject, () => ({ matches: false }));

    await controller.run(async () => { calls.push('render'); });

    assert.deepEqual(calls, ['transition', 'render']);
});

test('renders without animation when reduced motion is preferred', async () => {
    let transitioned = false;
    let rendered = false;
    const controller = new ViewTransitionController({
        startViewTransition: () => { transitioned = true; }
    }, () => ({ matches: true }));

    await controller.run(() => { rendered = true; });

    assert.equal(rendered, true);
    assert.equal(transitioned, false);
});

test('skips an active transition when navigation changes again', async () => {
    let rejectFirstReady;
    let rejectFirstUpdate;
    let rejectFirstFinished;
    let skipped = false;
    let count = 0;
    const documentObject = {
        startViewTransition: callback => {
            void callback();
            count += 1;
            if (count === 1) {
                return {
                    skipTransition: () => {
                        skipped = true;
                        const error = new Error('Transition was skipped');
                        rejectFirstReady(error);
                        rejectFirstUpdate(error);
                        rejectFirstFinished(error);
                    },
                    ready: new Promise((_, reject) => { rejectFirstReady = reject; }),
                    updateCallbackDone: new Promise((_, reject) => { rejectFirstUpdate = reject; }),
                    finished: new Promise((_, reject) => { rejectFirstFinished = reject; })
                };
            }
            return { updateCallbackDone: Promise.resolve() };
        }
    };
    const controller = new ViewTransitionController(documentObject, () => ({ matches: false }));

    const first = controller.run(() => {});
    await controller.run(() => {});
    await first;

    assert.equal(skipped, true);
});

test('keeps the transition active until its animation finishes', async () => {
    let finishAnimation;
    const transition = {
        updateCallbackDone: Promise.resolve(),
        finished: new Promise(resolve => { finishAnimation = resolve; })
    };
    const controller = new ViewTransitionController({
        startViewTransition: callback => { void callback(); return transition; }
    }, () => ({ matches: false }));

    const rendering = controller.run(() => {});
    await transition.updateCallbackDone;
    assert.equal(controller.activeTransition, transition);
    finishAnimation();
    await rendering;
    assert.equal(controller.activeTransition, null);
});

test('uses a short transition and declares a reduced-motion override', async () => {
    const css = await readFile(new URL('../css/base/base.css', import.meta.url), 'utf8');
    assert.match(css, /::view-transition-old\(root\)[\s\S]*animation-duration:\s*100ms/);
    assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*::view-transition-old\(root\)/);
});
