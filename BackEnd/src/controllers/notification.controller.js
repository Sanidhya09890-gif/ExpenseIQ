const Notification = require('../models/notification.model');

// Only the authenticated recipient's unread activity can be updated.
exports.markAsRead = async (req, res) => {
    const ids = req.body?.notificationIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
        !ids.every(id => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) ||
        new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
        return res.status(400).json({ message: 'notificationIds must contain 1–100 unique valid ObjectIds' });
    }
    try {
        const result = await Notification.updateMany({
            _id: { $in: ids }, recipient: req.user.id,
            type: { $in: ['INVITE_ACCEPTED', 'INVITE_REJECTED'] }, isRead: false
        }, { $set: { isRead: true } });
        return res.status(200).json({ modifiedCount: result.modifiedCount });
    } catch (error) {
        return res.status(500).json({ message: 'Unable to mark notifications as read' });
    }
};


// GET NOTIFICATIONS FOR LOGGED-IN USER
exports.getNotifications = async (req, res) => {

    try {

        const notifications = await Notification.find({
            recipient: req.user.id
    })
    .populate('relatedUser', 'name username')
    .populate('groupId', 'groupName')
    .populate('inviteId')
    .sort({ createdAt: -1 });

        res.status(200).json({
            notifications
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};
