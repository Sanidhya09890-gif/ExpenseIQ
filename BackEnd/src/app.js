const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const maintenanceWriteGuard = require('./middleware/maintenance.middleware');

const authRoutes = require('./routes/auth.routes');

const groupRoutes = require('./routes/group.routes');

const expenseRoutes = require('./routes/expense.routes');

const notificationRoutes = require('./routes/notification.routes');

const app = express();

app.use(cors());
app.get('/readyz', (req, res) => {
    const ready = !app.locals.shuttingDown && mongoose.connection.readyState === 1;
    res.set('Cache-Control', 'no-store');
    return res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});
app.use(['/api/groups', '/api/expenses', '/api/auth/signup', '/api/notifications'], maintenanceWriteGuard);
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/expenses',expenseRoutes);
app.use('/api/notifications', notificationRoutes);

module.exports = app;
