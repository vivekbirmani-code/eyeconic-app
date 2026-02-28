const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const QuestionBank = require('../models/QuestionBank');
const { auth, authorize } = require('../middleware/auth');
const multer = require('multer');
const { parseExcel } = require('../utils/excelParser');
const { processQuestionImages } = require('../utils/imageUploader');
const Subject = require('../models/Subject');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// Get quiz stats
router.get('/stats', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const total = await Quiz.countDocuments({ isActive: true });
    const daily = await Quiz.countDocuments({ isActive: true, testType: 'daily' });
    const weekly = await Quiz.countDocuments({ isActive: true, testType: 'weekly' });
    const grand = await Quiz.countDocuments({ isActive: true, testType: 'grand' });
    res.json({ total, daily, weekly, grand });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pending retests (must be before /:id)
router.get('/retests/pending', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const attempts = await QuizAttempt.find({
      retestRequested: true,
      retestApproved: false
    }).populate('student', 'name email').populate('quiz', 'title');
    res.json(attempts);
  } catch (error) {
    console.error('Pending retests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark quizzes as seen for the student
router.post('/mark-seen', auth, authorize('student'), async (req, res) => {
  try {
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { $set: { unseenQuizzes: [] } });
    res.json({ message: 'Quizzes marked as seen' });
  } catch (error) {
    console.error('Mark seen error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all quizzes (role-based access)
router.get('/', auth, async (req, res) => {
  try {
    let quizzes;

    if (req.user.role === 'admin') {
      // Admin sees all quizzes
      quizzes = await Quiz.find({ isActive: true })
        .populate('subject', 'name')
        .populate('createdBy', 'name')
        .populate({ path: 'questions', select: 'subject', populate: { path: 'subject', select: 'name' } })
        .sort({ createdAt: -1 });

      // Compute unique subject names from questions for multi-subject display
      quizzes = quizzes.map(q => {
        const qObj = q.toObject();
        const names = [...new Set(
          (qObj.questions || [])
            .map(qu => qu.subject?.name)
            .filter(Boolean)
        )];
        qObj.subjectNames = names.length > 0 ? names : (qObj.subject?.name ? [qObj.subject.name] : []);
        // Strip full question data to keep response small
        qObj.questions = (qObj.questions || []).map(qu => qu._id);
        return qObj;
      });
    } else if (req.user.role === 'mentor') {
      // Mentor sees all quizzes for now
      quizzes = await Quiz.find({ isActive: true })
        .populate('subject', 'name')
        .populate('createdBy', 'name')
        .populate({ path: 'questions', select: 'subject', populate: { path: 'subject', select: 'name' } })
        .sort({ createdAt: -1 });

      quizzes = quizzes.map(q => {
        const qObj = q.toObject();
        const names = [...new Set(
          (qObj.questions || [])
            .map(qu => qu.subject?.name)
            .filter(Boolean)
        )];
        qObj.subjectNames = names.length > 0 ? names : (qObj.subject?.name ? [qObj.subject.name] : []);
        qObj.questions = (qObj.questions || []).map(qu => qu._id);
        return qObj;
      });
    } else {
      // Student sees only quizzes assigned to them
      quizzes = await Quiz.find({
        isActive: true,
        assignedStudents: req.user._id
      })
        .populate('subject', 'name')
        .populate('createdBy', 'name')
        .populate({ path: 'questions', select: 'subject', populate: { path: 'subject', select: 'name' } })
        .sort({ createdAt: -1 });

      // Add attempt status for each quiz
      const quizIds = quizzes.map(q => q._id);
      const attempts = await QuizAttempt.find({
        quiz: { $in: quizIds },
        student: req.user._id
      });

      quizzes = quizzes.map(quiz => {
        const qObj = quiz.toObject();

        // Compute unique subject names from questions (same as admin/mentor)
        const names = [...new Set(
          (qObj.questions || [])
            .map(qu => qu.subject?.name)
            .filter(Boolean)
        )];
        qObj.subjectNames = names.length > 0 ? names : (qObj.subject?.name ? [qObj.subject.name] : []);

        // Strip full question data to keep response small
        qObj.questions = (qObj.questions || []).map(qu => qu._id);

        const attempt = attempts.find(a => a.quiz.toString() === quiz._id.toString());
        qObj.attemptStatus = attempt ? {
          hasAttempted: true,
          status: attempt.status,
          score: attempt.score,
          marksObtained: attempt.marksObtained,
          canRetake: attempt.retestApproved && !attempt.retestUsed,
          retestRequested: attempt.retestRequested && !attempt.retestApproved
        } : {
          hasAttempted: false,
          canRetake: false,
          retestRequested: false
        };

        return qObj;
      });
    }

    res.json(quizzes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create quiz from question bank
router.post('/create-from-bank', auth, authorize('admin'), async (req, res) => {
  try {
    const {
      title,
      subject,       // Can be single subject ID or array of subject IDs
      subjects,      // Alternative: array of subject IDs
      testType,
      numberOfQuestions,
      duration,
      instructions,
      assignedStudents,
      selectedQuestionIds,  // NEW: optional array of specific question IDs for manual selection
      shareSolution,  // NEW: whether to share solutions with students (defaults to true)
      scheduledDate,
      expiryDate
    } = req.body;

    console.log('Creating quiz from bank:', { title, subject, subjects, testType, numberOfQuestions, selectedQuestionIds: selectedQuestionIds?.length, shareSolution });

    const mongoose = require('mongoose');

    // Support both single subject and multiple subjects
    const subjectIds = subjects || (Array.isArray(subject) ? subject : [subject]);

    let questions;

    if (selectedQuestionIds && selectedQuestionIds.length > 0) {
      // Use manually selected questions
      questions = await QuestionBank.find({
        _id: { $in: selectedQuestionIds },
        isActive: true
      });
      console.log(`Using ${questions.length} manually selected questions`);
    } else {
      // Fall back to random sampling (existing logic)
      const questionsPerSubject = Math.ceil(parseInt(numberOfQuestions) / subjectIds.length);

      let allQuestions = [];

      // Get questions from each subject
      for (const subjectId of subjectIds) {
        try {
          const matchStage = { subject: new mongoose.Types.ObjectId(subjectId), isActive: true };
          if (req.body.tags && req.body.tags.length > 0) {
            matchStage.tags = { $in: req.body.tags };
          }
          if (req.body.topics && req.body.topics.length > 0) {
            matchStage.topicName = { $in: req.body.topics };
          }

          const subjectQuestions = await QuestionBank.aggregate([
            { $match: matchStage },
            { $sample: { size: questionsPerSubject } }
          ]);
          allQuestions = allQuestions.concat(subjectQuestions);
        } catch (err) {
          console.error(`Error fetching questions for subject ${subjectId}:`, err);
        }
      }

      // Limit to requested number
      questions = allQuestions.slice(0, parseInt(numberOfQuestions));
    }

    if (questions.length === 0) {
      return res.status(400).json({ message: 'No questions found for the selected subject(s)' });
    }

    if (questions.length < numberOfQuestions) {
      console.log(`Only ${questions.length} questions available, requested ${numberOfQuestions}`);
    }

    // Calculate total marks
    const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);

    // Create quiz - use first subject if multiple
    const quiz = new Quiz({
      title,
      subject: subjectIds[0],
      testType,
      duration: parseInt(duration),
      instructions: instructions || [],
      questions: questions.map(q => q._id),
      totalMarks,
      assignedStudents: assignedStudents || [],
      createdBy: req.user._id,
      shareSolution: shareSolution !== undefined ? shareSolution : true,  // Default to true
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined
    });

    await quiz.save();

    if (assignedStudents && assignedStudents.length > 0) {
      const User = require('../models/User');
      await User.updateMany(
        { _id: { $in: assignedStudents } },
        { $addToSet: { unseenQuizzes: quiz._id } }
      );

      const io = req.app.get('io');
      if (io) {
        io.emit('new_quiz_assigned', { quizId: quiz._id, title: quiz.title, assignedStudents });
      }
    }

    console.log(`Quiz created: ${quiz._id} with ${questions.length} questions from ${subjectIds.length} subjects`);

    res.status(201).json({
      message: 'Quiz created successfully',
      quiz,
      questionCount: questions.length
    });
  } catch (error) {
    console.error('Create quiz error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Import Quiz from Excel
router.post('/import-excel', auth, authorize('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { quizTitle, testType, duration, subjectId, instructions, scheduledDate, expiryDate } = req.body;

    // Parse Excel
    const { questions: parsedQuestions, errors } = await parseExcel(req.file.buffer);

    if (errors.length > 0) {
      return res.status(400).json({
        message: 'Validation errors in Excel file',
        errors: errors.slice(0, 5) // Return first 5 errors
      });
    }

    if (parsedQuestions.length === 0) {
      return res.status(400).json({ message: 'No questions found in Excel file' });
    }

    // Cache subjects to minimize DB calls
    const subjectsMap = {};
    const allSubjects = await Subject.find({});
    allSubjects.forEach(s => subjectsMap[s.name.toLowerCase()] = s._id);

    // Subject alias map: common Excel name variants → canonical DB name (lowercase)
    // This prevents "Unknown subjects" errors when Excel uses long-form names
    const SUBJECT_ALIASES = {
      // OBG / Obstetrics & Gynaecology variants
      'obgyn': 'obgyn',
      'obg': 'obgyn',
      'obstetrics & gynaecology': 'obgyn',
      'obstetrics and gynaecology': 'obgyn',
      'obstetrics & gynecology': 'obgyn',
      'obstetrics and gynecology': 'obgyn',
      'obstetrics gynaecology': 'obgyn',
      'obstetrics gynecology': 'obgyn',
      'ob/gyn': 'obgyn',
      'ob gyn': 'obgyn',
      // ENT variants
      'ent': 'ent',
      'ear nose throat': 'ent',
      'ear, nose & throat': 'ent',
      'otorhinolaryngology': 'ent',
      // FMT / Forensic Medicine variants
      'fmt': 'fmt',
      'forensic medicine': 'fmt',
      'forensic medicine & toxicology': 'fmt',
      'forensic': 'fmt',
      // PSM / Community Medicine variants
      'psm': 'psm',
      'community medicine': 'psm',
      'preventive & social medicine': 'psm',
      'preventive and social medicine': 'psm',
      'social & preventive medicine': 'psm',
      // Orthopaedics variants
      'orthopaedics': 'orthopaedics',
      'orthopedics': 'orthopaedics',
      'ortho': 'orthopaedics',
      // Paediatrics variants
      'paediatrics': 'paediatrics',
      'pediatrics': 'paediatrics',
      'paed': 'paediatrics',
      'peds': 'paediatrics',
      // Ophthalmology variants
      'ophthalmology': 'ophthalmology',
      'opthalmology': 'ophthalmology',
      'eye': 'ophthalmology',
      // Anaesthesia variants
      'anaesthesia': 'anaesthesia',
      'anesthesia': 'anaesthesia',
      'anaesthesiology': 'anaesthesia',
      'anesthesiology': 'anaesthesia',
    };

    // Helper: normalize a subject name from Excel to the canonical DB key
    const normalizeSubjectName = (name) => {
      const lower = name.trim().toLowerCase();
      // Direct match in subjectsMap
      if (subjectsMap[lower]) return lower;
      // Alias lookup
      const aliasTarget = SUBJECT_ALIASES[lower];
      if (aliasTarget && subjectsMap[aliasTarget]) return aliasTarget;
      // Strip special characters and retry (e.g. "obstetrics & gynaecology" → "obstetrics  gynaecology")
      const stripped = lower.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      if (subjectsMap[stripped]) return stripped;
      const aliasStripped = SUBJECT_ALIASES[stripped];
      if (aliasStripped && subjectsMap[aliasStripped]) return aliasStripped;
      return lower; // return original lowercase (will fail validation if not found)
    };

    // Pre-normalize all subject names in parsed questions
    parsedQuestions.forEach(qData => {
      qData._normalizedSubject = normalizeSubjectName(qData.subjectName);
    });

    // Validate subjects before processing
    const invalidSubjects = new Set();
    for (const qData of parsedQuestions) {
      if (!subjectsMap[qData._normalizedSubject]) {
        invalidSubjects.add(qData.subjectName);
      }
    }

    if (invalidSubjects.size > 0) {
      return res.status(400).json({
        message: 'Unknown subjects found in Excel file',
        errors: [`Invalid subjects: ${Array.from(invalidSubjects).join(', ')}. Please use standard subject names.`]
      });
    }


    const questionIds = [];
    const createdQuestions = [];
    let firstSubjectId = subjectId; // Track first subject for quiz creation

    // Stats for preview
    let questionsCreated = 0;
    let duplicatesSkipped = 0;
    let duplicatesUpdated = 0;
    let questionsWithImages = 0;
    const previewQuestions = [];

    // Create Questions with duplicate detection
    for (const qData of parsedQuestions) {
      let subId = subjectsMap[qData._normalizedSubject || qData.subjectName.toLowerCase()];

      // Track first subject for quiz creation
      if (!firstSubjectId) {
        firstSubjectId = subId;
      }

      // Check for duplicate: same question text + same options
      const normalizedQuestion = qData.question.trim().toLowerCase();
      const normalizedOptions = qData.options.map(o => String(o).trim().toLowerCase()).sort().join('|');

      const existingQuestion = await QuestionBank.findOne({
        subject: subId,
        isActive: true,
        $expr: {
          $eq: [{ $toLower: '$question' }, normalizedQuestion]
        }
      });

      // Check if options match
      let isDuplicate = false;
      if (existingQuestion) {
        const existingOptions = existingQuestion.options.map(o => String(o).trim().toLowerCase()).sort().join('|');
        isDuplicate = existingOptions === normalizedOptions;
      }

      const newHasImage = !!(qData.questionImage || qData.optionImages?.some(img => img));

      if (isDuplicate) {
        const existingHasImage = !!(existingQuestion.questionImage || existingQuestion.optionImages?.some(img => img));

        if (newHasImage && !existingHasImage) {
          // Update existing with new images
          existingQuestion.questionImage = qData.questionImage || existingQuestion.questionImage;
          existingQuestion.optionImages = qData.optionImages?.some(img => img) ? qData.optionImages : existingQuestion.optionImages;
          existingQuestion.explanationImage = qData.explanationImage || existingQuestion.explanationImage;
          // Also update tags to include import tag
          existingQuestion.tags = [...new Set([...existingQuestion.tags, ...qData.tags, 'excel-import', `quiz:${quizTitle}`])];
          await existingQuestion.save();

          duplicatesUpdated++;
          questionIds.push(existingQuestion._id);
          createdQuestions.push(existingQuestion);
          if (existingQuestion.questionImage || existingQuestion.optionImages?.some(img => img)) {
            questionsWithImages++;
          }

          previewQuestions.push({
            _id: existingQuestion._id,
            question: existingQuestion.question.substring(0, 100),
            hasQuestionImage: !!existingQuestion.questionImage,
            hasOptionImages: existingQuestion.optionImages?.some(img => img) || false,
            status: 'updated'
          });
        } else {
          // Skip - existing has image or neither has image
          duplicatesSkipped++;
          questionIds.push(existingQuestion._id);
          if (existingQuestion.questionImage || existingQuestion.optionImages?.some(img => img)) {
            questionsWithImages++;
          }

          previewQuestions.push({
            _id: existingQuestion._id,
            question: existingQuestion.question.substring(0, 100),
            hasQuestionImage: !!existingQuestion.questionImage,
            hasOptionImages: existingQuestion.optionImages?.some(img => img) || false,
            status: 'skipped'
          });
        }
      } else {
        // Create new question
        // Upload images to Cloudinary
        console.log(`\n📝 Processing question ${questionsCreated + 1}: ${qData.question.substring(0, 50)}...`);
        const processedQData = await processQuestionImages(qData);

        const question = new QuestionBank({
          subject: subId,
          topicName: processedQData.topicName,
          question: processedQData.question,
          questionImage: processedQData.questionImage,
          options: processedQData.options,
          optionImages: processedQData.optionImages,
          correctAnswer: processedQData.correctAnswer,
          explanation: processedQData.explanation,
          explanationImage: processedQData.explanationImage,
          marks: processedQData.positiveMarks || processedQData.marks || 4,
          positiveMarks: processedQData.positiveMarks !== undefined ? processedQData.positiveMarks : 4,
          negativeMarks: processedQData.negativeMarks !== undefined ? processedQData.negativeMarks : 0,
          tags: [...qData.tags, 'excel-import', `quiz:${quizTitle}`],
          createdBy: req.user._id,
          isActive: true
        });

        await question.save();
        createdQuestions.push(question);
        questionIds.push(question._id);
        questionsCreated++;

        const newHasImage = !!(question.questionImage || question.optionImages?.some(img => img));
        if (newHasImage) questionsWithImages++;

        previewQuestions.push({
          _id: question._id,
          question: question.question.substring(0, 100),
          hasQuestionImage: !!question.questionImage,
          hasOptionImages: question.optionImages?.some(img => img) || false,
          status: 'created'
        });
      }
    }

    // Check for duplicate quiz title
    const existingQuiz = await Quiz.findOne({ title: quizTitle.trim() });
    if (existingQuiz) {
      return res.status(400).json({
        message: `A quiz with the title "${quizTitle}" already exists. Please use a different name.`,
        errorType: 'DUPLICATE_TITLE'
      });
    }

    // Collect all unique subject IDs from the created/linked questions
    const allSubjectIds = [...new Set(
      createdQuestions.map(q => q.subject?.toString()).filter(Boolean)
    )];

    // Create Quiz — use user-selected subject if provided, otherwise first question's subject
    const primarySubjectId = subjectId || firstSubjectId || createdQuestions[0]?.subject;

    const quiz = new Quiz({
      title: quizTitle,
      subject: primarySubjectId,
      testType: testType || 'daily',
      duration: parseInt(duration) || 30,
      instructions: instructions ? JSON.parse(instructions) : [],
      questions: questionIds,
      assignedStudents: [],
      createdBy: req.user._id,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined
    });

    await quiz.save();

    res.status(201).json({
      message: 'Quiz imported successfully',
      quiz,
      stats: {
        total: parsedQuestions.length,
        questionsCreated,
        duplicatesSkipped,
        duplicatesUpdated,
        questionsWithImages
      },
      previewQuestions
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Duplicate Quiz
router.post('/:id/duplicate', auth, authorize('admin'), async (req, res) => {
  try {
    const originalQuiz = await Quiz.findById(req.params.id);
    if (!originalQuiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const newQuiz = new Quiz({
      title: `Copy of ${originalQuiz.title}`,
      subject: originalQuiz.subject,
      testType: originalQuiz.testType,
      duration: originalQuiz.duration,
      instructions: originalQuiz.instructions,
      questions: originalQuiz.questions,
      totalMarks: originalQuiz.totalMarks,
      assignedStudents: [], // Do not copy students
      createdBy: req.user._id,
      isActive: true
    });

    await newQuiz.save();

    res.status(201).json({
      message: 'Quiz duplicated successfully',
      quiz: newQuiz
    });
  } catch (error) {
    console.error('Duplicate error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update Quiz
router.put('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { title, duration, instructions, questions, testType, subject, assignedStudents, shareSolution, scheduledDate, expiryDate } = req.body;

    // Check if quiz exists
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const prevAssigned = quiz.assignedStudents.map(id => id.toString());

    // Optional: Check for attempts if modifying critical fields
    // const attempts = await QuizAttempt.countDocuments({ quiz: req.params.id });
    // if (attempts > 0 && (questions || testType)) {
    //   return res.status(400).json({ message: 'Cannot modify questions/type of a quiz with attempts' });
    // }

    if (title) quiz.title = title;
    if (duration) quiz.duration = parseInt(duration);
    if (instructions) quiz.instructions = instructions;
    if (testType) quiz.testType = testType;
    if (subject) quiz.subject = subject; // Expecting single subject ID or handled by frontend
    if (assignedStudents) quiz.assignedStudents = assignedStudents;
    if (shareSolution !== undefined) quiz.shareSolution = shareSolution;  // Allow toggling solution sharing
    if (scheduledDate) quiz.scheduledDate = new Date(scheduledDate);
    if (expiryDate) quiz.expiryDate = new Date(expiryDate);

    if (questions && questions.length > 0) {
      quiz.questions = questions;

      // Recalculate total marks (optional if we want to be precise)
      const QuestionBank = require('../models/QuestionBank');
      const qs = await QuestionBank.find({ _id: { $in: questions } });
      quiz.totalMarks = qs.reduce((sum, q) => sum + (q.marks || 1), 0);
    }

    await quiz.save();

    if (assignedStudents && assignedStudents.length > 0) {
      const newlyAssigned = assignedStudents.filter(id => !prevAssigned.includes(id.toString()));

      if (newlyAssigned.length > 0) {
        const User = require('../models/User');
        await User.updateMany(
          { _id: { $in: newlyAssigned } },
          { $addToSet: { unseenQuizzes: quiz._id } }
        );

        const io = req.app.get('io');
        if (io) {
          io.emit('new_quiz_assigned', { quizId: quiz._id, title: quiz.title, assignedStudents: newlyAssigned });
        }
      }
    }

    res.json({ message: 'Quiz updated successfully', quiz });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get quiz analytics list
router.get('/analytics/list', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const quizzes = await Quiz.find({ isActive: true })
      .select('title testType assignedStudents')
      .sort({ createdAt: -1 });

    const analyticsList = await Promise.all(quizzes.map(async (quiz) => {
      const attemptCount = await QuizAttempt.countDocuments({
        quiz: quiz._id,
        status: { $in: ['completed', 'auto_submitted'] }
      });

      return {
        _id: quiz._id,
        title: quiz.title,
        testType: quiz.testType,
        assignedCount: quiz.assignedStudents.length,
        attemptCount
      };
    }));

    res.json(analyticsList);
  } catch (error) {
    console.error('Analytics list error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== ENHANCED ANALYTICS ENDPOINTS ====================

// Test-wise student report: all students' marks/correct/incorrect/%/percentile for a specific test
router.get('/analytics/test-report/:testId', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.testId)
      .populate('subject', 'name')
      .populate('questions');
    if (!quiz) return res.status(404).json({ message: 'Test not found' });

    const attempts = await QuizAttempt.find({
      quiz: req.params.testId,
      status: { $in: ['completed', 'auto_submitted'] }
    }).populate('student', 'name email');

    // Calculate percentile ranking
    const sorted = [...attempts].sort((a, b) => (b.marksObtained || 0) - (a.marksObtained || 0));
    const total = sorted.length;

    const students = sorted.map((a, idx) => {
      const correct = a.score || 0;
      const incorrect = (a.totalQuestions || 0) - correct - (a.answers?.filter(ans => ans.selectedAnswer === -1).length || 0);
      const skipped = (a.totalQuestions || 0) - correct - Math.max(0, incorrect);
      const pct = a.totalQuestions > 0 ? Math.round((correct / a.totalQuestions) * 100) : 0;
      // Percentile = percentage of students scored below this student
      const belowCount = sorted.filter(s => (s.marksObtained || 0) < (a.marksObtained || 0)).length;
      const percentile = total > 1 ? Math.round((belowCount / (total - 1)) * 100) : 100;

      return {
        _id: a._id,
        studentName: a.student?.name || 'Unknown',
        studentEmail: a.student?.email || '',
        rank: idx + 1,
        correct,
        incorrect: Math.max(0, incorrect),
        skipped: Math.max(0, skipped),
        marksObtained: a.marksObtained || 0,
        totalMarks: a.totalMarks || 0,
        totalQuestions: a.totalQuestions || 0,
        percentage: pct,
        percentile
      };
    });

    res.json({
      test: {
        _id: quiz._id,
        title: quiz.title,
        subject: quiz.subject?.name || 'General',
        totalMarks: quiz.totalMarks,
        totalQuestions: quiz.questions.length
      },
      students,
      totalAttempted: total,
      totalAssigned: quiz.assignedStudents?.length || 0
    });
  } catch (error) {
    console.error('Test report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// CSV download of test-wise report
router.get('/analytics/test-report/:testId/csv', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.testId)
      .populate('subject', 'name')
      .populate('questions');
    if (!quiz) return res.status(404).json({ message: 'Test not found' });

    const attempts = await QuizAttempt.find({
      quiz: req.params.testId,
      status: { $in: ['completed', 'auto_submitted'] }
    }).populate('student', 'name email');

    const sorted = [...attempts].sort((a, b) => (b.marksObtained || 0) - (a.marksObtained || 0));
    const total = sorted.length;

    // Build CSV
    let csv = 'Rank,Student Name,Email,Correct,Incorrect,Skipped,Marks Obtained,Total Marks,Percentage,Percentile\n';
    sorted.forEach((a, idx) => {
      let correct = a.score || 0;
      let incorrect = 0;
      let skipped = 0;

      // Extract accurate stats from sectionPerformance if they exist
      if (a.sectionPerformance && a.sectionPerformance.length > 0) {
        correct = 0;
        a.sectionPerformance.forEach(s => {
          correct += (s.correct || 0);
          incorrect += (s.incorrect || 0);
          skipped += (s.skipped || 0);
        });
      } else {
        // Fallback for legacy attempts: compute answered questions strictly
        // A question is answered if it exists in the answers array and selectedAnswer is not -1
        const answeredCount = a.answers ? a.answers.filter(ans => ans.selectedAnswer !== undefined && ans.selectedAnswer !== -1).length : 0;
        incorrect = Math.max(0, answeredCount - correct);
        skipped = Math.max(0, (a.totalQuestions || 0) - answeredCount);
      }

      const pct = a.totalQuestions > 0 ? Math.round((correct / a.totalQuestions) * 100) : 0;
      const belowCount = sorted.filter(s => (s.marksObtained || 0) < (a.marksObtained || 0)).length;

      // New Percentile Formula: (Number of Values Below / Total Number of Values) * 100
      const percentile = total > 0 ? Math.round((belowCount / total) * 100) : 0;

      csv += `${idx + 1},"${a.student?.name || 'Unknown'}","${a.student?.email || ''}",${correct},${incorrect},${skipped},${a.marksObtained || 0},${a.totalMarks || 0},${pct}%,${percentile}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${quiz.title.replace(/"/g, '')}_report.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Student subject-wise performance report
router.get('/analytics/student/:studentId/subjects', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const { subject } = req.query; // optional filter
    const filter = {
      student: req.params.studentId,
      status: { $in: ['completed', 'auto_submitted'] }
    };

    const attempts = await QuizAttempt.find(filter)
      .populate({
        path: 'quiz',
        populate: { path: 'subject', select: 'name' }
      })
      .sort({ endTime: -1 });

    // Group by subject
    const subjectMap = {};
    attempts.forEach(a => {
      const subId = a.quiz?.subject?._id?.toString() || 'unknown';
      const subName = a.quiz?.subject?.name || 'General';

      if (subject && subId !== subject) return; // filter by specific subject

      if (!subjectMap[subId]) {
        subjectMap[subId] = {
          subjectId: subId,
          subjectName: subName,
          tests: 0,
          totalMarks: 0,
          obtainedMarks: 0,
          totalCorrect: 0,
          totalQuestions: 0,
          attempts: []
        };
      }
      subjectMap[subId].tests++;
      subjectMap[subId].totalMarks += a.totalMarks || 0;
      subjectMap[subId].obtainedMarks += a.marksObtained || 0;
      subjectMap[subId].totalCorrect += a.score || 0;
      subjectMap[subId].totalQuestions += a.totalQuestions || 0;
      subjectMap[subId].attempts.push({
        _id: a._id,
        quizTitle: a.quiz?.title || 'Untitled',
        quizId: a.quiz?._id,
        testType: a.quiz?.testType || 'daily',
        score: a.score,
        totalQuestions: a.totalQuestions,
        marksObtained: a.marksObtained,
        totalMarks: a.totalMarks,
        percentage: a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0,
        endTime: a.endTime
      });
    });

    // Add percentage to each subject
    const subjects = Object.values(subjectMap).map(s => ({
      ...s,
      percentage: s.totalQuestions > 0 ? Math.round((s.totalCorrect / s.totalQuestions) * 100) : 0
    }));

    res.json({ subjects });
  } catch (error) {
    console.error('Student subject report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Heatmap data: students × tests matrix with % scores
router.get('/analytics/heatmap', auth, authorize('admin'), async (req, res) => {
  try {
    const { subject, limit: lim } = req.query;

    // Get recent quizzes (up to 20)
    const quizFilter = { isActive: true };
    if (subject) quizFilter.subject = subject;
    const quizzes = await Quiz.find(quizFilter)
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .limit(parseInt(lim) || 20)
      .select('title subject totalMarks questions');

    const quizIds = quizzes.map(q => q._id);

    // Get all attempts for these quizzes
    const attempts = await QuizAttempt.find({
      quiz: { $in: quizIds },
      status: { $in: ['completed', 'auto_submitted'] }
    }).populate('student', 'name email');

    // Build student → quiz → % map
    const studentMap = {};
    attempts.forEach(a => {
      const sId = a.student?._id?.toString();
      if (!sId) return;
      if (!studentMap[sId]) {
        studentMap[sId] = {
          studentId: sId,
          studentName: a.student?.name || 'Unknown',
          scores: {}
        };
      }
      const pct = a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0;
      studentMap[sId].scores[a.quiz.toString()] = pct;
    });

    res.json({
      tests: quizzes.map(q => ({
        _id: q._id,
        title: q.title,
        subject: q.subject?.name || 'General'
      })),
      students: Object.values(studentMap)
    });
  } catch (error) {
    console.error('Heatmap error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get detailed quiz analytics
router.get('/analytics/:id', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const quizId = req.params.id;
    const attempts = await QuizAttempt.find({
      quiz: quizId,
      status: { $in: ['completed', 'auto_submitted'] }
    }).populate('student', 'name email');

    if (attempts.length === 0) {
      return res.json({
        totalAttempts: 0,
        averageScore: 0,
        avgCorrect: 0,
        avgTime: 0,
        studentPerformance: []
      });
    }

    let totalScore = 0;
    let totalCorrect = 0;
    let totalTime = 0;

    const studentPerformance = attempts.map(a => {
      const percentage = a.totalMarks > 0 ? (a.marksObtained / a.totalMarks) * 100 : 0;
      totalScore += percentage;
      totalCorrect += a.correctCount || 0;
      totalTime += a.timeTaken || 0;

      return {
        studentId: a.student?._id,
        studentName: a.student?.name || 'Unknown',
        percentage,
        correct: a.correctCount || 0,
        wrong: a.incorrectCount || 0,
        skipped: a.skippedCount || 0,
        timeTaken: a.timeTaken || 0,
        tabSwitchCount: a.tabSwitchCount || 0
      };
    });

    res.json({
      totalAttempts: attempts.length,
      averageScore: totalScore / attempts.length,
      avgCorrect: totalCorrect / attempts.length,
      avgTime: totalTime / attempts.length,
      studentPerformance
    });
  } catch (error) {
    console.error('Quiz analytics detail error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get quiz by ID (student view - for taking the quiz)
router.get('/:id', auth, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('subject', 'name')
      .populate('createdBy', 'name')
      .populate({
        path: 'questions',
        select: 'question options marks positiveMarks negativeMarks topicName questionImage optionImages subject correctAnswer',
        populate: {
          path: 'subject',
          select: 'name'
        }
      });

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Log any questions with missing subject data for debugging
    const questionsWithoutSubject = quiz.questions.filter(q => !q.subject);
    if (questionsWithoutSubject.length > 0) {
      console.warn(`Quiz ${quiz._id}: ${questionsWithoutSubject.length} questions without subject data`);
    }

    // Check access for students
    if (req.user.role === 'student') {
      if (!quiz.assignedStudents.includes(req.user._id)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if already attempted
      const existingAttempt = await QuizAttempt.findOne({
        quiz: quiz._id,
        student: req.user._id
      });

      if (existingAttempt && existingAttempt.status === 'completed' && !existingAttempt.retestApproved) {
        return res.status(400).json({
          message: 'You have already completed this quiz',
          attemptId: existingAttempt._id
        });
      }
    }

    const qObj = quiz.toObject();
    // Compute unique subject names from questions (same logic as list endpoint)
    const names = [...new Set(
      (qObj.questions || [])
        .map(qu => qu.subject?.name)
        .filter(Boolean)
    )];
    qObj.subjectNames = names.length > 0 ? names : (qObj.subject?.name ? [qObj.subject.name] : []);

    res.json(qObj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start quiz attempt
router.post('/:id/start', auth, authorize('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    if (!quiz.assignedStudents.includes(req.user._id)) {
      return res.status(403).json({ message: 'You are not assigned to this quiz' });
    }

    const { formatToIST } = require('../utils/dateUtils');

    // Enforce time window (UTC comparison)
    const now = new Date();
    if (quiz.scheduledDate && now < quiz.scheduledDate) {
      return res.status(403).json({
        message: 'This quiz has not started yet. It opens on ' + formatToIST(quiz.scheduledDate),
        scheduledDate: quiz.scheduledDate
      });
    }
    if (quiz.expiryDate && now > quiz.expiryDate) {
      return res.status(403).json({
        message: 'This quiz has expired. It closed on ' + formatToIST(quiz.expiryDate),
        expiryDate: quiz.expiryDate
      });
    }

    // Check for existing attempt
    let attempt = await QuizAttempt.findOne({
      quiz: quiz._id,
      student: req.user._id,
      status: 'in_progress'
    });

    if (attempt) {
      // Resume existing attempt
      return res.json({
        message: 'Resuming existing attempt',
        attemptId: attempt._id,
        startTime: attempt.startTime,
        answers: attempt.answers
      });
    }

    // Check if completed before
    const completedAttempt = await QuizAttempt.findOne({
      quiz: quiz._id,
      student: req.user._id,
      status: 'completed'
    });

    if (completedAttempt && !completedAttempt.retestApproved) {
      return res.status(400).json({
        message: 'You have already completed this quiz',
        attemptId: completedAttempt._id
      });
    }

    // Create new attempt
    attempt = new QuizAttempt({
      quiz: quiz._id,
      student: req.user._id,
      startTime: new Date(),
      status: 'in_progress',
      answers: [],
      tabSwitchCount: 0
    });

    await attempt.save();

    res.status(201).json({
      message: 'Quiz started',
      attemptId: attempt._id,
      startTime: attempt.startTime
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Log tab switch (for monitoring)
router.post('/:id/attempt/:attemptId/tab-switch', auth, authorize('student'), async (req, res) => {
  try {
    const attempt = await QuizAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    attempt.tabSwitchCount = (attempt.tabSwitchCount || 0) + 1;
    attempt.tabSwitchLog = attempt.tabSwitchLog || [];
    attempt.tabSwitchLog.push(new Date());
    await attempt.save();

    res.json({
      message: 'Tab switch logged',
      count: attempt.tabSwitchCount
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save answer
router.put('/:id/attempt/:attemptId/answer', auth, authorize('student'), async (req, res) => {
  try {
    const { questionIndex, selectedAnswer, markedForReview, timeSpent } = req.body;

    const attempt = await QuizAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id,
      status: 'in_progress'
    });

    if (!attempt) {
      return res.status(404).json({ message: 'No active attempt found' });
    }

    // Find or create answer for this question
    const existingIndex = attempt.answers.findIndex(a => a.questionIndex === questionIndex);

    const answerData = {
      questionIndex,
      selectedAnswer,
      markedForReview: markedForReview || false,
      timeSpent: timeSpent || 0
    };

    if (existingIndex >= 0) {
      attempt.answers[existingIndex] = answerData;
    } else {
      attempt.answers.push(answerData);
    }

    await attempt.save();

    res.json({ message: 'Answer saved' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit quiz
router.post('/:id/attempt/:attemptId/submit', auth, authorize('student'), async (req, res) => {
  try {
    const { isAutoSubmit } = req.body;

    // Detailed logging for debugging
    console.log(`[Submit Quiz] User: ${req.user._id}, Quiz: ${req.params.id}, Attempt: ${req.params.attemptId}, Auto: ${isAutoSubmit}`);

    // Validate attempt exists and belongs to the user
    const attempt = await QuizAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id
    }).populate('quiz');

    if (!attempt) {
      console.error(`[Submit Quiz] Attempt not found: ${req.params.attemptId} for user ${req.user._id}`);
      return res.status(404).json({
        message: 'Quiz attempt not found. Please restart the quiz.',
        errorCode: 'ATTEMPT_NOT_FOUND'
      });
    }

    // Check if already submitted (idempotent behavior)
    if (attempt.status === 'completed' || attempt.status === 'auto_submitted') {
      console.log(`[Submit Quiz] Already submitted: ${attempt._id}, status: ${attempt.status}`);
      return res.json({
        message: 'Quiz already submitted',
        attemptId: attempt._id,
        isAlreadySubmitted: true
      });
    }

    // Validate quiz data
    if (!attempt.quiz || !attempt.quiz._id) {
      console.error(`[Submit Quiz] Invalid quiz reference in attempt ${attempt._id}`);
      return res.status(400).json({
        message: 'Invalid quiz data. Please contact support.',
        errorCode: 'INVALID_QUIZ_DATA'
      });
    }

    const quiz = await Quiz.findById(attempt.quiz._id).populate('questions');
    // Populate subject on each question so section performance uses subject names
    if (quiz && quiz.questions) {
      await QuestionBank.populate(quiz.questions, { path: 'subject', select: 'name' });
    }

    if (!quiz) {
      console.error(`[Submit Quiz] Quiz not found: ${attempt.quiz._id}`);
      return res.status(404).json({
        message: 'Quiz not found. It may have been deleted.',
        errorCode: 'QUIZ_NOT_FOUND'
      });
    }

    if (!quiz.questions || quiz.questions.length === 0) {
      console.error(`[Submit Quiz] Quiz has no questions: ${quiz._id}`);
      return res.status(400).json({
        message: 'Quiz has no questions. Please contact support.',
        errorCode: 'NO_QUESTIONS'
      });
    }

    // Calculate score
    let correctCount = 0;
    let incorrectCount = 0;
    let skippedCount = 0;
    let marksObtained = 0;

    const sectionPerformance = {};

    quiz.questions.forEach((question, index) => {
      const answer = attempt.answers.find(a => a.questionIndex === index);
      const section = question.subject?.name || question.topicName || 'General';

      if (!sectionPerformance[section]) {
        sectionPerformance[section] = {
          sectionName: section,
          correct: 0,
          incorrect: 0,
          skipped: 0,
          timeSpent: 0
        };
      }

      // CRITICAL FIX: Check if question was answered at all
      // Using != null to catch BOTH null and undefined
      const hasAnswer = answer && answer.selectedAnswer != null && answer.selectedAnswer !== -1;

      if (!hasAnswer) {
        // Question was skipped (either never visited OR visited but not answered)
        skippedCount++;
        sectionPerformance[section].skipped++;
        if (answer) answer.isCorrect = false;
      } else if (answer.selectedAnswer === question.correctAnswer) {
        // Correct answer
        correctCount++;
        // Use positiveMarks if available, otherwise fallback to marks or 1
        const points = question.positiveMarks !== undefined ? question.positiveMarks : (question.marks || 1);
        marksObtained += points;
        sectionPerformance[section].correct++;
        answer.isCorrect = true;
      } else {
        // Incorrect answer
        incorrectCount++;
        sectionPerformance[section].incorrect++;
        answer.isCorrect = false;

        // Deduct negative marks (if any)
        // Default to 0 if not set (safe migration for old questions)
        const deduction = question.negativeMarks !== undefined ? Math.abs(question.negativeMarks) : 0;
        marksObtained -= deduction;
      }

      if (answer) {
        sectionPerformance[section].timeSpent += answer.timeSpent || 0;
      }
    });

    // Calculate accuracy for each section before storing
    const sectionPerformanceArray = Object.values(sectionPerformance).map(section => {
      const totalQuestionsInSection = section.correct + section.incorrect + section.skipped;
      const accuracy = totalQuestionsInSection > 0
        ? Math.round((section.correct / totalQuestionsInSection) * 100)
        : 0;

      return {
        ...section,
        accuracy
      };
    });

    // Update attempt
    attempt.status = isAutoSubmit ? 'auto_submitted' : 'completed';
    attempt.endTime = new Date();
    attempt.score = correctCount;
    attempt.totalQuestions = quiz.questions.length;
    attempt.marksObtained = marksObtained;
    attempt.totalMarks = quiz.totalMarks;
    attempt.sectionPerformance = sectionPerformanceArray;

    // SECURITY: Store shareSolution value at submission time for audit trail
    attempt.shareSolutionAtSubmission = quiz.shareSolution !== undefined ? quiz.shareSolution : true;

    await attempt.save();

    console.log(`[Submit Quiz] Successfully submitted: ${attempt._id}, Score: ${correctCount}/${quiz.questions.length}`);

    // Emit quiz_submitted event back to the student
    const io = req.app.get('io');
    if (io) {
      // Find the socket helper to emit.
      const socketHelpers = require('../utils/socket-helpers');
      if (socketHelpers && socketHelpers.emitToUser) {
        socketHelpers.emitToUser(req.user._id.toString(), 'quiz_submitted', {
          quizId: attempt.quiz._id,
          attemptId: attempt._id,
          score: correctCount,
          status: attempt.status
        });
      }
    }

    res.json({
      message: 'Quiz submitted successfully',
      attemptId: attempt._id,
      score: correctCount,
      totalQuestions: quiz.questions.length,
      marksObtained,
      totalMarks: quiz.totalMarks,
      percentage: Math.round((marksObtained / quiz.totalMarks) * 100),
      correctCount,
      incorrectCount,
      skippedCount
    });
  } catch (error) {
    console.error('[Submit Quiz] ERROR:', error);
    console.error('[Submit Quiz] Error stack:', error.stack);

    // Provide more specific error messages
    let errorMessage = 'Failed to submit quiz. Please try again.';
    let statusCode = 500;

    if (error.name === 'ValidationError') {
      errorMessage = 'Invalid quiz data. Please contact support.';
      statusCode = 400;
    } else if (error.name === 'CastError') {
      errorMessage = 'Invalid quiz or attempt ID.';
      statusCode = 400;
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      errorMessage = 'Database connection failed. Please try again.';
      statusCode = 503;
    }

    res.status(statusCode).json({
      message: errorMessage,
      errorCode: error.name || 'UNKNOWN_ERROR'
    });
  }
});

// Get results (after submission) - SECURITY HARDENED
router.get('/:id/attempt/:attemptId/results', auth, async (req, res) => {
  try {
    const { groupBy = 'topic' } = req.query; // subject, tag, or topic

    // Step 1: Populate quiz with questions (QuestionBank docs)
    const attempt = await QuizAttempt.findById(req.params.attemptId)
      .populate({
        path: 'quiz',
        populate: {
          path: 'questions',
          model: 'QuestionBank'
        }
      })
      .populate('student', 'name email');

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    // Step 2: Explicitly populate subject on each question (avoids 3-level deep populate issue)
    if (attempt.quiz && attempt.quiz.questions) {
      await QuestionBank.populate(attempt.quiz.questions, { path: 'subject', select: 'name' });
    }

    // Check access
    if (req.user.role === 'student' && attempt.student._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // SECURITY CRITICAL: Fetch current shareSolution setting dynamically
    // This ensures no cached responses can bypass solution hiding
    const quiz = await Quiz.findById(attempt.quiz._id);
    const shareSolution = quiz.shareSolution !== undefined ? quiz.shareSolution : true;

    // Recalculate section performance based on groupBy parameter
    const sectionPerformance = {};

    attempt.quiz.questions.forEach((q, index) => {
      const answer = attempt.answers.find(a => a.questionIndex === index);

      // Determine section based on groupBy
      let section = 'General';
      if (groupBy === 'subject') {
        section = q.subject?.name || 'General';
      } else if (groupBy === 'tag') {
        // Use first tag if available
        section = (q.tags && q.tags.length > 0) ? q.tags[0] : 'Untagged';
      } else {
        // Default to topic
        section = q.topicName || 'General';
      }

      if (!sectionPerformance[section]) {
        sectionPerformance[section] = {
          sectionName: section,
          correct: 0,
          incorrect: 0,
          skipped: 0,
          timeSpent: 0
        };
      }

      const hasAnswer = answer && answer.selectedAnswer != null && answer.selectedAnswer !== -1;

      if (!hasAnswer) {
        sectionPerformance[section].skipped++;
      } else if (answer.isCorrect) {
        sectionPerformance[section].correct++;
      } else {
        sectionPerformance[section].incorrect++;
      }

      if (answer) {
        sectionPerformance[section].timeSpent += answer.timeSpent || 0;
      }
    });

    // Calculate accuracy for each section
    const sectionPerformanceArray = Object.values(sectionPerformance).map(section => {
      const totalQuestionsInSection = section.correct + section.incorrect + section.skipped;
      const accuracy = totalQuestionsInSection > 0
        ? Math.round((section.correct / totalQuestionsInSection) * 100)
        : 0;

      return {
        ...section,
        accuracy,
        total: totalQuestionsInSection
      };
    });

    // Build question data with conditional solution fields
    const questionsWithAnswers = attempt.quiz.questions.map((q, index) => {
      const userAnswer = attempt.answers.find(a => a.questionIndex === index);

      const baseData = {
        _id: q._id,
        question: q.question,
        questionImage: q.questionImage,
        options: q.options,
        optionImages: q.optionImages,
        marks: q.marks,
        subject: q.subject,
        topicName: q.topicName,
        tags: q.tags,
        userAnswer: userAnswer?.selectedAnswer,
        isCorrect: userAnswer?.isCorrect,
        timeSpent: userAnswer?.timeSpent,
        markedForReview: userAnswer?.markedForReview
      };

      // SECURITY: Only include solution fields if shareSolution is true
      // This prevents solution data leakage even if admin changes setting after submission
      if (shareSolution) {
        baseData.correctAnswer = q.correctAnswer;
        baseData.explanation = q.explanation;
        baseData.explanationImage = q.explanationImage;
      }

      return baseData;
    });

    res.json({
      attempt: {
        _id: attempt._id,
        status: attempt.status,
        startTime: attempt.startTime,
        endTime: attempt.endTime,
        score: attempt.score,
        totalQuestions: attempt.totalQuestions,
        marksObtained: attempt.marksObtained,
        totalMarks: attempt.totalMarks,
        sectionPerformance: sectionPerformanceArray,
        tabSwitchCount: attempt.tabSwitchCount
      },
      quiz: {
        _id: attempt.quiz._id,
        title: attempt.quiz.title,
        subject: attempt.quiz.subject,
        subjectNames: (() => {
          const names = [...new Set(
            (attempt.quiz.questions || [])
              .map(qu => qu.subject?.name)
              .filter(Boolean)
          )];
          return names.length > 0 ? names : (attempt.quiz.subject?.name ? [attempt.quiz.subject.name] : []);
        })(),
        testType: attempt.quiz.testType,
        shareSolution  // IMPORTANT: Send this to frontend for UI decisions
      },
      student: attempt.student,
      questions: questionsWithAnswers,
      groupBy // Send back the grouping method for frontend reference
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Request retest
router.post('/:id/attempt/:attemptId/request-retest', auth, authorize('student'), async (req, res) => {
  try {
    const attempt = await QuizAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    if (attempt.retestRequested) {
      return res.status(400).json({ message: 'Retest already requested' });
    }

    attempt.retestRequested = true;
    attempt.retestRequestedAt = new Date();
    await attempt.save();

    res.json({ message: 'Retest request submitted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pending retest requests (admin)
router.get('/retest-requests/pending', auth, authorize('admin'), async (req, res) => {
  try {
    const requests = await QuizAttempt.find({
      retestRequested: true,
      retestApproved: { $ne: true }
    })
      .populate({
        path: 'quiz',
        select: 'title subject testType questions',
        populate: [
          {
            path: 'questions',
            select: 'subject',
            populate: {
              path: 'subject',
              select: 'name'
            }
          },
          {
            path: 'subject',
            select: 'name'
          }
        ]
      })
      .populate('student', 'name email')
      .sort({ retestRequestedAt: -1 });

    // Compute subjectNames for each request
    const requestsWithSubjects = requests.map(req => {
      const rObj = req.toObject();
      if (rObj.quiz) {
        const names = [...new Set(
          (rObj.quiz.questions || [])
            .map(qu => qu.subject?.name)
            .filter(Boolean)
        )];
        rObj.quiz.subjectNames = names.length > 0 ? names : (rObj.quiz.subject?.name ? [rObj.quiz.subject.name] : []);
        // Remove questions to keep response light
        delete rObj.quiz.questions;
      }
      return rObj;
    });

    res.json(requestsWithSubjects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Approve/reject retest (admin)
router.put('/attempt/:attemptId/retest-decision', auth, authorize('admin'), async (req, res) => {
  try {
    const { approved } = req.body;

    const attempt = await QuizAttempt.findById(req.params.attemptId);

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    if (approved) {
      attempt.retestApproved = true;
      attempt.retestApprovedBy = req.user._id;
      attempt.retestApprovedAt = new Date();
    } else {
      attempt.retestRequested = false; // Clear the request
    }

    await attempt.save();

    res.json({
      message: approved ? 'Retest approved' : 'Retest rejected'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get test list for analytics (admin)
router.get('/analytics/tests/list', auth, authorize('admin'), async (req, res) => {
  try {
    const { search, type } = req.query;

    let query = { isActive: true };

    // Filter by test type if specified
    if (type && ['daily', 'weekly', 'grand'].includes(type)) {
      query.testType = type;
    }

    // Search by title
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const tests = await Quiz.find(query)
      .select('title testType assignedStudents totalMarks createdAt')
      .sort({ createdAt: -1 })
      .lean();

    // Get attempt counts for each test
    const testsWithStats = await Promise.all(
      tests.map(async (test) => {
        const attemptCount = await QuizAttempt.countDocuments({
          quiz: test._id,
          status: { $in: ['completed', 'auto_submitted'] }
        });

        return {
          _id: test._id,
          title: test.title,
          testType: test.testType,
          assignedCount: test.assignedStudents?.length || 0,
          attemptCount,
          totalMarks: test.totalMarks,
          createdAt: test.createdAt
        };
      })
    );

    res.json({ tests: testsWithStats });
  } catch (error) {
    console.error('Get test list error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get comprehensive test analytics (admin)
router.get('/analytics/test/:testId', auth, authorize('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.testId)
      .populate('subject', 'name')
      .populate('questions');

    if (!quiz) {
      return res.status(404).json({ message: 'Test not found' });
    }

    // Get all attempts for this test
    const attempts = await QuizAttempt.find({
      quiz: req.params.testId,
      status: { $in: ['completed', 'auto_submitted'] }
    })
      .populate('student', 'name email')
      .sort({ marksObtained: -1 });

    const totalAssigned = quiz.assignedStudents?.length || 0;
    const totalAttempted = attempts.length;
    const completionRate = totalAssigned > 0 ? Math.round((totalAttempted / totalAssigned) * 100) : 0;

    // Calculate scores
    const scores = attempts.map(a => a.marksObtained || 0);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    // Calculate performance metrics
    const totalQuestions = quiz.questions.length;
    let totalCorrect = 0;
    let totalWrong = 0;
    let totalSkipped = 0;
    let totalTime = 0;

    attempts.forEach(attempt => {
      totalCorrect += attempt.score || 0;
      const answered = (attempt.answers || []).filter(a => a.selectedAnswer !== -1 && a.selectedAnswer !== undefined).length;
      totalWrong += answered - (attempt.score || 0);
      totalSkipped += totalQuestions - answered;
      totalTime += (attempt.endTime - attempt.startTime) / 1000 / 60; // in minutes
    });

    const avgCorrect = attempts.length > 0 ? (totalCorrect / attempts.length).toFixed(1) : 0;
    const avgWrong = attempts.length > 0 ? (totalWrong / attempts.length).toFixed(1) : 0;
    const avgSkipped = attempts.length > 0 ? (totalSkipped / attempts.length).toFixed(1) : 0;
    const avgTime = attempts.length > 0 ? Math.round(totalTime / attempts.length) : 0;

    // Question-wise analytics
    const questionAnalytics = quiz.questions.map((question, index) => {
      let correctCount = 0;
      let wrongCount = 0;
      let skippedCount = 0;

      attempts.forEach(attempt => {
        const answer = attempt.answers.find(a => a.questionIndex === index);
        if (!answer || answer.selectedAnswer === -1 || answer.selectedAnswer === undefined) {
          skippedCount++;
        } else if (answer.selectedAnswer === question.correctAnswer) {
          correctCount++;
        } else {
          wrongCount++;
        }
      });

      const total = attempts.length || 1;
      return {
        questionNumber: index + 1,
        questionText: question.question.substring(0, 100),
        topicName: question.topicName,
        percentCorrect: Math.round((correctCount / total) * 100),
        percentWrong: Math.round((wrongCount / total) * 100),
        percentSkipped: Math.round((skippedCount / total) * 100),
        correctCount,
        wrongCount,
        skippedCount
      };
    });

    // Student performance list
    const studentPerformance = attempts.map(attempt => ({
      _id: attempt._id,
      student: {
        _id: attempt.student._id,
        name: attempt.student.name,
        email: attempt.student.email
      },
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      marksObtained: attempt.marksObtained,
      totalMarks: attempt.totalMarks,
      percentage: attempt.totalMarks ? Math.round((attempt.marksObtained / attempt.totalMarks) * 100) : 0,
      timeSpent: Math.round((attempt.endTime - attempt.startTime) / 1000 / 60), // minutes
      completedAt: attempt.endTime,
      tabSwitchCount: attempt.tabSwitchCount
    }));

    res.json({
      test: {
        _id: quiz._id,
        title: quiz.title,
        subject: quiz.subject,
        testType: quiz.testType,
        totalMarks: quiz.totalMarks,
        totalQuestions
      },
      overview: {
        totalAssigned,
        totalAttempted,
        completionRate,
        avgScore,
        highestScore,
        lowestScore
      },
      performanceMetrics: {
        totalQuestions,
        avgCorrect,
        avgWrong,
        avgSkipped,
        avgTime
      },
      questionAnalytics,
      studentPerformance
    });
  } catch (error) {
    console.error('Get test analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get student analytics (admin)
router.get('/analytics/student/:studentId', auth, authorize('admin'), async (req, res) => {

  try {
    const attempts = await QuizAttempt.find({
      student: req.params.studentId,
      status: { $in: ['completed', 'auto_submitted'] }
    })
      .populate('quiz', 'title subject testType totalMarks')
      .sort({ endTime: -1 });

    // Calculate aggregate stats
    const totalTests = attempts.length;
    const totalMarks = attempts.reduce((sum, a) => sum + (a.totalMarks || 0), 0);
    const obtainedMarks = attempts.reduce((sum, a) => sum + (a.marksObtained || 0), 0);
    const avgPercentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : 0;

    // Subject-wise breakdown
    const subjectWise = {};
    attempts.forEach(a => {
      const subjectId = a.quiz?.subject?.toString() || 'unknown';
      if (!subjectWise[subjectId]) {
        subjectWise[subjectId] = {
          tests: 0,
          totalMarks: 0,
          obtainedMarks: 0
        };
      }
      subjectWise[subjectId].tests++;
      subjectWise[subjectId].totalMarks += a.totalMarks || 0;
      subjectWise[subjectId].obtainedMarks += a.marksObtained || 0;
    });

    res.json({
      summary: {
        totalTests,
        totalMarks,
        obtainedMarks,
        avgPercentage
      },
      attempts: attempts.map(a => ({
        _id: a._id,
        quiz: a.quiz,
        score: a.score,
        totalQuestions: a.totalQuestions,
        marksObtained: a.marksObtained,
        totalMarks: a.totalMarks,
        percentage: a.totalMarks ? Math.round((a.marksObtained / a.totalMarks) * 100) : 0,
        endTime: a.endTime,
        tabSwitchCount: a.tabSwitchCount
      })),
      subjectWise
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Share quiz with additional students (for Past Tests feature)
router.put('/:id/share', auth, authorize('admin'), async (req, res) => {
  try {
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'Please provide student IDs to share with' });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Add new students (avoid duplicates)
    const currentStudents = quiz.assignedStudents.map(s => s.toString());
    const newStudents = studentIds.filter(id => !currentStudents.includes(id));

    if (newStudents.length === 0) {
      return res.json({
        message: 'All selected students already have access to this quiz',
        totalStudents: quiz.assignedStudents.length
      });
    }

    quiz.assignedStudents = [...quiz.assignedStudents, ...newStudents];
    await quiz.save();

    if (newStudents.length > 0) {
      const User = require('../models/User');
      await User.updateMany(
        { _id: { $in: newStudents } },
        { $addToSet: { unseenQuizzes: quiz._id } }
      );

      const io = req.app.get('io');
      if (io) {
        io.emit('new_quiz_assigned', { quizId: quiz._id, title: quiz.title, assignedStudents: newStudents });
      }
    }

    res.json({
      message: `Quiz shared with ${newStudents.length} additional student(s)`,
      totalStudents: quiz.assignedStudents.length,
      newlyAdded: newStudents.length
    });
  } catch (error) {
    console.error('Share quiz error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============ PUBLIC SHARING ENDPOINTS ============

// Generate public share link
router.post('/:id/generate-share-link', auth, authorize('admin'), async (req, res) => {
  try {
    const { expiryDays } = req.body; // Optional: number of days until link expires

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Generate unique share token
    const shareToken = crypto.randomBytes(16).toString('hex');

    quiz.shareToken = shareToken;
    quiz.isPublic = true;

    // Set expiry if provided
    if (expiryDays && expiryDays > 0) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDays));
      quiz.publicExpiryDate = expiryDate;
    } else {
      quiz.publicExpiryDate = null; // No expiry
    }

    await quiz.save();

    // Generate the deep link URL (HTTPS redirect for better sharing)
    // Use the request host to construct the URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const shareUrl = `${baseUrl}/api/public/share/${shareToken}`;

    res.json({
      success: true,
      message: 'Share link generated successfully',
      shareToken,
      shareUrl,
      expiryDate: quiz.publicExpiryDate
    });
  } catch (error) {
    console.error('Generate share link error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Revoke public share link
router.post('/:id/revoke-share-link', auth, authorize('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    quiz.shareToken = null;
    quiz.isPublic = false;
    quiz.publicExpiryDate = null;

    await quiz.save();

    res.json({
      success: true,
      message: 'Share link revoked successfully'
    });
  } catch (error) {
    console.error('Revoke share link error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get share status for a quiz
router.get('/:id/share-status', auth, authorize('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .select('shareToken isPublic publicExpiryDate');

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    res.json({
      isPublic: quiz.isPublic,
      shareToken: quiz.shareToken,
      shareUrl: quiz.shareToken ? `mentorship://quiz/${quiz.shareToken}` : null,
      publicExpiryDate: quiz.publicExpiryDate,
      isExpired: quiz.publicExpiryDate ? new Date() > quiz.publicExpiryDate : false
    });
  } catch (error) {
    console.error('Get share status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get attempt details by ID (used for retrieving quizId)
router.get('/attempt/:id', auth, async (req, res) => {
  try {
    const attempt = await QuizAttempt.findById(req.params.id);
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }
    res.json(attempt);
  } catch (error) {
    console.error('Get attempt error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;