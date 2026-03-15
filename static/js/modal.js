export function createModalOverlay({ className = '', hidden = false, content = null } = {}) {
    const modal = document.createElement('div');
    modal.className = `modal-overlay${className ? ` ${className}` : ''}`;
    if (hidden) {
        modal.style.display = 'none';
    }

    if (typeof content === 'string') {
        modal.innerHTML = content;
    } else if (content instanceof Node) {
        modal.appendChild(content);
    }

    document.body.appendChild(modal);
    return modal;
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

    closeButtons.forEach(btn => btn.addEventListener('click', clickHandler));

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
    titleElement.className = 'app-dialog__title';
    titleElement.textContent = title;
    header.appendChild(titleElement);

    form.appendChild(header);

    if (description) {
        const descriptionElement = document.createElement('p');
        descriptionElement.className = 'app-dialog__description';
        descriptionElement.textContent = description;
        form.appendChild(descriptionElement);
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
        confirmButton.focus();
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
