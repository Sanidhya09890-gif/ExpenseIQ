const dns = require("node:dns");

// Force Node.js to use public DNS servers
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const dotenv = require("dotenv");
dotenv.config();

const app = require("./src/app");
const connectDB = require("./src/Config/db");
const mongoose = require('mongoose');
const installShutdown = require('./src/services/serverLifecycle');

const startServer = async () => {

    try {

        await connectDB();
        if (process.env.SIGNUP_EMAIL_OTP_ENABLED === 'true') {
            try {
                await require('./src/services/signupPrerequisites').validatePrerequisites();
                console.log('OTP prerequisites: PASS');
            } catch {
                console.error('OTP prerequisites: FAIL');
                try { await mongoose.disconnect(); } catch { /* No raw errors or secrets. */ }
                process.exitCode = 1;
                return;
            }
        }


        const port = Number(process.env.PORT) || 3000;
        const server = app.listen(port, () => {

            console.log(`Server running on port ${port}`);

        });
        installShutdown(server, app, mongoose);
        server.on('error', () => {
            console.error('Backend listener failed');
            process.exit(1);
        });

    } catch (error) {

        console.error('Backend startup failed');
        process.exit(1);

    }

};

startServer();
