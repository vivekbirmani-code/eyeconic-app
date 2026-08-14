process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Subject = require('../../models/Subject');
const questionBankRoutes = require('../../routes/question-bank');
const quizRoutes = require('../../routes/quizzes');
const studentAnalyticsRoutes = require('../../routes/student-analytics');
const adminOverviewRoutes = require('../../routes/admin-overview');
const mentorStudentRoutes = require('../../routes/mentor-students');
const userRoutes = require('../../routes/users');

/**
 * Minimal Express app mounting only the routers under test, so integration
 * tests exercise the real route/middleware/model code without needing the
 * full server.js (sockets, cloudinary, firebase, etc.).
 */
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/question-bank', questionBankRoutes);
  app.use('/api/quizzes', quizRoutes);
  app.use('/api/student-analytics', studentAnalyticsRoutes);
  app.use('/api/admin-overview', adminOverviewRoutes);
  app.use('/api/mentor-students', mentorStudentRoutes);
  app.use('/api/users', userRoutes);
  return app;
}

async function createUser({ role = 'student', name = 'Test User', email } = {}) {
  const user = await User.create({
    name,
    email: email || `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'password123',
    role,
  });
  const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

async function createSubject(name = 'Pathology') {
  return Subject.create({ name, year: '1st', displayOrder: 1 });
}

module.exports = { buildApp, createUser, createSubject };
