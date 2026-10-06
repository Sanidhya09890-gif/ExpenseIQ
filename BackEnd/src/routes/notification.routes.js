const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const notificationController = require('../controllers/notification.controller');


// GET NOTIFICATIONS FOR LOGGED-IN USER
router.get(
    '/',
    authMiddleware,
    notificationController.getNotifications
);


module.exports = router;