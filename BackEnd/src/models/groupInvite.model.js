const mongoose = require('mongoose');

const groupInviteSchema = new mongoose.Schema({
    invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    groupId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },

    invitee:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending'
    },

    expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }

    
}, { timestamps: true });

const GroupInvite = mongoose.model('GroupInvite', groupInviteSchema);

module.exports = GroupInvite;

