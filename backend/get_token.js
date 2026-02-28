const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();
const jwt = require('jsonwebtoken');

async function getValidToken() {
    await mongoose.connect(process.env.MONGODB_URI);
    const user = await User.findOne({});
    if (!user) {
        console.log("No users found in DB.");
        process.exit(1);
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log("Valid Token:", token);
    process.exit(0);
}

getValidToken();
