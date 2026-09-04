const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const logger = require('./utils/logger');
const { createCorsOptions, createSocketCorsOptions } = require('./config/cors');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');

// Import socket helpers BEFORE routes to avoid circular deps
const socketHelpers = require('./utils/socket-helpers');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const groupRoutes = require('./routes/groups');
const messageRoutes = require('./routes/messages');
const quizRoutes = require('./routes/quizzes');
const questionBankRoutes = require('./routes/question-bank');
const subjectRoutes = require('./routes/subjects');
const studentSubjectRoutes = require('./routes/student-subjects');
const mentorStudentRoutes = require('./routes/mentor-students');
const assignmentRoutes = require('./routes/assignments');
const adminOverviewRoutes = require('./routes/admin-overview');
const settingsRoutes = require('./routes/settings');
const uploadRoutes = require('./routes/upload');
const publicQuizRoutes = require('./routes/public-quiz');
const publicLeadRoutes = require('./routes/public-lead');
const studentAnalyticsRoutes = require('./routes/student-analytics');
const { cleanupExpiredMedia } = require('./utils/media-cleanup');
const Call = require('./models/Call');
const User = require('./models/User');

const { sendPushNotification, sendPushToUser } = require('./utils/notifications');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, createSocketCorsOptions());

// Expose io to routes
app.set('io', io);

// Single reverse proxy (Render/Vercel terminates TLS) — makes req.protocol
// honor X-Forwarded-Proto (share links must be https:// in production) and
// req.ip resolve to the real client for IP rate limiting.
app.set('trust proxy', 1);

// Initialize socket helpers with the io instance
socketHelpers.setIo(io);

// Validate critical environment variables at startup
const validateEnvironment = () => {
  const warnings = [];
  if (!process.env.JWT_SECRET) {
    warnings.push('JWT_SECRET is not set — authentication will fail');
  }
  if (!process.env.MONGODB_URI) {
    warnings.push('MONGODB_URI is not set — database connection will fail');
  }
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
  const hasSmtp = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
  if (!hasResend && !hasSmtp && process.env.NODE_ENV === 'production') {
    warnings.push(
      'RESEND_API_KEY or SMTP credentials are not set — OTP emails will fail in production'
    );
  }
  if (process.env.NODE_ENV === 'production') {
    const { getSmsStatus } = require('./utils/sms');
    const smsStatus = getSmsStatus();
    if (smsStatus.status !== 'configured') {
      warnings.push(
        'TWO_FACTOR_API_KEY is not set — public quiz phone OTP will fail in production (503 SMS_NOT_CONFIGURED). See docs/2FACTOR_SETUP.md'
      );
    }
  }
  warnings.forEach((warning) => logger.warn(warning));
};

validateEnvironment();

// Public quiz links always open the web app now (never an app redirect) —
// log where they resolve so misconfiguration is visible at a glance.
const { getPublicWebAppUrl } = require('./utils/publicWebUrl');
logger.info('Public quiz web app URL', { url: getPublicWebAppUrl() });
if (process.env.NODE_ENV === 'production' && !process.env.WEB_APP_URL?.trim()) {
  logger.warn(
    'WEB_APP_URL is not set — public quiz links fall back to the legacy web origin. Set it to the eyeconic-public-web static site URL (Render dashboard → eyeconic-app-prod → Environment).'
  );
}

// Middleware — CORS must run before auth/body parsing so preflight succeeds.
app.use(cors(createCorsOptions()));
app.use(requestId);
// Increase body size limit for large Excel file uploads (base64 encoded)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Return a clean 400 for malformed JSON instead of an unhandled parser error
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn('Malformed JSON request body', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid request data.',
      code: 'INVALID_JSON',
      requestId: req.requestId,
    });
  }
  return next(err);
});

// Structured request logging (never log bodies — may contain credentials)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });
  next();
});

// MongoDB connection — mongoose auto-reconnects after the first connect()
const {
  connectDatabase,
  registerDatabaseEventHandlers,
} = require('./utils/database');

