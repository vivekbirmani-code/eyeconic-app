const express = require('express');
const Group = require('../models/Group');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

const Message = require('../models/Message');
const ReadStatus = require('../models/ReadStatus');

// Get all groups with unread counts
router.get('/', auth, async (req, res) => {
  try {
    let groups;

    if (req.user.role === 'admin') {
      groups = await Group.find()
        .populate('members', 'name email role')
        .populate('createdBy', 'name');
    } else {
      groups = await Group.find({
        members: req.user._id
      })
        .populate('members', 'name email role')
        .populate('createdBy', 'name');
    }

    // Calculate unread counts for each group
    const groupsWithUnread = await Promise.all(groups.map(async (group) => {
      const readStatus = await ReadStatus.findOne({
        userId: req.user._id,
        groupId: group._id
      });

      const unreadCount = await Message.countDocuments({
        group: group._id,
        sender: { $ne: req.user._id }, // Don't count own messages
        createdAt: { $gt: readStatus ? readStatus.lastReadAt : new Date(0) }
      });

      return {
        ...group.toObject(),
        unreadCount
      };
    }));

    res.json(groupsWithUnread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create group (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;

    // Start with admin as member
    const initialMembers = [req.user._id];

    // Add additional members if provided
    if (memberIds && memberIds.length > 0) {
      initialMembers.push(...memberIds);
    }

    const group = new Group({
      name,
      description,
      members: initialMembers,
      createdBy: req.user._id
    });

    await group.save();

    // Update users' groups array
    if (memberIds && memberIds.length > 0) {
      await User.updateMany(
        { _id: { $in: memberIds } },
        { $addToSet: { groups: group._id } }
      );
    }

    await group.populate('members', 'name email role');
    await group.populate('createdBy', 'name');

    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add members to group (Admin only)
router.post('/:id/members', auth, authorize('admin'), async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || userIds.length === 0) {
      return res.status(400).json({ message: 'No user IDs provided' });
    }

    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Get existing member IDs as strings for comparison
    const existingMemberIds = group.members.map(m => m.toString());

    // Filter out already existing members
    const newMembers = userIds.filter(id => !existingMemberIds.includes(id.toString()));

    if (newMembers.length > 0) {
      // Add new members to group
      group.members.push(...newMembers);
      await group.save();

      // Update users' groups array
      await User.updateMany(
        { _id: { $in: newMembers } },
        { $addToSet: { groups: group._id } }
      );
    }

    await group.populate('members', 'name email role');

    res.json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove member from group (Admin only)
router.delete('/:id/members/:userId', auth, authorize('admin'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Don't allow removing the creator/admin
    if (group.createdBy.toString() === req.params.userId) {
      return res.status(400).json({ message: 'Cannot remove group creator' });
    }

    // Remove member
    group.members = group.members.filter(
      member => member.toString() !== req.params.userId
    );

    // Update user groups
    await User.findByIdAndUpdate(
      req.params.userId,
      { $pull: { groups: group._id } }
    );

    await group.save();
    await group.populate('members', 'name email role');

    res.json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get group by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members', 'name email role')
      .populate('createdBy', 'name');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check access permissions
    const isMember = group.members.some(member =>
      member._id.toString() === req.user._id.toString()
    );

    if (req.user.role !== 'admin' && !isMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark group as read
router.post('/:id/read', auth, async (req, res) => {
  try {
    await ReadStatus.findOneAndUpdate(
      { userId: req.user._id, groupId: req.params.id },
      { lastReadAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;