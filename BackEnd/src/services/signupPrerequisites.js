'use strict';
const PendingModel = require('../models/pendingRegistration.model');
const UserModel = require('../models/user.model');
const LimitModel = require('../models/signupRateLimit.model');
const transactionsModel = require('./groupTransactions');
const security = require('./signupOtpSecurity');
const rate = require('./signupRateLimiter');
const { approvedUsernameIndex } = require('../utils/usernamePolicy');

function exactIndex(index, name, field, unique, ttl) {
    return index.name === name && index.key && Object.keys(index.key).length === 1 && index.key[field] === 1 &&
        !!index.unique === unique && !index.partialFilterExpression && !index.sparse && !index.hidden &&
        (!index.collation || Object.keys(index.collation).length === 1 && index.collation.locale === 'simple') &&
        index.expireAfterSeconds === ttl;
}
async function validatePrerequisites({ Pending = PendingModel, Users = UserModel, Limits = LimitModel,
    transactions = transactionsModel, config = () => security.configuration(), ratePolicy = () => rate.policy() } = {}) {
    const settings = config();
    ratePolicy();
    // indexes() fails for missing collections; never auto-create or synchronize.
    const pending = await Pending.collection.indexes();
    const limits = await Limits.collection.indexes();
    const users = await Users.collection.indexes();
    if (!users.some(approvedUsernameIndex) ||
        !users.some(i => exactIndex(i, 'email_1', 'email', true, undefined)) ||
        !pending.some(i => exactIndex(i, 'unique_pending_registration_email', 'email', true, undefined)) ||
        !pending.some(i => exactIndex(i, 'pending_registration_cleanup', 'purgeAt', false, 0)) ||
        !limits.some(i => exactIndex(i, 'signup_limit_cleanup', 'purgeAt', false, 0))) {
        throw new security.SignupError(503, 'SIGNUP_UNAVAILABLE', 'Email verification is temporarily unavailable.');
    }
    await transactions.inspectTopology();
    return settings;
}
module.exports = { validatePrerequisites };
