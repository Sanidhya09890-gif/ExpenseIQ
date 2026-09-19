const mongoose = require('mongoose');

const GroupInvite = new mongoose.Schema({
    invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    groupId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
    },

    invitee:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    
});

