'use strict';
const Limit = require('../models/signupRateLimit.model');
const { digest, SignupError } = require('./signupOtpSecurity');

// Fixed-window limits persist across workers, resends and process restarts.
async function consume(secret, scope, identity, maximum, windowMs, now = Date.now()) {
    const window = Math.floor(now / windowMs);
    const _id = digest(secret, 'signup-rate', scope, identity, window);
    const purgeAt = new Date((window + 2) * windowMs);
    let record;
    try {
        record = await Limit.findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { purgeAt } }, { upsert: true, new: true });
    } catch (error) {
        if (error.code !== 11000) throw error;
        record = await Limit.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { new: true });
    }
    if (!record || record.count > maximum) {
        throw new SignupError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.', Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)));
    }
}
// Explicit opt-in: shared ingress budgets are not individual client identities.
function policy(env = process.env) {
    const mode = env.SIGNUP_RATE_LIMIT_POLICY === undefined ? 'strict' : env.SIGNUP_RATE_LIMIT_POLICY;
    if (!['strict', 'shared_proxy'].includes(mode)) {
        throw new SignupError(503, 'SIGNUP_UNAVAILABLE', 'Email verification is temporarily unavailable.');
    }
    return { signup: mode === 'shared_proxy' ? 20 : 5,
        resend: mode === 'shared_proxy' ? 20 : 5, verify: mode === 'shared_proxy' ? 120 : 30 };
}
async function throttle(secret, action, identity, ip, now = Date.now(), consumeLimit = consume, env = process.env) {
    const limits = policy(env); // Reject invalid configuration before any counter writes.
    if (!Object.hasOwn(limits, action)) throw new Error('Unknown signup rate-limit action');
    // Repeated attempts against one email/challenge must exhaust that budget before
    // consuming the shared ingress budget. Identity comes from validated input.
    await consumeLimit(secret, `${action}:identity`, identity, action === 'verify' ? 20 : 5, 3600000, now);
    await consumeLimit(secret, `${action}:ip`, ip || 'unknown', limits[action], 900000, now);
    if (action !== 'verify') await consumeLimit(secret, 'mail:global', 'all', 100, 3600000, now);
}
module.exports = { consume, policy, throttle };
