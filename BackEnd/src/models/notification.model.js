const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },

        type: {
            type: String,
            required: true,
            enum: [
            'INVITE_ACCEPTED',
            'INVITE_REJECTED'
            ]
        },

        message: {
            type: String,
            required: true
        },

        groupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group',
            required: true
        },

        relatedUser: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },

        isRead: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model(
    'Notification',
    notificationSchema
);