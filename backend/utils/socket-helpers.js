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

module.exports = { setIo, verifySocketToken, registerSocket, unregisterSocket, emitToUser, emitToAdmins };
