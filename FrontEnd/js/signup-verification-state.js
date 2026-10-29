'use strict';

// Only the limited registration capability and UI timing state belong here.
// Passwords, OTPs, email addresses and application JWTs are never persisted.
globalThis.ExpenseSignupVerification = (() => {
    const key = 'expenseiq-signup-verification';
    function validate(value) {
        if (!value || typeof value.registrationId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value.registrationId) ||
            typeof value.registrationToken !== 'string' || !/^[a-f0-9]{64}$/.test(value.registrationToken)) return null;
        const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : Date.parse(value.expiresAt);
        const resendAvailableAt = typeof value.resendAvailableAt === 'number' ? value.resendAvailableAt : Date.parse(value.resendAvailableAt);
        if (!Number.isFinite(expiresAt) || !Number.isFinite(resendAvailableAt)) return null;
        return { registrationId: value.registrationId, registrationToken: value.registrationToken,
            expiresAt, resendAvailableAt,
            deliveryStatus: ['ready', 'unavailable', 'unknown'].includes(value.deliveryStatus) ? value.deliveryStatus : 'ready',
            attemptsExhausted: value.attemptsExhausted === true,
            verifyRetryAt: Number.isFinite(value.verifyRetryAt) ? value.verifyRetryAt : 0,
            resendRetryAt: Number.isFinite(value.resendRetryAt) ? value.resendRetryAt : 0,
            discardAt: Number.isFinite(value.discardAt) ? value.discardAt : Date.now() + 86400000 };
    }
    function save(value) {
        const safe = validate(value);
        if (!safe) throw new Error('Verification details are unavailable. Please try signing up again.');
        try { sessionStorage.setItem(key, JSON.stringify(safe)); }
        catch { throw new Error('Verification needs session storage. Allow it for this site and try again.'); }
        return safe;
    }
    function clear() { try { sessionStorage.removeItem(key); } catch { /* No session state remains usable. */ } }
    function read() {
        try {
            const safe = validate(JSON.parse(sessionStorage.getItem(key)));
            if (!safe || safe.discardAt <= Date.now()) { clear(); return null; }
            return safe;
        } catch { clear(); return null; }
    }
    return { save, read, clear, validate };
})();
