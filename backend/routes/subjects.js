const express = require('express');
const Subject = require('../models/Subject');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all subjects (grouped by year)
router.get('/', auth, async (req, res) => {
    try {
        const subjects = await Subject.find({ isActive: true })
            .sort({ year: 1, displayOrder: 1 });

        // Group by year
        const groupedSubjects = {
            '1st': [],
            '2nd': [],
            '3rd': [],
            '4th': []
        };

        subjects.forEach(subject => {
            if (groupedSubjects[subject.year]) {
                groupedSubjects[subject.year].push(subject);
            }
        });

        res.json(groupedSubjects);
    } catch (error) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all subjects as flat list
router.get('/list', auth, async (req, res) => {
    try {
        const subjects = await Subject.find({ isActive: true })
            .sort({ year: 1, displayOrder: 1 });
        res.json(subjects);
    } catch (error) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get subject by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const subject = await Subject.findById(req.params.id);
        if (!subject) {
            return res.status(404).json({ message: 'Subject not found' });
        }
        res.json(subject);
    } catch (error) {
        console.error('Error fetching subject:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create new subject (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
    try {
        const { name, year, displayOrder } = req.body;

        if (!name || !year) {
            return res.status(400).json({ message: 'Name and year are required' });
        }

        const subject = new Subject({
            name,
            year,
            displayOrder: displayOrder || 1
        });

        await subject.save();
        res.status(201).json(subject);
    } catch (error) {
        console.error('Error creating subject:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update subject (Admin only)
router.put('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const { name, year, displayOrder, isActive } = req.body;

        const subject = await Subject.findByIdAndUpdate(
            req.params.id,
            { name, year, displayOrder, isActive },
            { new: true, runValidators: true }
        );

        if (!subject) {
            return res.status(404).json({ message: 'Subject not found' });
        }

        res.json(subject);
    } catch (error) {
        console.error('Error updating subject:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete/deactivate subject (Admin only)
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const subject = await Subject.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!subject) {
            return res.status(404).json({ message: 'Subject not found' });
        }

        res.json({ message: 'Subject deactivated successfully' });
    } catch (error) {
        console.error('Error deleting subject:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
