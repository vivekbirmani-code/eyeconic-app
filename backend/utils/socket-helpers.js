/**
 * Socket helpers — shared module to avoid circular dependencies.
 * server.js calls setIo() once after Socket.IO is initialized.
 * Routes import emitToUser / emitToAdmins from here.
 */

const User = require('../models/User');

let _io = null;
// userId (string) → Set<socketId>
const userSocketMap = new Map();

/** Called once from server.js after io is created */
function setIo(io) {
    _io = io;
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

module.exports = { setIo, registerSocket, unregisterSocket, emitToUser, emitToAdmins };
