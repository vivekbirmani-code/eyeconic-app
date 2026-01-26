const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

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
const uploadRoutes = require('./routes/upload');
const Call = require('./models/Call');
const User = require('./models/User');

// Send push notification using Expo's push service
async function sendPushNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) return;

  const message = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'calls',
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    const result = await response.json();
    console.log('Push notification sent:', result);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
// Increase body size limit for large Excel file uploads (base64 encoded)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://REDACTED:REDACTED@cluster0.g7l8wx5.mongodb.net/?appName=Cluster0')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

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
app.use('/api/upload', uploadRoutes);

// Track socket to user mapping
const socketUserMap = new Map();
const Group = require('./models/Group');
const Message = require('./models/Message');

// Socket.IO for real-time chat and calls
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user with socket and auto-join all their group rooms
  socket.on('register_user', async (userId) => {
    socketUserMap.set(socket.id, userId);
    socket.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);

    // Auto-join all groups user belongs to (for receiving calls globally)
    try {
      const groups = await Group.find({ members: userId }).select('_id');
      groups.forEach(group => {
        socket.join(group._id.toString());
        console.log(`User ${userId} auto-joined group room: ${group._id}`);
      });
      console.log(`User ${userId} joined ${groups.length} group rooms`);
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
      // Create call record
      const call = new Call({
        groupId,
        initiator: initiatorId,
        participants: [{ userId: initiatorId, userName: initiatorName, joinedAt: new Date() }]
      });
      await call.save();

      // Notify group about incoming call via socket
      socket.to(groupId).emit('incoming_call', {
        callId: call._id,
        groupId,
        groupName,
        initiatorId,
        initiatorName,
        targetUserIds
      });

      // Save call started message to chat history
      try {
        const callMessage = new Message({
          group: groupId,
          sender: initiatorId,
          content: `📞 ${initiatorName} started a call`,
          messageType: 'call_start',
          callId: call._id
        });
        await callMessage.save();

        // Emit the call message to the group
        io.to(groupId).emit('receive_message', {
          _id: callMessage._id,
          group: groupId,
          sender: { _id: initiatorId, name: initiatorName },
          content: callMessage.content,
          messageType: 'call_start',
          callId: call._id,
          createdAt: callMessage.createdAt
        });
      } catch (msgError) {
        console.error('Error saving call message:', msgError);
      }

      // Send push notifications to all target users (for when app is closed)
      if (targetUserIds && targetUserIds.length > 0) {
        const users = await User.find({
          _id: { $in: targetUserIds },
          pushToken: { $ne: null }
        });

        for (const user of users) {
          if (user.pushToken && user._id.toString() !== initiatorId) {
            sendPushNotification(
              user.pushToken,
              'Incoming Call',
              `${initiatorName} is calling...`,
              {
                type: 'incoming_call',
                callId: call._id.toString(),
                groupId,
                groupName,
                initiatorId,
                initiatorName
              }
            );
          }
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
        const activeParticipants = call.participants.filter(p => !p.leftAt);
        if (activeParticipants.length === 0) {
          call.status = 'ended';
          call.endTime = new Date();
          await call.save();

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

        // Calculate call duration
        const durationMs = call.endTime - call.startTime;
        const durationSec = Math.floor(durationMs / 1000);
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        const durationStr = minutes > 0
          ? `${minutes}m ${seconds}s`
          : `${seconds}s`;

        // Save call ended message
        try {
          const callEndMessage = new Message({
            group: call.groupId,
            sender: endedBy || call.initiator,
            content: `📞 Call ended • Duration: ${durationStr}`,
            messageType: 'call_end',
            callId: call._id
          });
          await callEndMessage.save();

          io.to(call.groupId.toString()).emit('receive_message', {
            _id: callEndMessage._id,
            group: call.groupId,
            sender: { _id: endedBy || call.initiator, name: endedByName || 'Unknown' },
            content: callEndMessage.content,
            messageType: 'call_end',
            callId: call._id,
            createdAt: callEndMessage.createdAt
          });
        } catch (msgError) {
          console.error('Error saving call end message:', msgError);
        }

        socket.to(call.groupId.toString()).emit('call_ended', { callId });
        socket.emit('call_ended', { callId });

        console.log(`Call ${callId} ended, duration: ${durationStr}`);
      }
    } catch (error) {
      console.error('Error ending call:', error);
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

  socket.on('disconnect', () => {
    socketUserMap.delete(socket.id);
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});