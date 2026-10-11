/**
 * Socket helpers — shared module to avoid circular dependencies.
 * server.js calls setIo() once after Socket.IO is initialized.
 * Routes import emitToUser / emitToAdmins from here.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

let _io = null;
// userId (string) → Set<socketId>
const userSocketMap = new Map();

/** Called once from server.js after io is created */
function setIo(io) {
    _io = io;
}

/**
 * Verify the user JWT a socket client presents (handshake `auth.token` or the
 * second argument of `register_user`). Socket registration maps a connection
 * to a userId so emitToUser() can deliver targeted events (scores, alerts,
 * calls) — that mapping is identity, so it must be proven, never claimed.
 *
 * Same rules as middleware/auth.js: only real user tokens ({userId, role},
 * no `kind` claim) qualify. Guest and proctoring-precheck tokens are scoped
 * credentials and must never register a socket.
 *
 * @returns {{ok: true, userId: string} | {ok: false}}
 */
function verifySocketToken(token) {
    if (typeof token !== 'string' || !token.trim()) return { ok: false };
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.kind) return { ok: false };
        const userId = decoded.userId && decoded.userId.toString();
        if (!userId) return { ok: false };
        return { ok: true, userId };
    } catch {
        return { ok: false };
    }
}

/** Register a socket for a user (called on 'register_user' event) */
function registerSocket(socketId, userId) {
    const uid = userId.toString();
    if (!userSocketMap.has(uid)) {
        userSocketMap.set(uid, new Set());
    }
    userSocketMap.get(uid).add(socketId);
}

/** Unregister a socket (called on 'disconnect') */
function unregisterSocket(socketId, userId) {
    if (!userId) return;
    const uid = userId.toString();
    const sids = userSocketMap.get(uid);
    if (sids) {
        sids.delete(socketId);
        if (sids.size === 0) userSocketMap.delete(uid);
    }
}

/** Emit an event to all sockets belonging to a specific user */
function emitToUser(userId, event, data) {
    if (!_io) return;
    const uid = userId.toString();
    const socketIds = userSocketMap.get(uid);
    if (socketIds) {
        socketIds.forEach(sid => {
            const s = _io.sockets.sockets.get(sid);
            if (s) s.emit(event, data);
        });
    }
}

/** Emit an event to all currently connected admins */
async function emitToAdmins(event, data) {
    if (!_io) return;
    try {
        const adminUsers = await User.find({ role: 'admin' }).select('_id');
        adminUsers.forEach(admin => emitToUser(admin._id, event, data));
    } catch (err) {
        console.error('emitToAdmins error:', err);
    }
}

/**
 * Nudge every admin/mentor currently watching this test's leaderboard room
 * (`leaderboard:<quizId>` — join_leaderboard in server.js) that a submission
 * landed. Works from ANY finalization context: a request-scoped caller passes
 * its req (io resolved via app.get('io'), the indirection tests use), and
 * background paths (attempt sweep, request-less lazy expiry) fall back to the
 * io instance server.js registered through setIo. The payload stays a nudge —
 * viewers refetch the ranked endpoint, so ranking always comes from the
 * rankStudentAttempts source of truth.
 *
 * @returns {boolean} true when an io instance existed and the emit went out
 */
function emitQuizLeaderboardUpdated(quizId, payload, { req = null } = {}) {
    const reqIo = req && req.app && typeof req.app.get === 'function' ? req.app.get('io') : null;
    const io = reqIo || _io;
    if (!io || !quizId) return false;
    io.to(`leaderboard:${quizId}`).emit('quiz_leaderboard_updated', {
        quizId: quizId.toString(),
        ...payload,
    });
    return true;
}

module.exports = {
    setIo,
    verifySocketToken,
    registerSocket,
    unregisterSocket,
    emitToUser,
    emitToAdmins,
    emitQuizLeaderboardUpdated,
};
