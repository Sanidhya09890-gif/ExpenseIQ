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
