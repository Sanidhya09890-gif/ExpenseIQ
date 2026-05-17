const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({

    groupName: {
        type: String,
        required: true
    },

    members: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ],

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }

}, {
    timestamps: true
});

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;