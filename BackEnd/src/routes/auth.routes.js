const express = require('express');

const router = express.Router();

const {
    signup,
    login
} = require('../controllers/auth.controller');

router.post('/signup', signup);
const verification = require('../controllers/signupVerification.controller');
// Both routes remain inside the existing /api/auth/signup maintenance mount.
router.post('/signup/verify', verification.verify);
router.post('/signup/resend', verification.resend);

router.post('/login', login);

module.exports = router;
