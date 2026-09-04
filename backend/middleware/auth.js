const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.query.token;

    if (!token) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Guest session tokens (public-quiz OTP flow) are scoped to guest
    // routes only — reject them here explicitly so they can never reach
    // user-authenticated routes (including the ?token= CSV download path).
    if (decoded.kind === 'guest') {
      return res.status(401).json({ message: 'Access denied. Guest session cannot access this resource.' });
    }

    const user = await User.findById(decoded.userId).select('-password -profilePicturePublicId');

    if (!user) {
      return res.status(401).json({ message: 'Token is not valid.' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid.' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Access denied.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions.' });
    }

    next();
  };
};

module.exports = { auth, authorize };