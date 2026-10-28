'use strict';

const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

module.exports = function maintenanceWriteGuard(req, res, next) {
    if (process.env.MAINTENANCE_WRITE_LOCK === 'true' && mutations.has(req.method)) {
        res.set('Retry-After', '120');
        return res.status(503).json({ message: 'ExpenseIQ is undergoing maintenance. Please try again shortly.' });
    }
    return next();
};
