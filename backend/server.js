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
const Call = require('./models/Call');

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
app.use(express.json());

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

// Track socket to user mapping
const socketUserMap = new Map();

// Socket.IO for real-time chat and calls
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user with socket
  socket.on('register_user', (userId) => {
    socketUserMap.set(socket.id, userId);
    socket.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);
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

      // Notify group about incoming call
      socket.to(groupId).emit('incoming_call', {
        callId: call._id,
        groupId,
        groupName,
        initiatorId,
        initiatorName,
        targetUserIds
      });

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
          groupId: call.groupId.toString()
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
    const { callId } = data;

    try {
      const call = await Call.findById(callId);
      if (call && call.status === 'active') {
        call.status = 'ended';
        call.endTime = new Date();
        call.participants.forEach(p => {
          if (!p.leftAt) p.leftAt = new Date();
        });
        await call.save();

        socket.to(call.groupId.toString()).emit('call_ended', { callId });
        socket.emit('call_ended', { callId });

        console.log(`Call ${callId} ended`);
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