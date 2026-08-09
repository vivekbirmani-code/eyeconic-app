const { randomUUID } = require('crypto');

/**
 * Assigns a unique request ID for correlation across logs and responses.
 */
const requestId = (req, res, next) => {
  const incomingId = req.header('X-Request-Id');
  const id = incomingId || randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

module.exports = requestId;
