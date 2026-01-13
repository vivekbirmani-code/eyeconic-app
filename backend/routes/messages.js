const express = require('express');
const Message = require('../models/Message');
const MessageReadStatus = require('../models/MessageReadStatus');
const Group = require('../models/Group');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get messages for a group
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && !group.members.includes(req.user._id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const messages = await Message.find({
      group: req.params.groupId,
      deletedFor: { $ne: req.user._id } // Don't show messages deleted for this user
    })
      .populate('sender', 'name')
      .sort({ createdAt: 1 });

    // Transform messages for response
    const transformedMessages = messages.map(msg => {
      const msgObj = msg.toObject();

      // If deleted for everyone, replace content
      if (msgObj.deletedForEveryone) {
        msgObj.content = '';
      }

      return msgObj;
    });

    res.json(transformedMessages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send message
router.post('/', auth, async (req, res) => {
  try {
    const { content, groupId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && !group.members.includes(req.user._id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const message = new Message({
      content,
      sender: req.user._id,
      group: groupId,
      status: 'sent'
    });

    await message.save();
    await message.populate('sender', 'name');

    res.status(201).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Edit message
router.put('/:id', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Only sender can edit
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only sender can edit message' });
    }

    // Can't edit deleted messages
    if (message.deletedForEveryone) {
      return res.status(400).json({ message: 'Cannot edit deleted message' });
    }

    message.content = content;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();
    await message.populate('sender', 'name');

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark message as read
router.post('/:id/read', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Don't mark own messages as read
    if (message.sender.toString() === req.user._id.toString()) {
      return res.json({ message: 'Own message' });
    }

    // Upsert read status
    await MessageReadStatus.findOneAndUpdate(
      { messageId: req.params.id, userId: req.user._id },
      { readAt: new Date() },
      { upsert: true, new: true }
    );

    // Check if all group members have read the message
    const group = await Group.findById(message.group);
    const totalMembers = group.members.length - 1; // Exclude sender
    const readCount = await MessageReadStatus.countDocuments({ messageId: req.params.id });

    if (readCount >= totalMembers) {
      message.status = 'read';
      await message.save();
    } else if (message.status === 'sent') {
      message.status = 'delivered';
      await message.save();
    }

    res.json({ message: 'Marked as read', status: message.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark multiple messages as read (batch)
router.post('/read-batch', auth, async (req, res) => {
  try {
    const { messageIds } = req.body;

    if (!messageIds || messageIds.length === 0) {
      return res.status(400).json({ message: 'No message IDs provided' });
    }

    // Create read status entries for all messages
    const readStatusOps = messageIds.map(messageId => ({
      updateOne: {
        filter: { messageId, userId: req.user._id },
        update: { readAt: new Date() },
        upsert: true
      }
    }));

    await MessageReadStatus.bulkWrite(readStatusOps);

    // Update message statuses
    const messages = await Message.find({ _id: { $in: messageIds } });

    for (const message of messages) {
      if (message.sender.toString() === req.user._id.toString()) continue;

      const group = await Group.findById(message.group);
      const totalMembers = group.members.length - 1;
      const readCount = await MessageReadStatus.countDocuments({ messageId: message._id });

      if (readCount >= totalMembers && message.status !== 'read') {
        message.status = 'read';
        await message.save();
      } else if (message.status === 'sent') {
        message.status = 'delivered';
        await message.save();
      }
    }

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get read status for a message (who read it)
router.get('/:id/read-status', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const readStatuses = await MessageReadStatus.find({ messageId: req.params.id })
      .populate('userId', 'name')
      .sort({ readAt: 1 });

    const readBy = readStatuses.map(rs => ({
      user: rs.userId,
      readAt: rs.readAt
    }));

    res.json({ readBy, messageStatus: message.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete message for me only
router.delete('/:id/me', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Add user to deletedFor array
    if (!message.deletedFor.includes(req.user._id)) {
      message.deletedFor.push(req.user._id);
      await message.save();
    }

    res.json({ message: 'Message deleted for you' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete message for everyone
router.delete('/:id/everyone', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Only sender or admin can delete for everyone
    if (req.user.role !== 'admin' && message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only sender can delete for everyone' });
    }

    message.deletedForEveryone = true;
    // Keep content so admins can still see it
    await message.save();
    await message.populate('sender', 'name');

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Legacy delete (keep for backwards compatibility)
router.delete('/:id', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Only sender or admin can delete
    if (req.user.role !== 'admin' && message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    message.isDeleted = true;
    await message.save();

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;