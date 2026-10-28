'use strict';

// Shared, text-only feedback. No API or authentication responsibilities.
globalThis.ExpenseUI = (() => {
    const pending = new WeakSet();
    const errors = new WeakMap();
    let activeConfirmation = false;
    let toastRegion;

    function notify(message, kind = 'info') {
        if (!toastRegion) {
            toastRegion = document.createElement('div');
            toastRegion.className = 'toast-region';
            toastRegion.setAttribute('aria-label', 'Notifications');
            document.body.appendChild(toastRegion);
        }
        const toast = document.createElement('div');
        toast.className = `app-toast toast-${kind}`;
        toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        const text = document.createElement('span');
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'toast-dismiss';
        dismiss.textContent = 'Dismiss';
        dismiss.setAttribute('aria-label', 'Dismiss notification');
        dismiss.addEventListener('click', () => toast.remove());
        toast.append(text, dismiss);
        toastRegion.appendChild(toast);
        text.textContent = message;
        // Errors remain available until dismissed; ordinary feedback expires.
        if (kind !== 'error') setTimeout(() => toast.remove(), 6000);
    }

    function formError(form, message = '') {
        let error = errors.get(form);
        if (!error) {
            error = document.createElement('p');
            error.id = `${form.id}-feedback`;
            error.className = 'form-feedback';
            error.setAttribute('role', 'alert');
            form.appendChild(error);
            form.setAttribute('aria-describedby', error.id);
            errors.set(form, error);
        }
        error.textContent = message;
        error.hidden = !message;
    }

    function busy(button, label) {
        if (!button || pending.has(button)) return null;
        pending.add(button);
        const previous = { text: button.textContent, disabled: button.disabled };
        button.disabled = true;
        button.textContent = label;
        button.setAttribute('aria-busy', 'true');
        return () => {
            pending.delete(button);
            button.disabled = previous.disabled;
            button.textContent = previous.text;
            button.removeAttribute('aria-busy');
        };
    }

    async function confirmAction({ title: titleText, message, confirmLabel = 'Confirm', pendingLabel = 'Working...' }, onDelete) {
        if (activeConfirmation) return false;
        activeConfirmation = true;
        const returnFocus = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.className = 'app-confirm';
        dialog.setAttribute('aria-labelledby', 'delete-group-title');
        dialog.setAttribute('aria-describedby', 'delete-group-description');
        const title = document.createElement('h2');
        title.id = 'delete-group-title';
        title.textContent = titleText;
        const description = document.createElement('p');
        description.id = 'delete-group-description';
        description.textContent = message;
        const error = document.createElement('p');
        error.className = 'form-feedback';
        error.setAttribute('role', 'alert');
        const actions = document.createElement('div');
        actions.className = 'confirm-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.className = 'confirm-cancel';
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = confirmLabel; remove.className = 'confirm-delete';
        actions.append(cancel, remove);
        dialog.append(title, description, error, actions);
        document.body.appendChild(dialog);
        let deleting = false;
        return new Promise(resolve => {
            function finish(result) {
                dialog.close();
                dialog.remove();
                activeConfirmation = false;
                if (returnFocus?.isConnected) returnFocus.focus();
                resolve(result);
            }
            cancel.addEventListener('click', () => { if (!deleting) finish(false); });
            dialog.addEventListener('cancel', event => {
                event.preventDefault();
                if (!deleting) finish(false);
            });
            dialog.addEventListener('click', event => {
                const rect = dialog.getBoundingClientRect();
                if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
                    event.clientY < rect.top || event.clientY > rect.bottom) && !deleting) finish(false);
            });
            remove.addEventListener('click', async () => {
                if (deleting) return;
                deleting = true; cancel.disabled = true; error.textContent = '';
                const restore = busy(remove, pendingLabel);
                try {
                    await onDelete();
                    finish(true);
                } catch (cause) {
                    error.textContent = cause.message || 'Unable to complete the action. Please try again.';
                    restore(); deleting = false; cancel.disabled = false;
                }
            });
            dialog.showModal();
            cancel.focus();
        });
    }
    function confirmDelete(groupName, action) {
        return confirmAction({ title: 'Delete group?', message: 'Delete "' + groupName + '" and all its expenses? This cannot be undone.', confirmLabel: 'Delete', pendingLabel: 'Deleting...' }, action);
    }
    function flash(message, kind = 'info') {
        try { sessionStorage.setItem('expenseiq-feedback', JSON.stringify({ message, kind })); }
        catch { notify(message, kind); }
    }
    try {
        const saved = sessionStorage.getItem('expenseiq-feedback');
        if (saved) { sessionStorage.removeItem('expenseiq-feedback'); const item = JSON.parse(saved); notify(item.message, item.kind); }
    } catch { /* Storage may be unavailable; ordinary feedback still works. */ }
    return { notify, formError, busy, confirmDelete, confirmAction, flash };
})();
