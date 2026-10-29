'use strict';

(() => {
    const API_BASE = 'https://expenseiq-backend-xkmu.onrender.com';
    const store = ExpenseSignupVerification;
    const form = document.getElementById('verifyEmailForm');
    const input = document.getElementById('otp');
    const verifyButton = document.getElementById('verifyEmailButton');
    const resendButton = document.getElementById('resendCode');
    const status = document.getElementById('verificationStatus');
    const expiry = document.getElementById('otpExpiry');
    const cooldown = document.getElementById('resendCountdown');
    let state = store.read();
    let pending = false, timer = null, finished = false;
    const secondsUntil = time => Math.max(0, Math.ceil((time - Date.now()) / 1000));
    const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const announce = message => { if (status.textContent !== message) status.textContent = message; };
    function persist() {
        try { state = store.save(state); }
        catch { ExpenseUI.formError(form, 'Changes could not be saved in this tab. Keep this page open to continue.'); }
    }
    function render() {
        if (!state || finished) {
            input.disabled = true; verifyButton.disabled = true; resendButton.disabled = true;
            expiry.textContent = ''; cooldown.textContent = '';
            if (!finished) announce('No active verification session. Return to signup, or log in if your account already exists. A pending signup cannot be resumed without its original browser session.');
            return;
        }
        const remaining = secondsUntil(state.expiresAt);
        const resendWait = secondsUntil(Math.max(state.resendAvailableAt, state.resendRetryAt));
        const verifyWait = secondsUntil(state.verifyRetryAt);
        const expired = remaining === 0 && state.deliveryStatus === 'ready';
        expiry.textContent = state.deliveryStatus === 'unavailable' ? 'No confirmed code is available.' :
            state.deliveryStatus === 'unknown' ? 'Code timing is unconfirmed; the server will check the latest code.' :
                expired ? 'Code expired. Request a new code.' : `Code expires in ${clock(remaining)}`;
        cooldown.textContent = resendWait ? `Resend available in ${clock(resendWait)}` : 'You can request a new code.';
        if (state.attemptsExhausted) announce('Too many incorrect attempts. Request a new code when resend is available.');
        else if (expired) announce('Your code has expired. Resend to continue.');
        else if (state.deliveryStatus === 'unavailable') announce('Email delivery could not be confirmed. Wait for resend to become available, then request a new code.');
        else if (state.deliveryStatus === 'unknown') announce('The resend request could not be confirmed. If an email arrived, try its latest code; otherwise wait and resend.');
        else announce(verifyWait ? 'Verification is temporarily rate limited. Please wait before retrying.' : 'Enter your code to finish creating your account.');
        input.disabled = pending || expired || state.attemptsExhausted || state.deliveryStatus === 'unavailable';
        verifyButton.disabled = pending || input.disabled || verifyWait > 0 || !/^\d{6}$/.test(input.value);
        resendButton.disabled = pending || resendWait > 0;
    }
    function retrySeconds(response) {
        const value = response.headers?.get('Retry-After');
        if (value && /^\d+$/.test(value)) return Math.min(86400, Number(value));
        const date = value ? Date.parse(value) : NaN;
        return Number.isFinite(date) ? Math.min(86400, Math.max(1, Math.ceil((date - Date.now()) / 1000))) : 120;
    }
    async function request(action) {
        if (!state || pending || finished) return;
        render();
        const verifying = action === 'verify';
        if ((verifying ? verifyButton : resendButton).disabled) return;
        pending = true;
        const restore = ExpenseUI.busy(verifying ? verifyButton : resendButton, verifying ? 'Verifying…' : 'Sending code…');
        ExpenseUI.formError(form);
        const startedAt = Date.now();
        let knownRejection = false;
        // OTP lives only in this request; clear it immediately from the DOM.
        const body = { registrationId: state.registrationId, registrationToken: state.registrationToken };
        if (verifying) { body.otp = input.value; input.value = ''; }
        render();
        try {
            const response = await fetch(`${API_BASE}/api/auth/signup/${action}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body), credentials: 'omit', cache: 'no-store',
                signal: AbortSignal.timeout(20000)
            });
            knownRejection = !response.ok;
            let data;
            try { data = await response.json(); }
            catch { throw new Error('The server returned an unexpected response. Please try again.'); }
            if (!response.ok) {
                if (data.code === 'REGISTRATION_UNAVAILABLE' || data.code === 'INVALID_CHALLENGE') {
                    store.clear(); state = null;
                } else if (data.code === 'OTP_ATTEMPTS_EXCEEDED') state.attemptsExhausted = true;
                else if (data.code === 'OTP_EXPIRED') { state.expiresAt = Date.now(); state.deliveryStatus = 'ready'; }
                else if (['EMAIL_DELIVERY_FAILED', 'OTP_NOT_READY', 'OTP_SUPERSEDED'].includes(data.code)) {
                    state.deliveryStatus = 'unavailable';
                    if (!verifying) state.resendAvailableAt = startedAt + 120000;
                }
                if (state && response.status === 429 && data.code !== 'OTP_ATTEMPTS_EXCEEDED') {
                    const retryAt = Date.now() + retrySeconds(response) * 1000;
                    if (verifying) state.verifyRetryAt = retryAt;
                    else state.resendRetryAt = retryAt;
                }
                if (state) persist();
                if (response.status === 404) throw new Error('Email verification is unavailable on this backend. Your signup session is retained; try again later or use login for an existing account.');
                throw new Error(data.message || 'Unable to complete verification. Please try again.');
            }
            if (verifying) {
                // Reject malformed success rather than claiming the account was verified.
                if (!data.id || typeof data.message !== 'string') throw new Error('Verification could not be confirmed. Try logging in before requesting another code.');
                store.clear(); state = null; finished = true;
                ExpenseUI.flash('Email verified. Sign in to continue.', 'success');
                window.location.href = './login.html';
            } else {
                const updated = store.validate({ ...state, ...data, registrationToken: state.registrationToken,
                    deliveryStatus: 'ready', attemptsExhausted: false, verifyRetryAt: 0, resendRetryAt: 0 });
                if (!updated || data.registrationId !== state.registrationId || data.verificationRequired !== true ||
                    !data.expiresAt || !data.resendAvailableAt) throw new Error('The new code could not be confirmed. Wait before retrying.');
                state = updated; input.value = ''; persist();
                ExpenseUI.notify('A new code was sent. Use the latest email.', 'success');
            }
        } catch (error) {
            // A network failure can happen after the server rotated the code. Do not
            // claim the old code is still valid or reset the backend attempt budget.
            if (!verifying && !knownRejection && state && state.resendAvailableAt <= startedAt) {
                state.deliveryStatus = 'unknown';
                state.resendAvailableAt = startedAt + 120000;
                persist();
            }
            ExpenseUI.formError(form, error.message || 'Network error. Please try again.');
        } finally {
            if (verifying) delete body.otp;
            restore?.(); pending = false; render();
            if (state && !input.disabled) input.focus();
        }
    }
    form.addEventListener('submit', event => { event.preventDefault(); return request('verify'); });
    resendButton.addEventListener('click', () => request('resend'));
    input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9]/g, '').slice(0, 6); render(); });
    function startTimer() { if (timer === null) timer = setInterval(render, 1000); render(); }
    window.addEventListener('pagehide', () => { input.value = ''; clearInterval(timer); timer = null; });
    window.addEventListener('pageshow', () => { if (!pending) state = store.read(); startTimer(); });
    startTimer();
    if (state && !input.disabled) input.focus();
})();
