const User = require('../models/user.model');

const bcrypt = require('bcryptjs');

const jwt = require('jsonwebtoken');


// SIGNUP
exports.signup = async (req, res) => {

    try {

        const { username, email, password } = req.body;
        //email already exists?
        const existingUser = await User.findOne({ email });

        if (existingUser) {

            return res.status(400).json({
                message: "User already exists"
            });

        }
        // Check if username already exists
        const existingUsername = await User.findOne({ username });

        if (existingUsername) {
            return res.status(400).json({
                message: "Username already taken"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            username,
            email,
            password: hashedPassword
        });

        res.status(201).json({
            message: "User created successfully",
            id: user._id,
            username: user.username,
            email: user.email
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};


// LOGIN
exports.login = async (req, res) => {

    try {

        const { loginInput, password } = req.body;

        // Find user by username OR email
        const user = await User.findOne({
            $or: [
                { username: loginInput },
                { email: loginInput }
            ]
        });

        if (!user) {

            return res.status(400).json({
                message: "Invalid username/email or password"
            });

        }

        const isMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isMatch) {

            return res.status(400).json({
                message: "Invalid username/email or password"
            });

        }

        const token = jwt.sign(
            {
                id: user._id
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        );

        res.status(200).json({
            message: "Login successful",
            token,
            user
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};