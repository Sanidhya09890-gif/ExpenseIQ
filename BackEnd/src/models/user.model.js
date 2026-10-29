const mongoose = require('mongoose');
const { validUsername, usernameIndex, usernameNeedsValidation } = require('../utils/usernamePolicy');

const userSchema = new mongoose.Schema({
    // Missing historical fields mean legacy_unverified, never proof of ownership.
    // Retain the earlier 'legacy' spelling as an unverified compatibility alias.
    emailVerificationStatus: { type: String, enum: ['legacy_unverified', 'legacy', 'verified'], default: 'legacy_unverified' },
    emailVerifiedAt: { type: Date, default: null },
    
    username: {
        type: String,
        required: function () { return usernameNeedsValidation(this); },
        validate: {
            validator: function (value) { return !usernameNeedsValidation(this) || validUsername(value); },
            message: 'Username must contain 3–40 letters, numbers, underscores, dots or hyphens'
        }
    },

    email: {
        type: String,
        required: true,
        unique: true
    },

    password: {
        type: String,
        required: true
    }

}, { autoIndex: false });

// Provision only via a separately approved migration; no index synchronization.
const index = usernameIndex();
userSchema.index(index.key, index.options);

const User = mongoose.model('User', userSchema);

module.exports = User;