registerDatabaseEventHandlers();

const startDatabase = async () => {
  try {
    await connectDatabase(() => {
      cleanupExpiredMedia();
      setInterval(cleanupExpiredMedia, 24 * 60 * 60 * 1000);
    });
  } catch {
    // Retry initial connection only — ongoing reconnects are handled by mongoose.
    setTimeout(startDatabase, 5000);
  }
};

startDatabase();

const { getCloudinaryHealthStatus } = require('./utils/cloudinary');
const cloudinaryHealth = getCloudinaryHealthStatus();
if (!cloudinaryHealth.configured) {
  logger.warn('Cloudinary is not configured — media and profile picture uploads will fail until CLOUDINARY_* env vars or CLOUDINARY_UPLOAD_PRESET are set.', {
    missingVars: cloudinaryHealth.missingVars,
  });
} else if (cloudinaryHealth.mode === 'unsigned_preset') {
  logger.info('Cloudinary unsigned upload preset enabled for media uploads.', {
    cloudName: cloudinaryHealth.cloudName,
    uploadPreset: cloudinaryHealth.uploadPreset,
    canDeleteAssets: cloudinaryHealth.canDeleteAssets,
  });
}

// Health endpoints (no auth required — used by load balancers and monitoring)
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);

// Root endpoint — service identity for uptime checks and human verification
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'eyeconic-api',
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/student-subjects', studentSubjectRoutes);
app.use('/api/mentor-students', mentorStudentRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/admin-overview', adminOverviewRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/public', publicQuizRoutes);
app.use('/api/public', publicLeadRoutes);
app.use('/api/student-analytics', studentAnalyticsRoutes);

// Track socket to user mapping (socket.id -> userId)
const socketUserMap = new Map();
const Group = require('./models/Group');
const Message = require('./models/Message');

