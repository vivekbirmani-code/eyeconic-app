const mongoose = require('mongoose');
const logger = require('./logger');
const { getMongoUri } = require('./mongoUri');

let connectPromise = null;

const MONGOOSE_OPTIONS = {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 1,
  retryWrites: true,
  heartbeatFrequencyMS: 10000,
  // Prefer IPv4 — reduces intermittent querySrv ETIMEOUT on some Windows networks.
  family: 4,
};

const isConnected = () => mongoose.connection.readyState === 1;

const isConnecting = () => mongoose.connection.readyState === 2;

/**
 * Establishes the initial MongoDB connection. Mongoose handles automatic
 * reconnection after the first successful connect — do not call connect()
 * again from disconnected handlers.
 */
const connectDatabase = async (onConnected) => {
  if (isConnected()) {
    return mongoose.connection;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = mongoose
    .connect(getMongoUri(), MONGOOSE_OPTIONS)
    .then((connection) => {
      logger.info('Connected to MongoDB');
      if (typeof onConnected === 'function') {
        onConnected();
      }
      return connection;
    })
    .catch((err) => {
      logger.error('MongoDB connection error', { errorMessage: err.message });
      connectPromise = null;
      throw err;
    });

  return connectPromise;
};

/**
 * Waits until the database is connected or the timeout elapses.
 * Used by requireDatabase during transient reconnects.
 */
const waitForDatabase = (timeoutMs = 8000) =>
  new Promise((resolve) => {
    if (isConnected()) {
      resolve(true);
      return;
    }

    if (!isConnecting() && mongoose.connection.readyState === 0) {
      connectDatabase().catch(() => {
        // connectDatabase logs failures; wait for timeout below.
      });
    }

    const timeout = setTimeout(() => {
      mongoose.connection.removeListener('connected', onConnected);
      resolve(false);
    }, timeoutMs);

    const onConnected = () => {
      clearTimeout(timeout);
      resolve(true);
    };

    mongoose.connection.once('connected', onConnected);
  });

const registerDatabaseEventHandlers = () => {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected — mongoose will attempt automatic reconnection');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { errorMessage: err.message });
  });
};

module.exports = {
  connectDatabase,
  waitForDatabase,
  registerDatabaseEventHandlers,
  isConnected,
  isConnecting,
};
