const express = require('express');
const mongoose = require('mongoose');
const QuestionBank = require('../models/QuestionBank');
const Subject = require('../models/Subject');
const { auth, authorize } = require('../middleware/auth');
const multer = require('multer');
const { parseExcel } = require('../utils/excelParser');
const { buildImportTemplateBuffer } = require('../utils/excelTemplate');
const { buildImportValidationPayload } = require('../utils/importErrors');
const {
    QuestionValidationError,
    normalizeQuestionInput,
    normalizeQuestionImageFields,
    validateQuestionPayload,
} = require('../utils/questionValidation');
const {
    needsCloudinaryTransfer,
    transferQuestionImages,
} = require('../utils/imageUploader');
const logger = require('../utils/logger');

/**
 * Duplicate guard for manual question writes: the same question text within
 * the same subject (case- and whitespace-insensitive, active questions only)
 * is rejected with 409 — the same match semantics the Excel import uses for
 * reuse detection. Soft-deleted questions never block creation.
 * `excludeId` lets the update path check against every OTHER question.
 */
const DUPLICATE_QUESTION_MESSAGE = 'This question already exists in the question bank.';

const findDuplicateQuestion = (subjectId, questionText, excludeId = null) => {
    const normalizedText = String(questionText || '').trim().toLowerCase();
    if (!subjectId || !normalizedText) return null;

    const filter = {
        subject: subjectId,
        isActive: true,
        $expr: { $eq: [{ $toLower: '$question' }, normalizedText] },
    };
    if (excludeId) filter._id = { $ne: excludeId };
    return QuestionBank.findOne(filter);
};

const router = express.Router();

// Friendly subject-name aliases for import sheets: the canonical DB subject
// name is what groupings/filters key on, so sheets that spell a subject
// differently (e.g. "OBSTETRICS & GYNAECOLOGY" in the tech team's files)
// resolve to the existing subject instead of failing the whole row.
const SUBJECT_ALIASES = Object.freeze({
    'obstetrics & gynaecology': 'obgyn',
    'obstetrics and gynaecology': 'obgyn',
    'obstetrics & gynecology': 'obgyn',
    'obstetrics and gynecology': 'obgyn',
    'ob-gyn': 'obgyn',
    'obg': 'obgyn',
});

const subjectLookupKey = (name) => {
    const lower = String(name || '').trim().toLowerCase();
    return SUBJECT_ALIASES[lower] || lower;
};

const STUDENT_HIDDEN_FIELDS = '-correctAnswer -explanation -assertion -reason -columnA -columnB';

const LIST_SELECT_FIELDS = '_id qid question subject topicName subtopicName system questionType tags '
    + 'difficulty options optionImages questionImage correctAnswer explanation explanationImage '
    + 'assertion reason columnA columnB isActive createdAt';

// Get question bank stats
router.get('/stats', auth, authorize('admin'), async (req, res) => {
    try {
        const total = await QuestionBank.countDocuments({ isActive: true });
        res.json({ total });
    } catch (error) {
        logger.error('Error fetching question stats', { error: error.message });
        res.status(500).json({ message: 'Server error' });
    }
});

// Configure multer for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Get all questions (with filters)
router.get('/', auth, async (req, res) => {
    try {
        const { subject, chapter, topic, topicName, subtopicName, system, questionType, tag, difficulty, search } = req.query;

        const filter = { isActive: true };

        if (subject) filter.subject = subject;
        if (chapter) filter.chapter = chapter;
        if (topic) filter.topic = topic;
        if (topicName) filter.topicName = { $regex: topicName, $options: 'i' };
        if (subtopicName) filter.subtopicName = { $regex: subtopicName, $options: 'i' };
        if (system) filter.system = { $regex: system, $options: 'i' };
        if (questionType) filter.questionType = questionType;
        if (tag) filter.tags = { $in: [new RegExp(tag, 'i')] };
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
            .limit(Math.min(parseInt(req.query.limit) || 100, 1000));

        // Only hide answers for students, show for admin/mentor
        if (req.user.role === 'student') {
            query = query.select(STUDENT_HIDDEN_FIELDS);
        }

        const questions = await query;
        res.json(questions);
    } catch (error) {
        logger.error('Error listing questions', { error: error.message });
        res.status(500).json({ message: 'Server error' });
    }
});

