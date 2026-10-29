'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    passwordHash: { type: String, select: false },
    tokenDigest: { type: String, select: false },
    otpDigest: { type: String, select: false },
    generation: { type: Number, required: true, default: 1 },
    attempts: { type: Number, required: true, default: 0 },
    state: { type: String, enum: ['sending', 'ready', 'delivery_failed', 'consumed'], required: true },
    expiresAt: { type: Date, required: true },
    nextSendAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true },
    consumedAt: Date
}, { timestamps: true, autoIndex: false, autoCreate: false });
// Explicitly provision these indexes only in an approved database setup step.
schema.index({ email: 1 }, { unique: true, name: 'unique_pending_registration_email' });
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0, name: 'pending_registration_cleanup' });
module.exports = mongoose.model('PendingRegistration', schema);
