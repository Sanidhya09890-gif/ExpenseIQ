'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: String,
    count: { type: Number, required: true },
    purgeAt: { type: Date, required: true }
}, { autoIndex: false, autoCreate: false, versionKey: false });
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0, name: 'signup_limit_cleanup' });
module.exports = mongoose.model('SignupRateLimit', schema);
