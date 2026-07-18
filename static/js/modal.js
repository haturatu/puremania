export function createModalOverlay({ className = '', hidden = false, content = null } = {}) {
    const modal = document.createElement('div');
    modal.className = `modal-overlay${className ? ` ${className}` : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.tabIndex = -1;
    if (hidden) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }

    if (typeof content === 'string') {
        modal.innerHTML = content;
    } else if (content instanceof Node) {
        modal.appendChild(content);
    }

    const title = modal.querySelector('.modal-title, .editor-title, h1, h2');
    if (title) {
        title.id ||= `modal-title-${createUniqueId()}`;
        modal.setAttribute('aria-labelledby', title.id);
    } else {
        modal.setAttribute('aria-label', 'Dialog');
    }

    document.body.appendChild(modal);
    return modal;
}

const focusableSelector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

export function showModalOverlay(modal, { initialFocus = null } = {}) {
    if (!modal) return;
    modal._previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    const target = initialFocus || modal.querySelector(focusableSelector) || modal;
    requestAnimationFrame(() => target.focus());
}

export function hideModalOverlay(modal) {
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    const previousFocus = modal._previousFocus;
    modal._previousFocus = null;
    if (previousFocus?.isConnected) previousFocus.focus();
}

export function bindModalClose(modal, { onClose, closeOnBackdrop = false } = {}) {
    if (!modal || typeof onClose !== 'function') {
        return () => {};
    }

    const closeButtons = Array.from(modal.querySelectorAll('.modal-close'));
    const clickHandler = (e) => {
        e.preventDefault();
        onClose(e);
    };

    const keydownHandler = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose(event);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...modal.querySelectorAll(focusableSelector)];
        if (!focusable.length) {
            event.preventDefault();
            modal.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    closeButtons.forEach(btn => btn.addEventListener('click', clickHandler));
    modal.addEventListener('keydown', keydownHandler);

    let backdropHandler = null;
    if (closeOnBackdrop) {
        backdropHandler = (e) => {
            if (e.target === modal) {
                onClose(e);
            }
        };
        modal.addEventListener('click', backdropHandler);
    }

    return () => {
        closeButtons.forEach(btn => btn.removeEventListener('click', clickHandler));
        modal.removeEventListener('keydown', keydownHandler);
        if (backdropHandler) {
            modal.removeEventListener('click', backdropHandler);
        }
    };
}

function createDialogShell({ title = '', description = '' } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';

    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'app-dialog__form';

    const header = document.createElement('div');
    header.className = 'app-dialog__header';

    const titleElement = document.createElement('h2');
    titleElement.id = `dialog-title-${createUniqueId()}`;
    titleElement.className = 'app-dialog__title';
    titleElement.textContent = title;
    header.appendChild(titleElement);
    dialog.setAttribute('aria-labelledby', titleElement.id);

    form.appendChild(header);

    if (description) {
        const descriptionElement = document.createElement('p');
        descriptionElement.id = `dialog-description-${createUniqueId()}`;
        descriptionElement.className = 'app-dialog__description';
        descriptionElement.textContent = description;
        form.appendChild(descriptionElement);
        dialog.setAttribute('aria-describedby', descriptionElement.id);
    }

    const body = document.createElement('div');
    body.className = 'app-dialog__body';
    form.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'app-dialog__actions';
    form.appendChild(actions);

    dialog.appendChild(form);
    document.body.appendChild(dialog);

    return { dialog, form, body, actions };
}

export function showConfirmDialog({
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false
} = {}) {
    return new Promise((resolve) => {
        const { dialog, actions } = createDialogShell({ title, description: message });

        const cancelButton = document.createElement('button');
        cancelButton.type = 'submit';
        cancelButton.value = 'cancel';
        cancelButton.className = 'btn';
        cancelButton.textContent = cancelLabel;

        const confirmButton = document.createElement('button');
        confirmButton.type = 'submit';
        confirmButton.value = 'confirm';
        confirmButton.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
        confirmButton.textContent = confirmLabel;

        actions.append(cancelButton, confirmButton);

        dialog.addEventListener('close', () => {
            const confirmed = dialog.returnValue === 'confirm';
            dialog.remove();
            resolve(confirmed);
        }, { once: true });

        dialog.showModal();
        (danger ? cancelButton : confirmButton).focus();
    });
}

export function showPromptDialog({
    title,
    message = '',
    defaultValue = '',
    placeholder = '',
    confirmLabel = 'Save',
    cancelLabel = 'Cancel'
} = {}) {
    return new Promise((resolve) => {
        const { dialog, body, form, actions } = createDialogShell({ title, description: message });

        const input = document.createElement('input');
        input.type = 'text';
        input.name = 'value';
        input.className = 'app-dialog__input';
        input.value = defaultValue;
        input.placeholder = placeholder;
        body.appendChild(input);

        const cancelButton = document.createElement('button');
        cancelButton.type = 'submit';
        cancelButton.value = 'cancel';
        cancelButton.className = 'btn';
        cancelButton.textContent = cancelLabel;

        const confirmButton = document.createElement('button');
        confirmButton.type = 'submit';
        confirmButton.value = 'confirm';
        confirmButton.className = 'btn btn-primary';
        confirmButton.textContent = confirmLabel;

        form.addEventListener('submit', (event) => {
            if (event.submitter?.value === 'confirm' && !input.value.trim()) {
                event.preventDefault();
                input.focus();
            }
        });

        actions.append(cancelButton, confirmButton);

        dialog.addEventListener('close', () => {
            const value = dialog.returnValue === 'confirm' ? input.value.trim() : null;
            dialog.remove();
            resolve(value);
        }, { once: true });

        dialog.showModal();
        input.focus();
        input.select();
    });
}
import { createUniqueId } from './util.js';