const formatCallDurationLabel = (seconds = 0) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins} min ${secs} sec`;
};

const getCallDurationSeconds = (startTime, endTime) => {
  if (!startTime || !endTime) return 0;
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  return Math.max(0, Math.floor(durationMs / 1000));
};

const emitCallEventMessage = async ({
  groupId,
  senderId,
  senderName,
  messageType,
  content,
  callId,
  callDurationSeconds = 0
}) => {
  if (!groupId || !senderId) return;
  try {
    const callMessage = new Message({
      group: groupId,
      sender: senderId,
      content,
      messageType,
      callId,
      callDurationSeconds
    });
    await callMessage.save();

    const payload = {
      _id: callMessage._id,
      group: callMessage.group,
      sender: { _id: senderId, name: senderName || 'Unknown' },
      content: callMessage.content,
      messageType,
      callId,
      callDurationSeconds,
      createdAt: callMessage.createdAt
    };

    io.to(groupId.toString()).emit('receive_message', payload);
  } catch (error) {
    console.error('Error saving call message:', error);
  }
};

const emitCallMessageUpdate = (groupId, message) => {
  if (!groupId || !message) return;

  const sender =
    message.sender && message.sender._id
      ? { _id: message.sender._id, name: message.sender.name || 'Unknown' }
      : message.sender;

  io.to(groupId.toString()).emit('message_updated', {
    _id: message._id,
    group: message.group,
    sender,
    content: message.content,
    messageType: message.messageType,
    callId: message.callId,
    callDurationSeconds: message.callDurationSeconds,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  });
};

const finalizeCallEventMessage = async ({
  groupId,
  callId,
  finalMessageType,
  content,
  callDurationSeconds = 0,
  fallbackSenderId,
  fallbackSenderName
}) => {
  if (!groupId || !callId || !finalMessageType) return;

  try {
    // Robust ID conversion to ensure query works with both string and ObjectId types
    const queryGroupId = new mongoose.Types.ObjectId(groupId.toString());
    const queryCallId = new mongoose.Types.ObjectId(callId.toString());

    const callStartMessage = await Message.findOne({
      group: queryGroupId,
      callId: queryCallId,
      messageType: 'call_start'
    })
      .sort({ createdAt: -1 })
      .populate('sender', 'name profilePicture');

    if (callStartMessage) {
      callStartMessage.messageType = finalMessageType;
      callStartMessage.content = content;
      callStartMessage.callDurationSeconds = callDurationSeconds;
      await callStartMessage.save();
      emitCallMessageUpdate(groupId, callStartMessage);
      return;
    }

    await emitCallEventMessage({
      groupId,
      senderId: fallbackSenderId,
      senderName: fallbackSenderName,
      messageType: finalMessageType,
      content,
      callId,
      callDurationSeconds
    });
  } catch (error) {
    console.error('Error finalizing call message:', error);
  }
};

// Socket.IO for real-time chat and calls
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user with socket and auto-join all their group rooms
  socket.on('register_user', async (userId) => {
    if (!userId) {
      console.warn('register_user called with null or undefined userId. Ignoring.');
      return;
    }

    const userIdStr = userId.toString();
    socketUserMap.set(socket.id, userIdStr);
    socket.userId = userIdStr;
    console.log(`User ${userIdStr} registered with socket ${socket.id}`);

    // Register in reverse map (via socket-helpers)
    socketHelpers.registerSocket(socket.id, userIdStr);

    // Auto-join all groups user belongs to (for receiving calls globally)
    try {
      const groups = await Group.find({ members: userIdStr }).select('_id');
      groups.forEach(group => {
        socket.join(group._id.toString());
        console.log(`User ${userIdStr} auto-joined group room: ${group._id}`);
      });
      console.log(`User ${userIdStr} joined ${groups.length} group rooms`);
    } catch (error) {
      console.error('Error auto-joining groups:', error);
    }
  });

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('leave_room', (roomId) => {
    socket.leave(roomId);
    console.log(`User ${socket.id} left room ${roomId}`);
  });

  socket.on('send_message', (data) => {
    socket.to(data.groupId).emit('receive_message', data);
  });

  socket.on('message_updated', (data) => {
    socket.to(data.groupId).emit('message_updated', data);
  });

  socket.on('message_deleted', (data) => {
    socket.to(data.groupId).emit('message_deleted', data);
  });

  // ============ CALL SIGNALING EVENTS ============

  // Initiate a call
  socket.on('call_initiate', async (data) => {
    const { groupId, groupName, initiatorId, initiatorName, targetUserIds } = data;

    try {
      // Validate initiator role
      const initiator = await User.findById(initiatorId);
      if (!initiator || initiator.role === 'student') {
        console.warn(`User ${initiatorId} attempted to initiate a call but is a student or not found.`);
        socket.emit('call_error', { message: 'Students are not allowed to initiate calls.' });
        return;
      }

      // Create call record
      const call = new Call({
        groupId,
        initiator: initiatorId,
        participants: [{ userId: initiatorId, userName: initiatorName, joinedAt: new Date() }],
        targetUserIds: targetUserIds || []
      });
      await call.save();

      // Notify ONLY targeted users about the incoming call (not the whole group room)
      const callPayload = {
        callId: call._id,
        groupId,
        groupName,
        initiatorId,
        initiatorName,
        targetUserIds
      };

      if (targetUserIds && targetUserIds.length > 0) {
        // Emit only to each selected target user's socket(s)
        for (const targetId of targetUserIds) {
          if (targetId.toString() !== initiatorId.toString()) {
            socketHelpers.emitToUser(targetId, 'incoming_call', callPayload);
          }
        }
      } else {
        // Fallback: no targets specified -> ring the whole group (original behavior for "call all")
        socket.to(groupId).emit('incoming_call', callPayload);
      }


      await emitCallEventMessage({
        groupId,
        senderId: initiatorId,
        senderName: initiatorName,
        messageType: 'call_start',
        content: `${initiatorName} started a call`,
        callId: call._id,
        callDurationSeconds: 0
      });

      // Send push notifications to all target users (for when app is closed)
      if (targetUserIds && targetUserIds.length > 0) {
        const users = await User.find({
          _id: { $in: targetUserIds, $ne: initiatorId },
          $or: [{ pushToken: { $ne: null } }, { fcmToken: { $ne: null } }]
        }).select('pushToken fcmToken');

        for (const user of users) {
          sendPushToUser({
            expoPushToken: user.pushToken,
            fcmToken: user.fcmToken,
            title: 'Incoming Call',
            body: `${initiatorName} is calling...`,
            data: {
              type: 'incoming_call',
              callId: call._id.toString(),
              groupId,
              groupName,
              initiatorId,
              initiatorName,
              callerName: initiatorName,
            },
          });
        }
      }

      // Send call ID back to initiator
      socket.emit('call_initiated', { callId: call._id });

      console.log(`Call ${call._id} initiated in group ${groupId}`);
    } catch (error) {
      console.error('Error initiating call:', error);
      socket.emit('call_error', { message: 'Failed to initiate call' });
    }
  });

  // Send WebRTC offer
  socket.on('call_offer', (data) => {
    const { callId, groupId, targetUserId, offer, fromUserId } = data;
    socket.to(groupId).emit('call_offer', {
      callId,
      offer,
      fromUserId
    });
  });

  // Send WebRTC answer
  socket.on('call_answer', (data) => {
    const { callId, groupId, answer, fromUserId, toUserId } = data;
    socket.to(groupId).emit('call_answer', {
      callId,
      answer,
      fromUserId
    });
  });

  // Send ICE candidate
  socket.on('call_ice_candidate', (data) => {
    const { callId, groupId, candidate, fromUserId } = data;
    socket.to(groupId).emit('call_ice_candidate', {
      callId,
      candidate,
      fromUserId
    });
  });

  // Join an active call
  socket.on('call_join', async (data) => {
    const { callId, userId, userName } = data;

    try {
      const call = await Call.findById(callId);
      if (call && call.status === 'active') {
        // Add participant if not already in
        const existingParticipant = call.participants.find(
          p => p.userId.toString() === userId && !p.leftAt
        );

        if (!existingParticipant) {
          call.participants.push({ userId, userName, joinedAt: new Date() });
          await call.save();
        }

        // Join the socket room for this group
        socket.join(call.groupId.toString());

        // Notify others in the call
        socket.to(call.groupId.toString()).emit('call_user_joined', {
          callId,
          userId,
          userName
        });

        // Send current participants list back to joiner
        const activeParticipants = call.participants
          .filter(p => !p.leftAt)
          .map(p => ({
            userId: p.userId.toString(),
            userName: p.userName || 'Unknown',
            isMuted: p.isMuted || false
          }));

        socket.emit('call_joined', {
          callId,
          participants: activeParticipants,
          groupId: call.groupId.toString(),
          startTime: call.startTime
        });

        console.log(`User ${userName} joined call ${callId}`);
      }
    } catch (error) {
      console.error('Error joining call:', error);
    }
  });

  // Leave a call
  socket.on('call_leave', async (data) => {
    const { callId, userId } = data;

    try {
      const call = await Call.findById(callId);
      if (call) {
        // Mark participant as left
        const participant = call.participants.find(
          p => p.userId.toString() === userId && !p.leftAt
        );
        if (participant) {
          participant.leftAt = new Date();
          await call.save();
        }

        // Notify others
        socket.to(call.groupId.toString()).emit('call_user_left', {
          callId,
          userId
        });

        // Check if call is empty
        const wasActiveCall = call.status === 'active';
        const activeParticipants = call.participants.filter(p => !p.leftAt);
        if (wasActiveCall && activeParticipants.length === 0) {
          call.status = 'ended';
          call.endTime = new Date();
          await call.save();

          const durationSeconds = getCallDurationSeconds(call.startTime, call.endTime);
          const durationStr = formatCallDurationLabel(durationSeconds);
          const hasOtherParticipants = call.participants.some(
            p => p.userId.toString() !== call.initiator.toString()
          );

          if (hasOtherParticipants) {
            const leaver = await User.findById(userId);
            const leaverName = leaver?.name || 'Unknown';
            await finalizeCallEventMessage({
              groupId: call.groupId,
              callId,
              finalMessageType: 'call_end',
              content: `Call ended - Duration: ${durationStr}`,
              callDurationSeconds: durationSeconds,
              fallbackSenderId: leaver?._id || userId,
              fallbackSenderName: leaverName
            });
          } else {
            const initiatorUser = await User.findById(call.initiator);
            const initiatorName = initiatorUser?.name || 'Unknown';
            await finalizeCallEventMessage({
              groupId: call.groupId,
              callId,
              finalMessageType: 'call_missed',
              content: `${initiatorName} missed a call`,
              callDurationSeconds: durationSeconds,
              fallbackSenderId: call.initiator,
              fallbackSenderName: initiatorName
            });
          }
          socket.to(call.groupId.toString()).emit('call_ended', { callId });
        }
      }
    } catch (error) {
      console.error('Error leaving call:', error);
    }
  });

  // Toggle mute
  socket.on('call_mute', async (data) => {
    const { callId, userId, isMuted } = data;

    try {
      const call = await Call.findById(callId);
      if (call) {
        const participant = call.participants.find(
          p => p.userId.toString() === userId && !p.leftAt
        );
        if (participant) {
          participant.isMuted = isMuted;
          await call.save();
        }

        socket.to(call.groupId.toString()).emit('call_user_muted', {
          callId,
          userId,
          isMuted
        });
      }
    } catch (error) {
      console.error('Error toggling mute:', error);
    }
  });

  // End call for everyone
  socket.on('call_end', async (data) => {
    const { callId, endedBy, endedByName } = data;

    try {
      const call = await Call.findById(callId);
      if (call && call.status === 'active') {
        call.status = 'ended';
        call.endTime = new Date();
        call.participants.forEach(p => {
          if (!p.leftAt) p.leftAt = new Date();
        });
        await call.save();

        const durationSeconds = getCallDurationSeconds(call.startTime, call.endTime);
        const durationStr = formatCallDurationLabel(durationSeconds);

        const hasOtherParticipants = call.participants.some(
          p => p.userId.toString() !== call.initiator.toString()
        );

        if (hasOtherParticipants) {
          await finalizeCallEventMessage({
            groupId: call.groupId,
            callId: call._id,
            finalMessageType: 'call_end',
            content: `Call ended - Duration: ${durationStr}`,
            callDurationSeconds: durationSeconds,
            fallbackSenderId: endedBy || call.initiator,
            fallbackSenderName: endedByName || 'Unknown'
          });
        } else {
          const initiatorUser = await User.findById(call.initiator);
          const initiatorName = initiatorUser?.name || endedByName || 'Unknown';
          await finalizeCallEventMessage({
            groupId: call.groupId,
            callId: call._id,
            finalMessageType: 'call_missed',
            content: `${initiatorName} missed a call`,
            callDurationSeconds: durationSeconds,
            fallbackSenderId: call.initiator,
            fallbackSenderName: initiatorName
          });
        }

        socket.to(call.groupId.toString()).emit('call_ended', { callId });
        socket.emit('call_ended', { callId });

        console.log(`Call ${callId} ended, duration: ${durationStr}`);
      }
    } catch (error) {
      console.error('Error ending call:', error);
    }
  });

  // Decline an incoming call
  socket.on('call_decline', async (data) => {
    const { callId, userId, groupId } = data;
    console.log(`User ${userId} declined call ${callId}`);

    try {
      // Notify the initiator or the group that the user declined
      if (groupId) {
        socket.to(groupId.toString()).emit('call_declined', {
          callId,
          userId
        });
      }

      // If it's a 1-on-1 call, we should finalize the message as 'call_declined'
      const call = await Call.findById(callId);
      if (call && call.status === 'active' && call.targetUserIds && call.targetUserIds.length === 1) {
        // End the call record
        call.status = 'ended';
        call.endTime = new Date();
        await call.save();

        // Finalize the chat message
        const decliner = await User.findById(userId);
        const declinerName = decliner?.name || 'User';
        
        await finalizeCallEventMessage({
          groupId: call.groupId,
          callId: call._id,
          finalMessageType: 'call_declined',
          content: `${declinerName} declined the call`,
          callDurationSeconds: 0,
          fallbackSenderId: userId,
          fallbackSenderName: declinerName
        });

        // Notify everyone to clear their UI
        io.to(call.groupId.toString()).emit('call_ended', { callId: call._id });
        console.log(`Call ${callId} ended due to decline in 1-on-1`);
      }
    } catch (error) {
      console.error('Error declining call:', error);
    }
  });

  // Get active call for a group
  socket.on('get_active_call', async (data) => {
    const { groupId } = data;

    try {
      const call = await Call.findOne({
        groupId,
        status: 'active'
      }).populate('participants.userId', 'name');

      socket.emit('active_call', { call });
    } catch (error) {
      console.error('Error getting active call:', error);
    }
  });

  socket.on('disconnect', async () => {
    const userId = socketUserMap.get(socket.id);
    socketUserMap.delete(socket.id);
    socketHelpers.unregisterSocket(socket.id, userId);
    console.log('User disconnected:', socket.id);

    // If user was in an active call, handle their departure
    if (userId) {
      try {
        // Find all active calls where this user is a participant
        const activeCalls = await Call.find({
          'participants.userId': userId,
          status: 'active'
        });

        for (const call of activeCalls) {
          // Effectively trigger the 'call_leave' logic for each active call
          const participant = call.participants.find(
            p => p.userId.toString() === userId && !p.leftAt
          );

          if (participant) {
            participant.leftAt = new Date();
            await call.save();

            // Notify others in the group
            socket.to(call.groupId.toString()).emit('call_user_left', {
              callId: call._id,
              userId
            });

            // If this was the last active participant, end the call
            const activeParticipants = call.participants.filter(p => !p.leftAt);
            if (activeParticipants.length === 0) {
              call.status = 'ended';
              call.endTime = new Date();
              await call.save();

              const durationSeconds = getCallDurationSeconds(call.startTime, call.endTime);
              const durationStr = formatCallDurationLabel(durationSeconds);

              // Update the call message in chat
              const hasOtherParticipants = call.participants.some(
                p => p.userId.toString() !== call.initiator.toString()
              );

              if (hasOtherParticipants) {
                await finalizeCallEventMessage({
                  groupId: call.groupId,
                  callId: call._id,
                  finalMessageType: 'call_end',
                  content: `Call ended - Duration: ${durationStr}`,
                  callDurationSeconds: durationSeconds,
                  fallbackSenderId: userId,
                  fallbackSenderName: participant.userName || 'Unknown'
                });
              } else {
                const initiatorUser = await User.findById(call.initiator);
                await finalizeCallEventMessage({
                  groupId: call.groupId,
                  callId: call._id,
                  finalMessageType: 'call_missed',
                  content: `${initiatorUser?.name || 'User'} missed a call`,
                  callDurationSeconds: durationSeconds,
                  fallbackSenderId: call.initiator,
                  fallbackSenderName: initiatorUser?.name || 'Unknown'
                });
              }
              socket.to(call.groupId.toString()).emit('call_ended', { callId: call._id });
            }
          }
        }
      } catch (error) {
        console.error('Error handling call cleanup on disconnect:', error);
      }
    }
  });
});

const notFoundResponse = (req, res) => {
  res.status(404).json({
    message: 'The requested resource was not found.',
    code: 'NOT_FOUND',
    requestId: req.requestId,
  });
};

// 404 handler for unknown API routes
app.use('/api', notFoundResponse);

// 404 handler for all other unknown routes (avoids Express HTML "Cannot GET /path")
app.use(notFoundResponse);

// Global error handler — must be last
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    logger.info('Server started', { port: PORT, nodeEnv: process.env.NODE_ENV || 'development' });
  });
}

module.exports = { app, server };

