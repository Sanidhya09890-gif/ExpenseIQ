'use strict';
const crypto = require('node:crypto');
const { validEmail, emailConfiguration } = require('./signupEmailConfiguration');
const { validUsername } = require('../utils/usernamePolicy');

class SignupError extends Error {
    constructor(status, code, message, retryAfter) {
        super(message); Object.assign(this, { status, code, retryAfter });
    }
}
function configuration(env = process.env) {
    const secret = env.OTP_HMAC_SECRET;
    let providerReady = false;
    try { emailConfiguration(env); providerReady = true; } catch { /* Fail closed without logging credentials. */ }
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || secret === env.JWT_SECRET || !providerReady) {
        throw new SignupError(503, 'SIGNUP_UNAVAILABLE', 'Email verification is temporarily unavailable.');
    }
    return { secret };
}
const digest = (secret, ...parts) => crypto.createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex');
const tokenDigest = token => crypto.createHash('sha256').update(token).digest('hex');
const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const otpDigest = (secret, id, generation, otp) => digest(secret, 'signup-otp', String(id), generation, otp);
function equalDigest(a, b) {
    return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) &&
        /^[a-f0-9]{64}$/.test(b) && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function registrationInput(input) {
    const { username, email, password } = input || {};
    if (!validUsername(username) ||
        typeof email !== 'string' || !validEmail(email.trim()) ||
        typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
        throw new SignupError(400, 'INVALID_SIGNUP', 'Use a valid email, a 3–40 character username (letters, numbers, _, . or -), and a password of at least 12 characters and at most 72 bytes.');
    }
    return { username, email: email.trim().toLowerCase(), password };
}
function challengeInput(input, verify = false) {
    const { registrationId, registrationToken, otp } = input || {};
    if (typeof registrationId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(registrationId) ||
        typeof registrationToken !== 'string' || !/^[a-f0-9]{64}$/.test(registrationToken) ||
        (verify && (typeof otp !== 'string' || !/^\d{6}$/.test(otp)))) {
        throw new SignupError(400, 'INVALID_CHALLENGE', 'Provide a valid registration challenge and six-digit code.');
    }
    return { registrationId, registrationToken, otp };
}
module.exports = { SignupError, configuration, digest, tokenDigest, generateOtp, otpDigest, equalDigest, registrationInput, challengeInput };