// Add single question
router.post('/', auth, authorize('admin'), async (req, res) => {
    try {
        const normalized = normalizeQuestionInput(req.body);
        validateQuestionPayload(normalized);

        const duplicate = await findDuplicateQuestion(normalized.subject, normalized.question);
        if (duplicate) {
            logger.info('Duplicate question creation blocked', {
                userId: req.user._id.toString(),
                existingQuestionId: duplicate._id.toString(),
            });
            return res.status(409).json({
                message: DUPLICATE_QUESTION_MESSAGE,
                errorType: 'DUPLICATE_QUESTION',
            });
        }

        const question = new QuestionBank({
            ...normalized,
            createdBy: req.user._id
        });

        await question.save();
        logger.info('Question created', { questionId: question._id.toString(), userId: req.user._id.toString() });
        res.status(201).json(question);
    } catch (error) {
        if (error instanceof QuestionValidationError) {
            return res.status(400).json({ message: 'Validation failed', errors: error.errors });
        }
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: 'Validation failed', errors: Object.values(error.errors).map(e => e.message) });
        }
        logger.error('Error creating question', { error: error.message });
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * Shared handler for bulk-import (multipart) and bulk-import-base64 (React Native).
 * Uses the single canonical Excel parser + validation pipeline so both entry
 * points enforce identical rules.
 */
