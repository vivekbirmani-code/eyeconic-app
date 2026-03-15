const express = require('express');
const Group = require('../models/Group');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { emitToUser, emitToAdmins } = require('../utils/socket-helpers');

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
        .populate('mentors', 'name email role')
        .populate('createdBy', 'name');
    } else {
      groups = await Group.find({
        members: req.user._id
      })
        .populate('members', 'name email role')
        .populate('mentors', 'name email role')
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
    const { name, description, memberIds, type = 'general' } = req.body;

    // Validate group type
    if (!['general', 'mentors', 'admin'].includes(type)) {
      return res.status(400).json({ message: 'Invalid group type' });
    }

    // Start with admin as member
    const initialMembers = [req.user._id];
    let allMemberIds = [req.user._id];

    // Add additional members if provided
    if (memberIds && memberIds.length > 0) {
      initialMembers.push(...memberIds);
      allMemberIds.push(...memberIds);
    }

    // Validate members based on group type
    if (memberIds && memberIds.length > 0) {
      const members = await User.find({ _id: { $in: allMemberIds } });

      // Check for Mentors Group: Only Admins and Mentors allowed
      if (type === 'mentors') {
        const hasStudents = members.some(m => m.role === 'student');
        if (hasStudents) {
          return res.status(400).json({ message: 'Mentors group cannot contain students' });
        }
      }

      // Check for Admin Group: Only Admins allowed
      if (type === 'admin') {
        const hasNonAdmins = members.some(m => m.role !== 'admin');
        if (hasNonAdmins) {
          return res.status(400).json({ message: 'Admin group can only contain admins' });
        }
      }

      // Check for General Group: Max 1 Student allowed
      if (type === 'general') {
        const studentCount = members.filter(m => m.role === 'student').length;
        if (studentCount > 1) {
          return res.status(400).json({ message: 'General group can only have 1 student' });
        }
      }
    }

    const group = new Group({
      name,
      description,
      type,
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

    // Notify all new members (except the admin creator) about the new group
    if (memberIds && memberIds.length > 0) {
      memberIds.forEach(memberId => {
        emitToUser(memberId, 'group_added', {
          groupId: group._id.toString(),
          groupName: group.name
        });
      });
    }
    // Also notify admins so their users/overview screens refresh
    emitToAdmins('data_updated', { type: 'group' });

    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update group name/description (Admin only)
router.put('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (name !== undefined) group.name = name.trim();
    if (description !== undefined) group.description = description.trim();
    await group.save();

    await group.populate('members', 'name email role');
    await group.populate('createdBy', 'name');

    // Notify members about the update
    group.members.forEach(member => {
      if (member._id.toString() !== req.user._id.toString()) {
        emitToUser(member._id.toString(), 'group_updated', {
          groupId: group._id.toString(),
          groupName: group.name
        });
      }
    });
    emitToAdmins('data_updated', { type: 'group' });

    res.json(group);
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

    // Validate new members based on group type
    const currentMembers = await User.find({ _id: { $in: group.members } });
    const newMembersData = await User.find({ _id: { $in: userIds } });

    // Check for Mentors Group
    if (group.type === 'mentors') {
      const hasStudents = newMembersData.some(m => m.role === 'student');
      if (hasStudents) {
        return res.status(400).json({ message: 'Cannot add students to a Mentors group' });
      }
    }

    // Check for Admin Group
    if (group.type === 'admin') {
      const hasNonAdmins = newMembersData.some(m => m.role !== 'admin');
      if (hasNonAdmins) {
        return res.status(400).json({ message: 'Cannot add non-admins to an Admin group' });
      }
    }

    // Check for General Group
    if (group.type === 'general') {
      // Count existing students
      const currentStudentCount = currentMembers.filter(m => m.role === 'student').length;
      // Count new students
      const newStudentCount = newMembersData.filter(m => m.role === 'student').length;

      if (currentStudentCount + newStudentCount > 1) {
        return res.status(400).json({ message: 'General group cannot have more than 1 student' });
      }
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

    // Notify newly added members about the group
    newMembers.forEach(memberId => {
      emitToUser(memberId, 'group_added', {
        groupId: group._id.toString(),
        groupName: group.name
      });
    });
    // Notify admins
    emitToAdmins('data_updated', { type: 'group' });

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

    // Notify removed user
    emitToUser(req.params.userId, 'group_removed', {
      groupId: group._id.toString()
    });
    // Notify admins
    emitToAdmins('data_updated', { type: 'group' });

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

// Get all groups with mentor's assignment status (Admin only)
router.get('/mentor/:mentorId/assignments', auth, authorize('admin'), async (req, res) => {
  try {
    const { mentorId } = req.params;

    // Verify the user is a mentor
    const mentor = await User.findById(mentorId);
    if (!mentor) {
      return res.status(404).json({ message: 'Mentor not found' });
    }
    if (mentor.role !== 'mentor') {
      return res.status(400).json({ message: 'User is not a mentor' });
    }

    // Get all groups
    const groups = await Group.find()
      .select('_id name description members mentors')
      .lean();

    // Map groups with assignment status
    const groupsWithStatus = groups.map(group => {
      // Check if mentor is in members array or mentors array
      const isInMembers = group.members?.some(m => m.toString() === mentorId);
      const isInMentors = group.mentors?.some(m => m.toString() === mentorId);

      return {
        _id: group._id,
        name: group.name,
        description: group.description,
        isAssigned: isInMembers || isInMentors
      };
    });

    res.json(groupsWithStatus);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk update mentor group assignments (Admin only)
router.post('/bulk-mentor-assignment', auth, authorize('admin'), async (req, res) => {
  try {
    const { mentorId, addToGroups, removeFromGroups } = req.body;

    if (!mentorId) {
      return res.status(400).json({ message: 'Mentor ID is required' });
    }

    // Verify the user is a mentor
    const mentor = await User.findById(mentorId);
    if (!mentor) {
      return res.status(404).json({ message: 'Mentor not found' });
    }
    if (mentor.role !== 'mentor') {
      return res.status(400).json({ message: 'User is not a mentor' });
    }

    // Add mentor to groups
    if (addToGroups && addToGroups.length > 0) {
      // Update Group documents - add to both members and mentors arrays
      await Group.updateMany(
        { _id: { $in: addToGroups } },
        {
          $addToSet: {
            members: mentorId,
            mentors: mentorId
          }
        }
      );

      // Update User's groups array
      await User.findByIdAndUpdate(
        mentorId,
        { $addToSet: { groups: { $each: addToGroups } } }
      );
    }

    // Remove mentor from groups
    if (removeFromGroups && removeFromGroups.length > 0) {
      // Update Group documents - remove from both members and mentors arrays
      await Group.updateMany(
        { _id: { $in: removeFromGroups } },
        {
          $pull: {
            members: mentorId,
            mentors: mentorId
          }
        }
      );

      // Update User's groups array
      await User.findByIdAndUpdate(
        mentorId,
        { $pull: { groups: { $in: removeFromGroups } } }
      );
    }

    // Fetch updated assignments
    const groups = await Group.find()
      .select('_id name description members mentors')
      .lean();

    const groupsWithStatus = groups.map(group => {
      const isInMembers = group.members?.some(m => m.toString() === mentorId);
      const isInMentors = group.mentors?.some(m => m.toString() === mentorId);

      return {
        _id: group._id,
        name: group.name,
        description: group.description,
        isAssigned: isInMembers || isInMentors
      };
    });

    res.json({
      message: 'Mentor assignments updated successfully',
      groups: groupsWithStatus
    });

    // Notify the mentor about group changes
    if (addToGroups && addToGroups.length > 0) {
      addToGroups.forEach(groupId => {
        const grp = groupsWithStatus.find(g => g._id.toString() === groupId.toString());
        emitToUser(mentorId, 'group_added', {
          groupId: groupId.toString(),
          groupName: grp ? grp.name : ''
        });
      });
    }
    if (removeFromGroups && removeFromGroups.length > 0) {
      removeFromGroups.forEach(groupId => {
        emitToUser(mentorId, 'group_removed', { groupId: groupId.toString() });
      });
    }
    // Notify admins
    emitToAdmins('data_updated', { type: 'group' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
