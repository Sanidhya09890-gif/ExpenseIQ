const dns = require("node:dns");

// Force Node.js to use public DNS servers
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const dotenv = require("dotenv");
dotenv.config();

const app = require("./src/app");
const connectDB = require("./src/Config/db");

const startServer = async () => {

    try {

        await connectDB();

        app.listen(3000, () => {

            console.log("Server running on port 3000");

        });

    } catch (error) {

        console.log(error);

    }

};

startServer();