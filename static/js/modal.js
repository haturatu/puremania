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
