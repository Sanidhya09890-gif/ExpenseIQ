'use strict';

document.querySelectorAll('.password-toggle').forEach(button => {
    const input = document.getElementById(button.getAttribute('aria-controls'));
    const slash = button.querySelector('[data-eye-slash]');
    if (!input || !slash) return;

    function updateState() {
        const isVisible = input.type === 'text';
        slash.hidden = isVisible;
        button.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(isVisible));
    }

    button.addEventListener('click', () => {
        input.type = input.type === 'text' ? 'password' : 'text';
        updateState();
    });
    updateState();
});
