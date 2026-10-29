'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const PendingModel = require('../models/pendingRegistration.model');
const UserModel = require('../models/user.model');
const LimitModel = require('../models/signupRateLimit.model');
const tx = require('./groupTransactions');
const mail = require('./signupEmail');
const rate = require('./signupRateLimiter');
const security = require('./signupOtpSecurity');
const { SignupError, tokenDigest, otpDigest, equalDigest } = security;
const { approvedUsernameIndex } = require('../utils/usernamePolicy');
const FIVE_MINUTES = 300000, COOLDOWN = 120000, LIFETIME = 86400000;
const privateFields = '+passwordHash +tokenDigest +otpDigest';
const unavailable = () => new SignupError(400, 'REGISTRATION_UNAVAILABLE', 'This registration cannot be completed. Sign in or try a new registration later.');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createService({ Pending = PendingModel, Users = UserModel, Limits = LimitModel, transactions = tx,
    sendEmail = payload => mail.sendSignupOtp(payload), consume = (...args) => rate.consume(...args),
    config = () => security.configuration(), now = () => Date.now(), makeOtp = security.generateOtp } = {}) {
    async function ready() {
        const settings = config();
        // Fail closed until explicitly provisioned; never create indexes on requests.
        const pendingIndexes = await Pending.collection.indexes();
        const limitIndexes = await Limits.collection.indexes();
        const userIndexes = await Users.collection.indexes();
        const unique = (indexes, field) => indexes.some(i => i.unique === true && !i.partialFilterExpression && !i.sparse &&
            Object.keys(i.key).length === 1 && i.key[field] === 1);
        if (!unique(pendingIndexes, 'email') || !unique(userIndexes, 'email') || !userIndexes.some(approvedUsernameIndex) ||
            !pendingIndexes.some(i => i.key.purgeAt === 1 && i.expireAfterSeconds === 0) ||
            !limitIndexes.some(i => i.key.purgeAt === 1 && i.expireAfterSeconds === 0)) {
            throw new SignupError(503, 'SIGNUP_UNAVAILABLE', 'Email verification is temporarily unavailable.');
        }
        await transactions.inspectTopology();
        return settings;
    }
    async function throttle(secret, action, identity, ip) {
        // The HTTP controller supplies the canonical identity from Express's
        // explicitly trusted-peer policy; never parse client headers here.
        await rate.throttle(secret, action, identity, ip, now(), consume);
    }
    const publicChallenge = (record, registrationToken) => ({
        verificationRequired: true, registrationId: String(record._id),
        ...(registrationToken ? { registrationToken } : {}),
        expiresAt: record.expiresAt, resendAvailableAt: record.nextSendAt
    });
    async function deliver(record, otp) {
        try {
            await sendEmail({ email: record.email, otp, deliveryId: `${record._id}-${record.generation}` });
        } catch {
            await Pending.updateOne({ _id: record._id, generation: record.generation, state: 'sending' },
                { $set: { state: 'delivery_failed' }, $unset: { otpDigest: '' } });
            throw new SignupError(503, 'EMAIL_DELIVERY_FAILED', 'The verification email could not be confirmed. Wait for the resend cooldown, then retry.');
        }
        const updated = await Pending.updateOne({ _id: record._id, generation: record.generation,
            state: 'sending', expiresAt: { $gt: new Date(now()) }, purgeAt: { $gt: new Date(now()) } }, { $set: { state: 'ready' } });
        if (updated.modifiedCount !== 1) throw new SignupError(409, 'OTP_SUPERSEDED', 'This code was replaced or expired. Request a fresh code.');
    }
    async function start(input, ip) {
        const values = security.registrationInput(input);
        const { secret } = await ready();
        await throttle(secret, 'signup', values.email, ip);
        const existing = await Users.findOne({ $or: [{ username: values.username },
            { email: { $regex: `^${escapeRegex(values.email)}$`, $options: 'i' } }] });
        if (existing) throw unavailable();
        const time = now();
        // Reclaim only an expired disposable registration, never a User.
        await Pending.deleteOne({ email: values.email, purgeAt: { $lte: new Date(time) } });
        const registrationToken = crypto.randomBytes(32).toString('hex');
        const id = new mongoose.Types.ObjectId();
        const otp = makeOtp();
        let record;
        try {
            record = await Pending.create({ _id: id, username: values.username, email: values.email,
                passwordHash: await bcrypt.hash(values.password, 12), tokenDigest: tokenDigest(registrationToken),
                otpDigest: otpDigest(secret, id, 1, otp), generation: 1, attempts: 0, state: 'sending',
                expiresAt: new Date(time + FIVE_MINUTES), nextSendAt: new Date(time + COOLDOWN), purgeAt: new Date(time + LIFETIME) });
        } catch (error) {
            if (error.code === 11000) throw unavailable();
            throw error;
        }
        const challenge = publicChallenge(record, registrationToken);
        try { await deliver(record, otp); }
        catch (error) { if (error instanceof SignupError) error.challenge = challenge; throw error; }
        return { message: 'Check your email for the verification code.', ...challenge };
    }
    async function resend(input, ip) {
        const values = security.challengeInput(input);
        const { secret } = await ready();
        // Challenge ID is stable across resends; additional IP/global limits stop challenge rotation.
        await throttle(secret, 'resend', values.registrationId.toLowerCase(), ip);
        const otp = makeOtp();
        const record = await transactions.run(async session => {
            const pending = await Pending.findOne({ _id: values.registrationId,
                tokenDigest: tokenDigest(values.registrationToken), purgeAt: { $gt: new Date(now()) },
                state: { $ne: 'consumed' } }).select(privateFields).session(session);
            if (!pending) throw unavailable();
            const time = now();
            if (pending.nextSendAt.getTime() > time) throw new SignupError(429, 'RESEND_COOLDOWN',
                'Wait before requesting another code.', Math.ceil((pending.nextSendAt.getTime() - time) / 1000));
            pending.generation += 1;
            pending.otpDigest = otpDigest(secret, pending._id, pending.generation, otp);
            pending.attempts = 0; pending.state = 'sending';
            pending.expiresAt = new Date(time + FIVE_MINUTES); pending.nextSendAt = new Date(time + COOLDOWN);
            await pending.save({ session });
            return pending;
        });
        await deliver(record, otp);
        return { message: 'A new verification code was sent.', ...publicChallenge(record) };
    }
    async function verify(input, ip) {
        const values = security.challengeInput(input, true);
        const { secret } = await ready();
        await throttle(secret, 'verify', values.registrationId.toLowerCase(), ip);
        let result;
        try {
            result = await transactions.run(async session => {
                const pending = await Pending.findOne({ _id: values.registrationId,
                    tokenDigest: tokenDigest(values.registrationToken), purgeAt: { $gt: new Date(now()) },
                    state: { $ne: 'consumed' } }).select(privateFields).session(session);
                if (!pending) throw unavailable();
                const time = now();
                if (pending.state !== 'ready') throw new SignupError(409, 'OTP_NOT_READY', 'Request a code and wait for email confirmation before verifying.');
                if (pending.attempts >= 5) throw new SignupError(429, 'OTP_ATTEMPTS_EXCEEDED', 'This code is locked. Request a new code after the cooldown.');
                if (pending.expiresAt.getTime() <= time) throw new SignupError(400, 'OTP_EXPIRED', 'This code has expired. Request a new code.');
                if (!equalDigest(pending.otpDigest, otpDigest(secret, pending._id, pending.generation, values.otp))) {
                    pending.attempts += 1;
                    await pending.save({ session });
                    // Return rather than throw so the failed attempt commits.
                    return { error: new SignupError(pending.attempts >= 5 ? 429 : 400,
                        pending.attempts >= 5 ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID', 'Invalid or exhausted verification code.') };
                }
                if (await Users.findOne({ $or: [{ username: pending.username },
                    { email: { $regex: `^${escapeRegex(pending.email)}$`, $options: 'i' } }] }).session(session)) throw unavailable();
                const [user] = await Users.create([{ username: pending.username, email: pending.email,
                    password: pending.passwordHash, emailVerificationStatus: 'verified', emailVerifiedAt: new Date(time) }], { session });
                pending.state = 'consumed'; pending.consumedAt = new Date(time);
                pending.otpDigest = undefined; pending.passwordHash = undefined; pending.tokenDigest = undefined;
                await pending.save({ session });
                return { message: 'Email verified. Sign in to continue.', id: user._id, username: user.username, email: user.email };
            });
        } catch (error) {
            if (error.code === 11000) throw unavailable();
            throw error;
        }
        if (result.error) throw result.error;
        return result;
    }
    return { start, resend, verify };
}
module.exports = { createService, ...createService() };
