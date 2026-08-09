const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { getMongoUri } = require('./utils/mongoUri');

async function getValidToken() {
    await mongoose.connect(getMongoUri());
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
