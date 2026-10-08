const Group = require('../models/group.model');
const Expense = require('../models/expense.model');
const GroupInvite = require('../models/groupInvite.model');
const User = require('../models/user.model');
const Notification = require('../models/notification.model');


// CREATE GROUP
exports.createGroup = async (req, res) => {

    try {

        const { groupName } = req.body;

        const group = await Group.create({

            groupName,

            members: [req.user.id],

            createdBy: req.user.id

        });

        res.status(201).json({
            message: "Group created successfully",
            group
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};


// GET ALL GROUPS OF LOGGED-IN USER
exports.getGroups = async (req, res) => {

    try {

        const groups = await Group.find({
            members: req.user.id
        }).populate('members', 'name email');

        res.status(200).json({
            groups
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};
//genrating invite for the user
exports.inviteUser = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { username } = req.body;

        // Find the group
        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        // Check if logged-in user is the owner
        if (group.createdBy.toString() !== req.user.id) {
            return res.status(403).json({
                message: "Only the group owner can send invitations"
            });
        }

        // Find the user by username
        const invitee = await User.findOne({ username });

        if (!invitee) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Prevent owner from inviting themselves
        if (invitee._id.toString() === req.user.id) {
            return res.status(400).json({
                message: "You cannot invite yourself"
            });
        }

        // Check if user is already a member
        if (group.members.includes(invitee._id)) {
            return res.status(400).json({
                message: "User is already a member of this group"
            });
        }

        // Check for an existing pending invitation
        const existingInvite = await GroupInvite.findOne({
            groupId,
            invitee: invitee._id,
            status: 'pending'
        });

        if (existingInvite) {
            return res.status(400).json({
                message: "A pending invitation already exists for this user"
            });
        }

        // Create invitation
        const invite = await GroupInvite.create({
            invitedBy: req.user.id,
            groupId,
            invitee: invitee._id
        });

        await Notification.create({
        recipient: invitee._id,
        type: 'INVITE_RECEIVED',
        message: 'You received a group invitation',
        groupId: groupId,
        relatedUser: req.user.id,
        inviteId: invite._id
    });

        res.status(201).json({
            message: "Invitation sent successfully",
            invite
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};
//fetching pending invites for the user
exports.getPendingInvites = async (req, res) => {
    try {
        const invites = await GroupInvite.find({
            invitee: req.user.id,
            status: 'pending'
        })
        .populate('invitedBy', 'name username')
        .populate('groupId', 'groupName');

        res.status(200).json({
            invites
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

//user can acceptInvite
exports.acceptInvite = async (req, res) => {
    try {
        const { inviteId } = req.params;

        // Find the invitation
        const invite = await GroupInvite.findById(inviteId);

        if (!invite) {
            return res.status(404).json({
                message: "Invitation not found"
            });
        }

        // Make sure this invitation belongs to the logged-in user
        if (invite.invitee.toString() !== req.user.id) {
            return res.status(403).json({
                message: "You are not authorized to accept this invitation"
            });
        }

        // Check invitation status
        if (invite.status !== 'pending') {
            return res.status(400).json({
                message: `Invitation is already ${invite.status}`
            });
        }

        // Check if invitation has expired
        if (invite.expiresAt < new Date()) {
            invite.status = 'expired';
            await invite.save();

            return res.status(400).json({
                message: "Invitation has expired"
            });
        }

        // Find the group
        const group = await Group.findById(invite.groupId);

        if (!group) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        // Add user to group
        if (!group.members.includes(req.user.id)) {
            group.members.push(req.user.id);
            await group.save();
        }

        // Mark invitation as accepted
        invite.status = 'accepted';
        await invite.save();

        // Remove the invitation notification for the invitee
        await Notification.deleteOne({
        recipient: invite.invitee,
        inviteId: invite._id,
        type: 'INVITE_RECEIVED'
        });

        await Notification.create({
            recipient: invite.invitedBy,
            type: 'INVITE_ACCEPTED',
            message: 'Your invitation was accepted',
            groupId: invite.groupId,
            relatedUser: invite.invitee
        });

        res.status(200).json({
            message: "Invitation accepted successfully",
            group
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// USER CAN REJECT INVITE
exports.rejectInvite = async (req, res) => {
    try {
        const { inviteId } = req.params;

        // Find the invitation
        const invite = await GroupInvite.findById(inviteId);

        if (!invite) {
            return res.status(404).json({
                message: "Invitation not found"
            });
        }

        // Make sure this invitation belongs to the logged-in user
        if (invite.invitee.toString() !== req.user.id) {
            return res.status(403).json({
                message: "You are not authorized to reject this invitation"
            });
        }

        // Check invitation status
        if (invite.status !== 'pending') {
            return res.status(400).json({
                message: `Invitation is already ${invite.status}`
            });
        }

        // Check if invitation has expired
        if (invite.expiresAt < new Date()) {
            invite.status = 'expired';
            await invite.save();

            return res.status(400).json({
                message: "Invitation has expired"
            });
        }

        // Mark invitation as rejected
        invite.status = 'rejected';
        await invite.save();

        // Remove the invitation notification for the invitee
        await Notification.deleteOne({
        recipient: invite.invitee,
        inviteId: invite._id,
        type: 'INVITE_RECEIVED'
        });

        await Notification.create({
            recipient: invite.invitedBy,
            type: 'INVITE_REJECTED',
            message: 'Your invitation was rejected',
            groupId: invite.groupId,
            relatedUser: invite.invitee
        });

        res.status(200).json({
            message: "Invitation rejected successfully"
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// GET REJECTED INVITES FOR GROUP OWNER
exports.getRejectedInvites = async (req, res) => {
    try {

        const invites = await GroupInvite.find({
            invitedBy: req.user.id,
            status: 'rejected'
        })
        .populate('invitee', 'name username')
        .populate('groupId', 'groupName');

        res.status(200).json({
            invites
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }
};

// DELETE GROUP
exports.deleteGroup = async (req, res) => {

    try {

        const { groupId } = req.params;

        // CHECK IF GROUP EXISTS AND BELONGS TO THE LOGGED-IN USER
        const group = await Group.findOne({
            _id: groupId,
            createdBy: req.user.id
        });

        if (!group) {

            return res.status(404).json({
                message: "Group not found or you are not authorized to delete it"
            });

        }

        // DELETE ALL EXPENSES OF THIS GROUP
        await Expense.deleteMany({
            groupId: groupId
        });

        // DELETE GROUP
        await Group.findByIdAndDelete(groupId);

        res.status(200).json({
            message: "Group and all expenses deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};