const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const router = express.Router();

const getDatabaseStatus = () => {
  const state = mongoose.connection.readyState;
  const labels = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    status: state === 1 ? 'healthy' : 'unhealthy',
    state: labels[state] || 'unknown',
    readyState: state,
  };
};

const getAuthStatus = () => {
  const hasJwtSecret = Boolean(process.env.JWT_SECRET);
  return {
    status: hasJwtSecret ? 'healthy' : 'unhealthy',
    jwtConfigured: hasJwtSecret,
  };
};

router.get('/', (req, res) => {
  const database = getDatabaseStatus();
  const auth = getAuthStatus();
  const isHealthy = database.status === 'healthy' && auth.status === 'healthy';

  const payload = {
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'eyeconic-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: req.requestId,
    dependencies: {
      database,
      auth,
    },
  };

  if (!isHealthy) {
    logger.warn('Health check degraded', {
      requestId: req.requestId,
      database: database.state,
      jwtConfigured: auth.jwtConfigured,
    });
  }

  res.status(isHealthy ? 200 : 503).json(payload);
});

router.get('/database', (req, res) => {
  const database = getDatabaseStatus();
  res.status(database.status === 'healthy' ? 200 : 503).json({
    status: database.status,
    ...database,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  });
});

router.get('/auth', (req, res) => {
  const auth = getAuthStatus();

  let jwtValid = false;
  if (auth.jwtConfigured) {
    try {
      const testToken = jwt.sign({ healthCheck: true }, process.env.JWT_SECRET, { expiresIn: '1m' });
      jwt.verify(testToken, process.env.JWT_SECRET);
      jwtValid = true;
    } catch (error) {
      logger.error('JWT health check failed', {
        requestId: req.requestId,
        errorMessage: error.message,
      });
    }
  }

  const status = auth.jwtConfigured && jwtValid ? 'healthy' : 'unhealthy';

  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    jwtConfigured: auth.jwtConfigured,
    jwtOperational: jwtValid,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
