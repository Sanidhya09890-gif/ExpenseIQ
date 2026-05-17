const app = require('./src/app');

const dotenv = require('dotenv');

const connectDB = require('./src/Config/db');

dotenv.config();

const startServer = async () => {

    try {

        await connectDB();

        app.listen(3000,() => {

            console.log("Server running on port 3000");

        });

    } catch (error) {

        console.log(error);

    }

};

startServer();