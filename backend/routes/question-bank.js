const express = require('express');
const QuestionBank = require('../models/QuestionBank');
const Subject = require('../models/Subject');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const { auth, authorize } = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');

const router = express.Router();

// Get question bank stats
router.get('/stats', auth, authorize('admin'), async (req, res) => {
    try {
        const total = await QuestionBank.countDocuments({ isActive: true });
        res.json({ total });
    } catch (error) {
        console.error('Error fetching question stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Configure multer for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Helper to convert Google Drive share links to direct download links
const convertDriveToDirectLink = (url) => {
    if (!url) return undefined;
    const strUrl = url.toString().trim();
    if (!strUrl) return undefined;

    // Check if it's a Google Drive link
    if (strUrl.includes('drive.google.com')) {
        // Try to find the file ID
        // Patterns: /file/d/FILE_ID/view, /open?id=FILE_ID, /uc?id=FILE_ID
        const idMatch = strUrl.match(/[-\w]{25,}/);
        if (idMatch) {
            return `https://drive.google.com/uc?export=view&id=${idMatch[0]}`;
        }
    }
    return strUrl;
};

// Get all questions (with filters)
router.get('/', auth, async (req, res) => {
    try {
        const { subject, chapter, topic, difficulty, search } = req.query;

        const filter = { isActive: true };

        if (subject) filter.subject = subject;
        if (chapter) filter.chapter = chapter;
        if (topic) filter.topic = topic;
        if (difficulty) filter.difficulty = difficulty;
        if (search) {
            filter.$or = [
                { question: { $regex: search, $options: 'i' } },
                { qid: { $regex: search, $options: 'i' } }
            ];
        }

        let query = QuestionBank.find(filter)
            .populate('subject', 'name')
            .populate('chapter', 'name')
            .populate('topic', 'name')
            .sort({ createdAt: -1 })
            .limit(100);

        // Only hide answers for students, show for admin/mentor
        if (req.user.role === 'student') {
            query = query.select('-correctAnswer -explanation');
        }

        const questions = await query;
        res.json(questions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Add single question
router.post('/', auth, authorize('admin'), async (req, res) => {
    try {
        const question = new QuestionBank({
            ...req.body,
            createdBy: req.user._id
        });


        await question.save();
        res.status(201).json(question);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Bulk import from Excel
router.post('/bulk-import', auth, authorize('admin'), upload.single('file'), async (req, res) => {
    try {
        console.log('=== Bulk Import Request ===');
        console.log('File:', req.file ? req.file.originalname : 'No file');
        console.log('File size:', req.file ? req.file.size : 0);

        if (!req.file) {
            return res.status(400).json({
                message: 'No file uploaded',
                hint: 'Please select an Excel file (.xlsx)'
            });
        }

        // Parse Excel file
        console.log('Parsing Excel...');
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Parsed ${data.length} rows`);
        console.log('First row columns:', Object.keys(data[0] || {}));

        if (data.length === 0) {
            return res.status(400).json({
                message: 'Excel file is empty',
                hint: 'Make sure the Excel file has data rows below the header'
            });
        }

        // Get or create subjects map
        const subjectsMap = {};
        const allSubjects = await Subject.find();
        allSubjects.forEach(s => {
            subjectsMap[s.name.toLowerCase()] = s._id;
        });

        const questions = [];
        const errors = [];
        const newSubjects = new Set();

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const rowNum = i + 2; // Excel row number (header is row 1)

            try {
                // Get subject
                const subjectName = (row.SUBJECT || row.subject || '').toString().trim();
                if (!subjectName) {
                    errors.push(`Row ${rowNum}: Missing SUBJECT`);
                    continue;
                }

                let subjectId = subjectsMap[subjectName.toLowerCase()];

                // Create subject if doesn't exist
                if (!subjectId) {
                    if (!newSubjects.has(subjectName.toLowerCase())) {
                        const newSubject = await Subject.create({
                            name: subjectName,
                            code: subjectName.substring(0, 3).toUpperCase(),
                            year: '2024'
                        });
                        subjectId = newSubject._id;
                        subjectsMap[subjectName.toLowerCase()] = subjectId;
                        newSubjects.add(subjectName.toLowerCase());
                        console.log(`Created new subject: ${subjectName}`);
                    } else {
                        subjectId = subjectsMap[subjectName.toLowerCase()];
                    }
                }

                // Get question text
                const questionText = (row.QUESTION || row.question || '').toString().trim();
                if (!questionText) {
                    errors.push(`Row ${rowNum}: Missing QUESTION`);
                    continue;
                }

                // Get options
                const option1 = (row.OPTION1 || row.option1 || '').toString().trim();
                const option2 = (row.OPTION2 || row.option2 || '').toString().trim();
                const option3 = (row.OPTION3 || row.option3 || '').toString().trim();
                const option4 = (row.OPTION4 || row.option4 || '').toString().trim();

                if (!option1 || !option2) {
                    errors.push(`Row ${rowNum}: Missing options (need at least 2 options)`);
                    continue;
                }

                // Get correct answer (convert from 1-4 to 0-3 index)
                let correctAnswer = parseInt(row.CORRECT_ANSWER || row.correct_answer || row.correctAnswer || '1');
                if (correctAnswer >= 1 && correctAnswer <= 4) {
                    correctAnswer = correctAnswer - 1; // Convert to 0-based index
                } else {
                    correctAnswer = 0; // Default to first option
                }

                // Get option images
                const oImage1 = convertDriveToDirectLink(row.O_IMAGE_1 || row.o_image_1 || row.OPTION1_IMAGE || row['OPTION 1 IMAGE']);
                const oImage2 = convertDriveToDirectLink(row.O_IMAGE_2 || row.o_image_2 || row.OPTION2_IMAGE || row['OPTION 2 IMAGE']);
                const oImage3 = convertDriveToDirectLink(row.O_IMAGE_3 || row.o_image_3 || row.OPTION3_IMAGE || row['OPTION 3 IMAGE']);
                const oImage4 = convertDriveToDirectLink(row.O_IMAGE_4 || row.o_image_4 || row.OPTION4_IMAGE || row['OPTION 4 IMAGE']);

                // Parse tags (comma-separated)
                const tagsRaw = (row.TAGS || row.tags || row.TAG || '').toString().trim();
                const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(t => t) : [];

                const questionData = {
                    qid: (row.QID || row.qid || '').toString().trim() || undefined,
                    subject: subjectId,
                    topicName: (row.TOPIC || row.topic || '').toString().trim(),
                    question: questionText,
                    questionImage: convertDriveToDirectLink(row.Q_IMAGE || row.q_image || ''),
                    options: [option1, option2, option3 || '', option4 || ''].filter(o => o),
                    optionImages: [oImage1, oImage2, oImage3, oImage4].filter(o => o).length > 0
                        ? [oImage1 || '', oImage2 || '', oImage3 || '', oImage4 || '']
                        : [],
                    correctAnswer: correctAnswer,
                    explanation: (row.EXPLANATION || row.explanation || row.EXPLAINATION || '').toString().trim(),
                    explanationImage: convertDriveToDirectLink(row.EX_IMAGE || row.ex_image || ''),
                    marks: parseInt(row.MARKS || row.marks || '1') || 1,
                    positiveMarks: parseInt(row.POSITIVE_MARKS || row.positive_marks || row.positiveMarks || row.MARKS || row.marks || '4') || 4,
                    negativeMarks: parseInt(row.NEGATIVE_MARKS || row.negative_marks || row.negativeMarks || '0') || 0,
                    tags: tags,
                    marrowCode: (row.MARROW_CODE || row['MARROW CODE'] || '').toString().trim() || undefined,
                    source: (row.SOURCE || row.source || '').toString().trim() || undefined,
                    createdBy: req.user._id
                };

                questions.push(questionData);
            } catch (err) {
                errors.push(`Row ${rowNum}: ${err.message}`);
            }
        }

        console.log(`Processed ${questions.length} valid questions`);
        console.log(`Errors: ${errors.length}`);

        if (questions.length === 0) {
            return res.status(400).json({
                message: 'No valid questions found',
                errors: errors.slice(0, 10) // Return first 10 errors
            });
        }

        // Insert questions
        const inserted = await QuestionBank.insertMany(questions, { ordered: false });

        console.log(`Successfully inserted ${inserted.length} questions`);

        res.json({
            message: 'Questions imported successfully',
            count: inserted.length,
            totalRows: data.length,
            errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
            newSubjects: Array.from(newSubjects)
        });

    } catch (error) {
        console.error('=== Bulk Import Error ===');
        console.error(error);
        res.status(500).json({
            message: 'Error importing questions',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Bulk import from Excel (Base64 - for React Native)
router.post('/bulk-import-base64', auth, authorize('admin'), async (req, res) => {
    try {
        console.log('=== Bulk Import Base64 Request ===');
        const { filename, data } = req.body;

        if (!data) {
            return res.status(400).json({
                message: 'No file data provided',
                hint: 'Please select an Excel file (.xlsx)'
            });
        }

        // Convert base64 to buffer
        const buffer = Buffer.from(data, 'base64');
        console.log(`File: ${filename}, Size: ${buffer.length} bytes`);

        // Parse Excel file
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const excelData = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Parsed ${excelData.length} rows`);
        console.log('Columns:', Object.keys(excelData[0] || {}));

        if (excelData.length === 0) {
            return res.status(400).json({
                message: 'Excel file is empty',
                hint: 'Make sure the Excel file has data rows below the header'
            });
        }

        // Get or create subjects map
        const subjectsMap = {};
        const allSubjects = await Subject.find();
        allSubjects.forEach(s => {
            subjectsMap[s.name.toLowerCase()] = s._id;
        });

        const questions = [];
        const errors = [];
        const newSubjects = new Set();

        for (let i = 0; i < excelData.length; i++) {
            const row = excelData[i];
            const rowNum = i + 2;

            try {
                // Get subject
                const subjectName = (row.SUBJECT || row.subject || '').toString().trim();
                if (!subjectName) {
                    errors.push(`Row ${rowNum}: Missing SUBJECT`);
                    continue;
                }

                let subjectId = subjectsMap[subjectName.toLowerCase()];

                // Create subject if doesn't exist
                if (!subjectId) {
                    if (!newSubjects.has(subjectName.toLowerCase())) {
                        const newSubject = await Subject.create({
                            name: subjectName,
                            code: subjectName.substring(0, 3).toUpperCase(),
                            year: '2024'
                        });
                        subjectId = newSubject._id;
                        subjectsMap[subjectName.toLowerCase()] = subjectId;
                        newSubjects.add(subjectName.toLowerCase());
                        console.log(`Created new subject: ${subjectName}`);
                    } else {
                        subjectId = subjectsMap[subjectName.toLowerCase()];
                    }
                }

                // Get question text
                const questionText = (row.QUESTION || row.question || '').toString().trim();
                if (!questionText) {
                    errors.push(`Row ${rowNum}: Missing QUESTION`);
                    continue;
                }

                // Get options
                const option1 = (row.OPTION1 || row.option1 || row['OPTION 1'] || '').toString().trim();
                const option2 = (row.OPTION2 || row.option2 || row['OPTION 2'] || '').toString().trim();
                const option3 = (row.OPTION3 || row.option3 || row['OPTION 3'] || '').toString().trim();
                const option4 = (row.OPTION4 || row.option4 || row['OPTION 4'] || '').toString().trim();

                if (!option1 || !option2) {
                    errors.push(`Row ${rowNum}: Missing options`);
                    continue;
                }

                // Get correct answer
                let correctAnswer = 0;
                const answerVal = (row.CORRECT_ANSWER || row.correct_answer || row.correctAnswer || row.CORRECT || row.correct || row.ANSWER || '1').toString().trim();

                // Check if it's a letter (A, B, C, D)
                if (['A', 'a'].includes(answerVal)) correctAnswer = 0;
                else if (['B', 'b'].includes(answerVal)) correctAnswer = 1;
                else if (['C', 'c'].includes(answerVal)) correctAnswer = 2;
                else if (['D', 'd'].includes(answerVal)) correctAnswer = 3;
                else {
                    // Try numeric
                    const numVal = parseInt(answerVal);
                    if (numVal >= 1 && numVal <= 4) correctAnswer = numVal - 1;
                }

                // Get option images
                const oImage1 = convertDriveToDirectLink(row.O_IMAGE_1 || row.o_image_1 || row.OPTION1_IMAGE || row['OPTION 1 IMAGE']);
                const oImage2 = convertDriveToDirectLink(row.O_IMAGE_2 || row.o_image_2 || row.OPTION2_IMAGE || row['OPTION 2 IMAGE']);
                const oImage3 = convertDriveToDirectLink(row.O_IMAGE_3 || row.o_image_3 || row.OPTION3_IMAGE || row['OPTION 3 IMAGE']);
                const oImage4 = convertDriveToDirectLink(row.O_IMAGE_4 || row.o_image_4 || row.OPTION4_IMAGE || row['OPTION 4 IMAGE']);

                const questionData = {
                    qid: (row.QID || row.qid || row.ID || '').toString().trim() || undefined,
                    subject: subjectId,
                    topicName: (row.TOPIC || row.topic || row.TAG || row.CHAPTER || '').toString().trim(),
                    question: questionText,
                    questionImage: convertDriveToDirectLink(row.Q_IMAGE || row.q_image || row.IMAGE || ''),
                    options: [option1, option2, option3, option4].filter(o => o),
                    optionImages: [oImage1, oImage2, oImage3, oImage4].filter(o => o).length > 0
                        ? [oImage1 || '', oImage2 || '', oImage3 || '', oImage4 || '']
                        : [],
                    correctAnswer: correctAnswer,
                    explanation: (row.EXPLANATION || row.explanation || row.EXPLAINATION || row.REASON || '').toString().trim(),
                    explanationImage: convertDriveToDirectLink(row.EX_IMAGE || row.ex_image || ''),
                    marks: parseInt(row.MARKS || row.marks || '1') || 1,
                    marrowCode: (row.MARROW_CODE || row['MARROW CODE'] || row.MARROW || '').toString().trim() || undefined,
                    source: (row.SOURCE || row.source || '').toString().trim() || undefined,
                    createdBy: req.user._id
                };

                questions.push(questionData);
            } catch (err) {
                errors.push(`Row ${rowNum}: ${err.message}`);
            }
        }

        console.log(`Valid questions: ${questions.length}`);
        console.log(`Errors: ${errors.length}`);

        if (questions.length === 0) {
            return res.status(400).json({
                message: 'No valid questions found',
                errors: errors.slice(0, 20),
                hint: 'Check that your Excel has columns: SUBJECT, QUESTION, OPTION1, OPTION2, OPTION3, OPTION4'
            });
        }

        // Insert questions (skip duplicates)
        let inserted = [];
        try {
            inserted = await QuestionBank.insertMany(questions, { ordered: false });
        } catch (bulkError) {
            // Some documents may have failed (duplicates)
            if (bulkError.insertedDocs) {
                inserted = bulkError.insertedDocs;
            }
            console.log('Bulk insert partial success:', inserted.length);
        }

        console.log(`Inserted: ${inserted.length}`);

        res.json({
            message: 'Questions imported successfully',
            count: inserted.length,
            totalRows: excelData.length,
            errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
            newSubjects: Array.from(newSubjects)
        });

    } catch (error) {
        console.error('=== Bulk Import Base64 Error ===');
        console.error(error);
        res.status(500).json({
            message: 'Error importing questions',
            error: error.message
        });
    }
});

// Get questions by multiple subjects (for quiz creation - manual selection)
router.get('/by-subjects', auth, authorize('admin'), async (req, res) => {
    try {
        let { subjects, search } = req.query;

        if (!subjects) {
            return res.status(400).json({ message: 'Subjects parameter is required' });
        }

        // Convert to array if single value
        const subjectIds = Array.isArray(subjects) ? subjects : [subjects];

        const mongoose = require('mongoose');
        const objectIdSubjects = subjectIds.map(id => new mongoose.Types.ObjectId(id));

        const filter = {
            isActive: true,
            subject: { $in: objectIdSubjects }
        };

        if (search) {
            filter.$or = [
                { question: { $regex: search, $options: 'i' } },
                { qid: { $regex: search, $options: 'i' } },
                { topicName: { $regex: search, $options: 'i' } }
            ];
        }

        const questions = await QuestionBank.find(filter)
            .populate('subject', 'name')
            .select('_id qid question subject topicName options marks tags questionImage optionImages correctAnswer explanation explanationImage')
            .sort({ subject: 1, createdAt: -1 })
            .limit(500);

        res.json(questions);
    } catch (error) {
        console.error('Error fetching questions by subjects:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Get statistics - MUST be before /:id routes
router.get('/stats/summary', auth, async (req, res) => {
    try {
        const stats = await QuestionBank.aggregate([
            { $match: { isActive: true } },
            {
                $group: {
                    _id: '$subject',
                    count: { $sum: 1 }
                }
            },
            {
                $lookup: {
                    from: 'subjects',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'subject'
                }
            },
            { $unwind: { path: '$subject', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    subject: { $ifNull: ['$subject.name', 'Unknown'] },
                    count: 1
                }
            }
        ]);

        const total = await QuestionBank.countDocuments({ isActive: true });

        res.json({ total, bySubject: stats || [] });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ total: 0, bySubject: [] });
    }
});

// Get single question (with answer - admin/mentor only)
router.get('/:id', auth, async (req, res) => {
    try {
        const question = await QuestionBank.findById(req.params.id)
            .populate('subject', 'name')
            .populate('chapter', 'name')
            .populate('topic', 'name');

        if (!question) {
            return res.status(404).json({ message: 'Question not found' });
        }

        // Hide answer for students
        if (req.user.role === 'student') {
            question.correctAnswer = undefined;
            question.explanation = undefined;
        }

        res.json(question);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update question
router.put('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const question = await QuestionBank.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!question) {
            return res.status(404).json({ message: 'Question not found' });
        }

        res.json(question);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Delete question
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const question = await QuestionBank.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!question) {
            return res.status(404).json({ message: 'Question not found' });
        }

        res.json({ message: 'Question deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
