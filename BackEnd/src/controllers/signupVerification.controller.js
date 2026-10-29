'use strict';
const registration = require('../services/signupRegistration');
const { SignupError } = require('../services/signupOtpSecurity');
const { clientRateLimitIdentity } = require('../Config/httpSecurity');

function respondError(res, error) {
    res.set('Cache-Control', 'no-store');
    if (error instanceof SignupError) {
        if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
        return res.status(error.status).json({ message: error.message, code: error.code, ...error.challenge });
    }
    return res.status(503).json({ message: 'Email verification is temporarily unavailable.', code: 'SIGNUP_UNAVAILABLE' });
}
function endpoint(action, status) {
    return async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (process.env.SIGNUP_EMAIL_OTP_ENABLED !== 'true') return res.status(404).json({ message: 'Not found' });
        try { return res.status(status).json(await registration[action](req.body, clientRateLimitIdentity(req))); }
        catch (error) { return respondError(res, error); }
    };
}
module.exports = { start: endpoint('start', 202), verify: endpoint('verify', 201), resend: endpoint('resend', 202) };
