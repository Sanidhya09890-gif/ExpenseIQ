const Notification = require('../models/notification.model');


// GET NOTIFICATIONS FOR LOGGED-IN USER
exports.getNotifications = async (req, res) => {

    try {

        const notifications = await Notification.find({
            recipient: req.user.id
    })
    .populate('relatedUser', 'name username')
    .populate('groupId', 'groupName')
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