async function handleBulkImport(req, res, buffer) {
    const parseResult = await parseExcel(buffer);
    if (parseResult.fatal) {
        return res.status(400).json({
            ...buildImportValidationPayload([parseResult.fatal.message], {
                totalErrors: 1,
                hint: parseResult.fatal.hint,
            }),
        });
    }
    const { questions: parsedRows, errors: parseErrors } = parseResult;

    const subjectsMap = {};
    const allSubjects = await Subject.find();
    allSubjects.forEach(s => {
        subjectsMap[s.name.toLowerCase()] = s._id;
    });

    const errors = [...parseErrors];
    const warnings = [];
    const questions = [];
    const transferJobs = [];

    parsedRows.forEach((row, idx) => {
        const rowLabel = `Row ${idx + 2}`;
        const subjectId = subjectsMap[subjectLookupKey(row.subjectName)];
        if (!subjectId) {
            errors.push(`${rowLabel}: Unknown subject '${row.subjectName}'. Please use standard subject names.`);
            return;
        }

        const candidate = {
            qid: row.qid,
            subject: subjectId,
            topicName: row.topicName,
            subtopicName: row.subtopicName,
            system: row.system,
            questionType: row.questionType,
            difficulty: row.difficulty,
            tags: row.tags,
            question: row.question,
            questionImage: row.questionImage,
            options: row.options,
            optionImages: row.optionImages,
            assertion: row.assertion,
            reason: row.reason,
            columnA: row.columnA,
            columnB: row.columnB,
            correctAnswer: row.correctAnswer,
            explanation: row.explanation,
            explanationImage: row.explanationImage,
            marrowCode: row.marrowCode,
            source: row.source,
            createdBy: req.user._id
        };

        try {
            // Same normalization the JSON create/update path applies (trim,
            // Drive share-link conversion) so imports store identical shapes.
            normalizeQuestionImageFields(candidate);
            validateQuestionPayload(candidate, { rowLabel });
            questions.push(candidate);

            // Remote images (Google Drive links etc.) are transferred to the
            // app's Cloudinary CDN before insert — the same authoritative
            // image store the admin editor uploads to — instead of being
            // hotlinked from a third party that can revoke sharing or
            // throttle participant traffic.
            if (
                needsCloudinaryTransfer(candidate.questionImage)
                || (Array.isArray(candidate.optionImages) && candidate.optionImages.some(needsCloudinaryTransfer))
                || needsCloudinaryTransfer(candidate.explanationImage)
            ) {
                transferJobs.push({ candidate, rowLabel });
            }
        } catch (err) {
            if (err instanceof QuestionValidationError) {
                errors.push(...err.errors);
            } else {
                errors.push(`${rowLabel}: ${err.message}`);
            }
        }
    });

    // Image transfer, bounded concurrency (4 rows at a time, each row's images
    // sequentially — ~35 real rows finish in well under a minute; the per-image
    // axios timeout in imageUploader bounds the worst case).
    if (transferJobs.length > 0) {
        logger.info('Import image transfer starting', { rowsWithRemoteImages: transferJobs.length });
        let next = 0;
        const worker = async () => {
            while (next < transferJobs.length) {
                const job = transferJobs[next++];
                try {
                    const { warnings: rowWarnings } = await transferQuestionImages(job.candidate, job.rowLabel);
                    warnings.push(...rowWarnings);
                } catch (err) {
                    // transferQuestionImages already falls back to the direct
                    // URL per image; a throw here is a programming error, but
                    // the import must still not fail because of it.
                    warnings.push(`${job.rowLabel}: image transfer skipped (${err.message}) — direct source URLs kept.`);
                }
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
    }

    if (questions.length === 0) {
        const { buildImportValidationPayload } = require('../utils/importErrors');
        return res.status(400).json({
            ...buildImportValidationPayload(errors.slice(0, 50), { totalErrors: errors.length }),
            hint: 'Check that your Excel has columns: SUBJECT, TOPIC, SUBTOPIC, SYSTEM, QUESTION_TYPE, DIFFICULTY, QUESTION, OPTION1, OPTION2, CORRECT',
        });
    }

    let inserted = [];
    try {
        inserted = await QuestionBank.insertMany(questions, { ordered: false });
    } catch (bulkError) {
        if (bulkError.insertedDocs) {
            inserted = bulkError.insertedDocs;
        }
        if (Array.isArray(bulkError.writeErrors)) {
            bulkError.writeErrors.forEach(we => {
                errors.push(`Row ${we.index + 2}: ${we.errmsg || we.err?.errmsg || 'Failed to insert'}`);
            });
        }
    }

    logger.info('Question bank import complete', {
        inserted: inserted.length,
        errorCount: errors.length,
        warningCount: warnings.length,
        userId: req.user._id.toString(),
    });

    res.json({
        message: 'Questions imported successfully',
        count: inserted.length,
        totalRows: parsedRows.length + parseErrors.length,
        errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
        // Non-fatal image-transfer outcomes (direct URL kept); surfaced so
        // the admin knows which images to re-check in the Question Bank.
        warnings: warnings.length > 0 ? warnings.slice(0, 50) : undefined
    });
}

// Download canonical Excel import template
router.get('/import-template', auth, authorize('admin'), async (req, res) => {
    try {
        const buffer = buildImportTemplateBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Question_Bank_Import_Template.xlsx"');
        res.send(buffer);
    } catch (error) {
        logger.error('Import template generation error', { error: error.message });
        res.status(500).json({ message: 'Failed to generate import template' });
    }
});

// Bulk import from Excel
router.post('/bulk-import', auth, authorize('admin'), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: 'No file uploaded',
                hint: 'Please select an Excel file (.xlsx)'
            });
        }

        await handleBulkImport(req, res, req.file.buffer);
    } catch (error) {
        logger.error('Bulk import error', { error: error.message, requestId: req.requestId });
        res.status(500).json({
            message: 'Error importing questions',
            requestId: req.requestId
        });
    }
});

// Bulk import from Excel (Base64 - for React Native)
router.post('/bulk-import-base64', auth, authorize('admin'), async (req, res) => {
    try {
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({
                message: 'No file data provided',
                hint: 'Please select an Excel file (.xlsx)'
            });
        }

        const buffer = Buffer.from(data, 'base64');
        await handleBulkImport(req, res, buffer);
    } catch (error) {
        logger.error('Bulk import (base64) error', { error: error.message, requestId: req.requestId });
        res.status(500).json({
            message: 'Error importing questions',
            requestId: req.requestId
        });
    }
});

