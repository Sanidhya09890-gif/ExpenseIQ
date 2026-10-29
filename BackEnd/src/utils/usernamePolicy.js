'use strict';

// Keep case-sensitive identity semantics; never normalize existing usernames.
const validUsername = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{3,40}$/.test(value);
function usernameIndex() {
    return { key: { username: 1 }, options: {
        name: 'unique_username_string', unique: true,
        partialFilterExpression: { username: { $type: 'string' } },
        collation: { locale: 'simple' }
    } };
}
function approvedUsernameIndex(index) {
    const filter = index?.partialFilterExpression;
    const condition = filter?.username;
    // Ignore MongoDB-generated metadata (v/background), but reject broader or
    // narrower filters, compound keys, sparse/hidden indexes and other collations.
    return index?.name === 'unique_username_string' && index.unique === true &&
        index.key && Object.keys(index.key).length === 1 && index.key.username === 1 &&
        !index.sparse && !index.hidden && filter && Object.keys(filter).length === 1 &&
        condition && Object.keys(condition).length === 1 && condition.$type === 'string' &&
        (!index.collation || Object.keys(index.collation).length === 1 && index.collation.locale === 'simple');
}
function usernameNeedsValidation(document) {
    // Preserve untouched legacy fields on document saves. Query validators and
    // explicit username edits/new documents still require a valid username.
    return !document || typeof document.isModified !== 'function' || document.isNew || document.isModified('username');
}
module.exports = { validUsername, usernameIndex, approvedUsernameIndex, usernameNeedsValidation };
