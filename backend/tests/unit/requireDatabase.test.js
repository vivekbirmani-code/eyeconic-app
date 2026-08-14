const { waitForDatabase, connectDatabase } = require('../../utils/database');

jest.mock('../../utils/database', () => ({
  waitForDatabase: jest.fn(),
  connectDatabase: jest.fn(),
}));

const mongoose = require('mongoose');
const requireDatabase = require('../../middleware/requireDatabase');

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('requireDatabase middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      get: () => 1,
    });
  });

  it('calls next when database is connected', async () => {
    const req = { requestId: 'req-1', path: '/login', method: 'POST' };
    const res = createMockRes();
    const next = jest.fn();

    await requireDatabase(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('waits for database during connecting state', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      get: () => 2,
    });
    waitForDatabase.mockResolvedValue(true);

    const req = { requestId: 'req-2', path: '/login', method: 'POST' };
    const res = createMockRes();
    const next = jest.fn();

    await requireDatabase(req, res, next);

    expect(waitForDatabase).toHaveBeenCalledWith(8000);
    expect(next).toHaveBeenCalled();
  });

  it('returns 503 with DATABASE_UNAVAILABLE when wait times out', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      get: () => 2,
    });
    waitForDatabase.mockResolvedValue(false);

    const req = { requestId: 'req-3', path: '/login', method: 'POST' };
    const res = createMockRes();
    const next = jest.fn();

    await requireDatabase(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DATABASE_UNAVAILABLE' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