// Get questions by multiple subjects (for quiz creation - manual selection)
router.get('/by-subjects', auth, authorize('admin'), async (req, res) => {
    try {
        let { subjects, search, page = 1, limit = 50, topic, subtopicName, system, questionType, tag, difficulty } = req.query;

        if (!subjects) {
            return res.status(400).json({ message: 'Subjects parameter is required' });
        }

        // Normalize: supports repeated query params and comma-separated values.
        const subjectIds = (Array.isArray(subjects) ? subjects : [subjects])
            .flatMap(s => String(s).split(','))
            .map(s => s.trim())
            .filter(Boolean);
        const uniqueSubjectIds = [...new Set(subjectIds)];
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const objectIdSubjects = uniqueSubjectIds
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id));

        if (objectIdSubjects.length === 0) {
            return res.status(200).json({
                questions: [],
                total: 0,
                page: parseInt(page),
                pages: 0
            });
        }

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

        if (topic) filter.topicName = { $regex: topic, $options: 'i' };
        if (subtopicName) filter.subtopicName = { $regex: subtopicName, $options: 'i' };
        if (system) filter.system = { $regex: system, $options: 'i' };
        if (questionType) filter.questionType = questionType;
        if (difficulty) filter.difficulty = difficulty;
        if (tag) filter.tags = { $in: [new RegExp(tag, 'i')] };

        const total = await QuestionBank.countDocuments(filter);
        const questions = await QuestionBank.find(filter)
            .populate('subject', 'name')
            .select(LIST_SELECT_FIELDS)
            .sort({ subject: 1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            questions,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit)
        });
    } catch (error) {
        logger.error('Error fetching questions by subjects', { error: error.message });
        res.status(500).json({ message: 'Server error' });
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
        logger.error('Stats error', { error: error.message });
        res.status(500).json({ total: 0, bySubject: [] });
    }
});

// Get single question (with answer - admin/mentor only)
router.get('/:id', auth, async (req, res) => {
    try {
        let query = QuestionBank.findById(req.params.id)
            .populate('subject', 'name')
            .populate('chapter', 'name')
            .populate('topic', 'name');

        if (req.user.role === 'student') {
            query = query.select(STUDENT_HIDDEN_FIELDS);
        }

        const question = await query;

        if (!question) {
            return res.status(404).json({ message: 'Question not found' });
        }

        res.json(question);
    } catch (error) {
        logger.error('Error fetching question', { error: error.message });
        res.status(500).json({ message: 'Server error' });
    }
});

// Update question
router.put('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const existing = await QuestionBank.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: 'Question not found' });
        }

        const normalized = normalizeQuestionInput(req.body);

        // Validate against the FINAL merged shape so partial updates are held
        // to the same required-field rules as creation, without needing the
        // client to resend every field on every edit. validateQuestionPayload
        // may mutate `merged` to fill in type-derived defaults (e.g. default
        // assertion/reason options, numeric coercion) — those must be
        // persisted too, so we assign the full merged+validated object back.
        const merged = { ...existing.toObject(), ...normalized };
        validateQuestionPayload(merged);

        const { _id, createdAt, updatedAt, __v, ...safeMerged } = merged;
        Object.assign(existing, safeMerged);

        // An edit must not turn this question into a copy of another one.
        const duplicate = await findDuplicateQuestion(existing.subject, existing.question, existing._id);
        if (duplicate) {
            logger.info('Duplicate question update blocked', {
                userId: req.user._id.toString(),
                questionId: existing._id.toString(),
                duplicateOf: duplicate._id.toString(),
            });
            return res.status(409).json({
                message: DUPLICATE_QUESTION_MESSAGE,
                errorType: 'DUPLICATE_QUESTION',
            });
        }

        await existing.save();
        logger.info('Question updated', { questionId: existing._id.toString(), userId: req.user._id.toString() });
        res.json(existing);
    } catch (error) {
        if (error instanceof QuestionValidationError) {
            return res.status(400).json({ message: 'Validation failed', errors: error.errors });
        }
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: 'Validation failed', errors: Object.values(error.errors).map(e => e.message) });
        }
        logger.error('Error updating question', { error: error.message });
        res.status(500).json({ message: 'Server error' });
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

        logger.info('Question deleted (soft)', { questionId: question._id.toString(), userId: req.user._id.toString() });
        res.json({ message: 'Question deleted successfully' });
    } catch (error) {
        logger.error('Error deleting question', { error: error.message });
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
