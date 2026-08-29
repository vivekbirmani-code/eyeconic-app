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
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const User = require('../models/User');
const { sendPushToUser } = require('../utils/notifications');
const { gradeQuestion, isAnswered } = require('../utils/grading');
const { buildMetadataSnapshot } = require('../utils/questionSnapshot');
const {
  computeAttemptStats,
  computeQuestionAnalytics,
  findEasiestHardestQuestions,
  computeScoreDistribution,
  computeTestOverview,
  computePerformanceMetricsAverages,
  computePercentile,
  rankStudentAttempts,
  filterAttemptsByDateRange,
  aggregateStudentSummary,
  aggregateSubjectStats,
  computePerformanceBuckets,
  computeStrengthsWeaknesses,
  computeTrend,
  computeInsights,
  computeMarksAwarded,
  resolveQuestionType,
  classifyAnswer,
  getAttemptDurationMinutes,
  computeScorePercentage,
} = require('../utils/analytics');
const {
  aggregateQuestionHistoryForStudent,
  getFrequentlyMissedQuestions,
  computeTimeTakenSeconds,
  isAnswerRecorded,
} = require('../utils/questionHistory');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const roundTo2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').trim();
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsvRow = (values) => values.map(csvEscape).join(',');

const optionLabelFromIndex = (index) => {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return '';
  return String.fromCharCode(65 + idx); // 0 -> A, 1 -> B, ...
};

const optionTextFromIndex = (options, index) => {
  const idx = Number(index);
  if (!Array.isArray(options) || !Number.isInteger(idx) || idx < 0 || idx >= options.length) {
    return '';
  }
  return options[idx] || '';
};

const formatAnswerForDisplay = (questionType, selectedAnswer, options = [], columnA = [], columnB = []) => {
  if (!isAnswerRecorded(selectedAnswer)) {
    return { label: 'Not answered', text: 'Not answered' };
  }

  switch (questionType) {
    case 'multiple_correct': {
      const indices = Array.isArray(selectedAnswer) ? selectedAnswer : [];
      const labels = indices.map((idx) => optionLabelFromIndex(idx));
      const texts = indices.map((idx) => optionTextFromIndex(options, idx));
      return {
        label: labels.join(', ') || 'Not answered',
        text: texts.filter(Boolean).join('; ') || labels.join(', '),
      };
    }
    case 'match_the_following': {
      if (!selectedAnswer || typeof selectedAnswer !== 'object') {
        return { label: 'Not answered', text: 'Not answered' };
      }
      const pairs = Object.entries(selectedAnswer).map(([aIdx, bIdx]) => {
        const left = columnA[Number(aIdx)] || `Item ${Number(aIdx) + 1}`;
        const right = columnB[Number(bIdx)] || optionLabelFromIndex(Number(bIdx));
        return `${left} → ${right}`;
      });
      return { label: pairs.join(', '), text: pairs.join('; ') };
    }
    case 'numerical':
      return { label: String(selectedAnswer), text: String(selectedAnswer) };
    default: {
      const idx = Number(selectedAnswer);
      const label = optionLabelFromIndex(idx);
      const text = optionTextFromIndex(options, idx);
      return { label: label || String(selectedAnswer), text: text || label };
    }
  }
};

const buildSubmitResponsePayload = (attempt, quiz, stats) => ({
  message: 'Quiz submitted successfully',
  attemptId: attempt._id,
  isAlreadySubmitted: false,
  score: stats.correct,
  totalQuestions: stats.totalQuestions,
  marksObtained: roundTo2(attempt.marksObtained),
  totalMarks: attempt.totalMarks,
  scorePercentage: stats.scorePercentage,
  percentage: stats.scorePercentage ?? 0,
  accuracy: stats.accuracy,
  correctCount: stats.correct,
  incorrectCount: stats.incorrect,
  skippedCount: stats.skipped,
  attemptedCount: stats.attempted,
  markedForReviewCount: Array.isArray(attempt.answers)
    ? attempt.answers.filter((answer) => answer.markedForReview).length
    : 0,
  timeTakenSeconds: computeTimeTakenSeconds(attempt),
  status: attempt.status,
});

const notifyQuizAssignedToStudents = async ({ studentIds, quiz, assignedByName = 'Admin' }) => {
  if (!Array.isArray(studentIds) || studentIds.length === 0 || !quiz?._id) return;

  try {
    const recipients = await User.find({
      _id: { $in: studentIds },
      $or: [{ pushToken: { $ne: null } }, { fcmToken: { $ne: null } }]
    }).select('_id pushToken fcmToken');

    if (!recipients.length) return;

    await Promise.allSettled(
      recipients.map((student) =>
        sendPushToUser({
          expoPushToken: student.pushToken,
          fcmToken: student.fcmToken,
          title: 'New Test Assigned',
          body: `${quiz.title} has been assigned to you`,
          data: {
            type: 'quiz_assigned',
            quizId: quiz._id.toString(),
            quizTitle: quiz.title,
            testType: quiz.testType || 'daily',
            assignedBy: assignedByName,
          },
        })
      )
    );
  } catch (error) {
    console.error('Failed to send quiz assignment push notifications:', error);
  }
};

// Normalizes sections and ensures question assignment exists for mixed sections.
const deriveSectionsForQuestions = (rawSections, rawQuestionIds, totalDuration, options = {}) => {
  const { strictDuration = true } = options;

  if (rawSections === undefined || rawSections === null || rawSections === '') {
    return { sections: [] };
  }

  let parsedSections = rawSections;
  if (typeof parsedSections === 'string') {
    try {
      parsedSections = JSON.parse(parsedSections);
    } catch {
      return { error: 'Invalid sections payload' };
    }
  }

  if (!Array.isArray(parsedSections)) {
    return { error: 'Sections must be an array' };
  }

  const questionIds = (rawQuestionIds || []).map(toIdString).filter(Boolean);
  const questionIdSet = new Set(questionIds);

  const sections = parsedSections.map((section, index) => ({
    name: String(section?.name || `Section ${index + 1}`).trim(),
    duration: Number(section?.duration) || 0,
    selectionType: section?.selectionType === 'manual' ? 'manual' : 'mixed',
    questions: Array.isArray(section?.questions)
      ? section.questions.map(toIdString).filter(id => id && questionIdSet.has(id))
      : []
  }));

  // Prevent duplicate question assignment across sections.
  const questionOwners = new Map();
  for (const section of sections) {
    const uniqueInSection = [...new Set(section.questions)];
    section.questions = uniqueInSection;

    for (const qid of uniqueInSection) {
      const owner = questionOwners.get(qid);
      if (owner) {
        return {
          error: `Question ${qid} is assigned to multiple sections (${owner} and ${section.name}).`
        };
      }
      questionOwners.set(qid, section.name);
    }
  }

  const invalidSection = sections.find(section => !section.name || section.duration <= 0);
  if (invalidSection) {
    return { error: 'Each section needs a valid name and duration' };
  }

  if (strictDuration && Number.isFinite(totalDuration) && totalDuration > 0) {
    const allocated = sections.reduce((sum, section) => sum + section.duration, 0);
    if (allocated !== totalDuration) {
      return {
        error: `Section duration total (${allocated}) must match quiz duration (${totalDuration})`
      };
    }
  }

  const mixedSections = sections.filter(section => section.selectionType === 'mixed');
  const assignedIds = new Set(
    sections.flatMap(section => section.questions).filter(id => questionIdSet.has(id))
  );
  const unassignedIds = questionIds.filter(id => !assignedIds.has(id));

  if (mixedSections.length > 0) {
    const qPerSection = Math.floor(unassignedIds.length / mixedSections.length);
    const remainder = unassignedIds.length % mixedSections.length;

    let startIndex = 0;
    mixedSections.forEach((section, idx) => {
      const count = qPerSection + (idx < remainder ? 1 : 0);
      const sectionQuestions = unassignedIds.slice(startIndex, startIndex + count);
      section.questions.push(...sectionQuestions);
      startIndex += count;
    });
  } else if (sections.length > 0 && unassignedIds.length > 0) {
    return {
      error: `All quiz questions must be assigned to sections. ${unassignedIds.length} question(s) are unassigned.`
    };
  }

  sections.forEach(section => {
    section.questions = [...new Set(section.questions)];
  });

  return { sections };
};

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
    }).populate('student', 'name email profilePicture').populate('quiz', 'title');
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
      // Mentor sees quizzes they created OR are assigned to
      quizzes = await Quiz.find({ 
        isActive: true,
        $or: [
          { createdBy: req.user._id },
          { assignedMentors: req.user._id }
        ]
      })
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
      // Student sees only quizzes assigned to them (or free quizzes for free users)
      const studentQuery = {
        isActive: true,
        $or: [
          { assignedStudents: req.user._id }
        ]
      };
      
      if (req.user.isFreeUser) {
        studentQuery.$or.push({ assignToAllFreeUsers: true });
      }

      quizzes = await Quiz.find(studentQuery)
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
      positiveMarks,
      negativeMarks,
      scheduledDate,
      expiryDate,
      sections,
      assignedMentors
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
          if (req.body.subtopics && req.body.subtopics.length > 0) {
            matchStage.subtopicName = { $in: req.body.subtopics };
          }
          if (req.body.systems && req.body.systems.length > 0) {
            matchStage.system = { $in: req.body.systems };
          }
          if (req.body.questionTypes && req.body.questionTypes.length > 0) {
            matchStage.questionType = { $in: req.body.questionTypes };
          }
          if (req.body.difficulties && req.body.difficulties.length > 0) {
            matchStage.difficulty = { $in: req.body.difficulties };
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

    const questionIds = questions.map(q => q._id);

    const sectionResult = deriveSectionsForQuestions(
      sections,
      questionIds,
      parseInt(duration)
    );
    if (sectionResult.error) {
      return res.status(400).json({ message: sectionResult.error });
    }

    // Calculate total marks
    const totalMarks = questions.length * (positiveMarks !== undefined ? positiveMarks : 4);

    const assignToAllFreeUsers = req.body.assignToAllFreeUsers === true;

    // Create quiz - use first subject if multiple
    const quiz = new Quiz({
      title,
      subject: subjectIds[0],
      testType,
      duration: parseInt(duration),
      instructions: instructions || [],
      questions: questionIds,
      totalMarks,
      positiveMarks: positiveMarks !== undefined ? positiveMarks : 4,
      negativeMarks: negativeMarks !== undefined ? negativeMarks : 1,
      assignedStudents: assignedStudents || [],
      createdBy: req.user._id,
      shareSolution: shareSolution !== undefined ? shareSolution : true,  // Default to true
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      sections: sectionResult.sections,
      assignedMentors: assignedMentors || [],
      assignToAllFreeUsers
    });

    await quiz.save();

    let finalStudentIds = [...(assignedStudents || [])];
    if (assignToAllFreeUsers) {
      console.log('Backend quizzes: assignToAllFreeUsers is true. Querying free users...');
      const freeUsers = await User.find({ role: 'student', isFreeUser: true }).select('_id');
      console.log('Backend quizzes: Found free users count:', freeUsers.length);
      const freeUserIds = freeUsers.map(u => u._id.toString());
      finalStudentIds = Array.from(new Set([...finalStudentIds, ...freeUserIds]));
      quiz.assignedStudents = finalStudentIds;
      await quiz.save();
    }

    if (finalStudentIds.length > 0) {
      const User = require('../models/User');
      await User.updateMany(
        { _id: { $in: finalStudentIds } },
        { $addToSet: { unseenQuizzes: quiz._id } }
      );

      const io = req.app.get('io');
      if (io) {
        io.emit('new_quiz_assigned', { quizId: quiz._id, title: quiz.title, assignedStudents: finalStudentIds });
      }

      await notifyQuizAssignedToStudents({
        studentIds: finalStudentIds,
        quiz,
        assignedByName: req.user?.name || 'Admin'
      });
    }

    if (assignedMentors && assignedMentors.length > 0) {
      const User = require('../models/User');
      await User.updateMany(
        { _id: { $in: assignedMentors } },
        { $addToSet: { unseenQuizzes: quiz._id } }
      );
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

    const { quizTitle, testType, duration, subjectId, instructions, scheduledDate, expiryDate, positiveMarks, negativeMarks, sections } = req.body;

    // Parse Excel
    const { questions: parsedQuestions, errors } = await parseExcel(req.file.buffer);

    if (errors.length > 0) {
      const { buildImportValidationPayload } = require('../utils/importErrors');
      return res.status(400).json(buildImportValidationPayload(errors.slice(0, 50), {
        totalErrors: errors.length,
      }));
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

      // Check for duplicate: same question text + same options (types without
      // options, e.g. numerical/match_the_following, are matched on text +
      // questionType only)
      const normalizedQuestion = qData.question.trim().toLowerCase();
      const normalizedOptions = (qData.options || []).map(o => String(o).trim().toLowerCase()).sort().join('|');

      const existingQuestion = await QuestionBank.findOne({
        subject: subId,
        isActive: true,
        $expr: {
          $eq: [{ $toLower: '$question' }, normalizedQuestion]
        }
      });

      // Check if options match (or, for optionless types, that the question type matches)
      let isDuplicate = false;
      if (existingQuestion) {
        if (!qData.options || qData.options.length === 0) {
          isDuplicate = existingQuestion.questionType === qData.questionType;
        } else {
          const existingOptions = (existingQuestion.options || []).map(o => String(o).trim().toLowerCase()).sort().join('|');
          isDuplicate = existingOptions === normalizedOptions;
        }
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
          subtopicName: qData.subtopicName,
          system: qData.system,
          questionType: qData.questionType,
          difficulty: qData.difficulty,
          question: processedQData.question,
          questionImage: processedQData.questionImage,
          options: processedQData.options,
          optionImages: processedQData.optionImages,
          assertion: qData.assertion,
          reason: qData.reason,
          columnA: qData.columnA,
          columnB: qData.columnB,
          correctAnswer: processedQData.correctAnswer !== undefined ? processedQData.correctAnswer : qData.correctAnswer,
          explanation: processedQData.explanation,
          explanationImage: processedQData.explanationImage,
          tags: [...(qData.tags || []), 'excel-import', `quiz:${quizTitle}`],
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

    const sectionResult = deriveSectionsForQuestions(
      sections,
      questionIds,
      parseInt(duration) || 30
    );
    if (sectionResult.error) {
      return res.status(400).json({ message: sectionResult.error });
    }

    // Create Quiz — use user-selected subject if provided, otherwise first question's subject
    const primarySubjectId = subjectId || firstSubjectId || createdQuestions[0]?.subject;

    const quiz = new Quiz({
      title: quizTitle,
      subject: primarySubjectId,
      testType: testType || 'daily',
      duration: parseInt(duration) || 30,
      instructions: instructions ? JSON.parse(instructions) : [],
      questions: questionIds,
      positiveMarks: positiveMarks !== undefined ? parseFloat(positiveMarks) : 4,
      negativeMarks: negativeMarks !== undefined ? parseFloat(negativeMarks) : 1,
      assignedStudents: [],
      createdBy: req.user._id,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      sections: sectionResult.sections
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
    const { title, duration, instructions, questions, testType, subject, assignedStudents, assignedMentors, shareSolution, assignToAllFreeUsers, scheduledDate, expiryDate, positiveMarks, negativeMarks, sections } = req.body;

    // Check if quiz exists
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const prevAssigned = quiz.assignedStudents.map(id => id.toString());
    const prevAssignedMentors = quiz.assignedMentors.map(id => id.toString());

    // Optional: Check for attempts if modifying critical fields
    // const attempts = await QuizAttempt.countDocuments({ quiz: req.params.id });
    // if (attempts > 0 && (questions || testType)) {
    //   return res.status(400).json({ message: 'Cannot modify questions/type of a quiz with attempts' });
    // }

    if (title) quiz.title = title;
    if (duration !== undefined) {
      const parsedDuration = parseInt(duration, 10);
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        return res.status(400).json({ message: 'Quiz duration must be greater than 0 minutes' });
      }
      quiz.duration = parsedDuration;
    }
    if (instructions) quiz.instructions = instructions;
    if (testType) quiz.testType = testType;
    if (subject) quiz.subject = subject; // Expecting single subject ID or handled by frontend
    
    if (assignToAllFreeUsers !== undefined) {
      quiz.assignToAllFreeUsers = assignToAllFreeUsers === true;
    }

    let finalAssignedStudents = assignedStudents;
    if (quiz.assignToAllFreeUsers) {
      const User = require('../models/User');
      const freeUsers = await User.find({ role: 'student', isFreeUser: true }).select('_id');
      const freeUserIds = freeUsers.map(u => u._id.toString());
      finalAssignedStudents = Array.from(new Set([...(assignedStudents || quiz.assignedStudents.map(s => s.toString())), ...freeUserIds]));
    }

    if (finalAssignedStudents) quiz.assignedStudents = finalAssignedStudents;
    if (assignedMentors) quiz.assignedMentors = assignedMentors;
    if (shareSolution !== undefined) quiz.shareSolution = shareSolution;  // Allow toggling solution sharing
    if (scheduledDate) quiz.scheduledDate = new Date(scheduledDate);
    if (expiryDate) quiz.expiryDate = new Date(expiryDate);
    if (positiveMarks !== undefined) quiz.positiveMarks = positiveMarks;
    if (negativeMarks !== undefined) quiz.negativeMarks = negativeMarks;

    if (questions && questions.length > 0) {
      quiz.questions = questions;

      // Recalculate total marks (optional if we want to be precise)
      quiz.totalMarks = questions.length * (quiz.positiveMarks || 4);
    }

    if (sections !== undefined) {
      const activeQuestionIds = (questions && questions.length > 0)
        ? questions
        : (quiz.questions || []).map(id => toIdString(id));
      const sectionResult = deriveSectionsForQuestions(
        sections,
        activeQuestionIds,
        quiz.duration
      );
      if (sectionResult.error) {
        return res.status(400).json({ message: sectionResult.error });
      }
      quiz.sections = sectionResult.sections;
    }

    await quiz.save();

    if (finalAssignedStudents && finalAssignedStudents.length > 0) {
      const newlyAssigned = finalAssignedStudents.filter(id => !prevAssigned.includes(id.toString()));

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

        await notifyQuizAssignedToStudents({
          studentIds: newlyAssigned,
          quiz,
          assignedByName: req.user?.name || 'Admin'
        });
      }
    }

    if (assignedMentors && assignedMentors.length > 0) {
      const newlyAssignedMentors = assignedMentors.filter(id => !prevAssignedMentors.includes(id.toString()));

      if (newlyAssignedMentors.length > 0) {
        const User = require('../models/User');
        await User.updateMany(
          { _id: { $in: newlyAssignedMentors } },
          { $addToSet: { unseenQuizzes: quiz._id } }
        );
      }
    }

    res.json({ message: 'Quiz updated successfully', quiz });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get quiz analytics list (already has mentor auth but no filtering)
router.get('/analytics/list', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const quizzes = await Quiz.find({ isActive: true })
      .select('title testType assignedStudents')
      .sort({ createdAt: -1 });

    let mentorStudentIds = [];
    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      mentorStudentIds = assignments.map(a => a.student.toString());
    }

    const analyticsList = await Promise.all(quizzes.map(async (quiz) => {
      let attemptQuery = {
        quiz: quiz._id,
        status: { $in: ['completed', 'auto_submitted'] }
      };

      if (req.user.role === 'mentor') {
        attemptQuery.student = { $in: mentorStudentIds };
      }

      const attemptCount = await QuizAttempt.countDocuments(attemptQuery);

      let assignedCount = quiz.assignedStudents?.length || 0;
      if (req.user.role === 'mentor') {
        if (quiz.assignedStudents && quiz.assignedStudents.length > 0) {
          assignedCount = quiz.assignedStudents.filter(id => mentorStudentIds.includes(id.toString())).length;
        } else {
          assignedCount = mentorStudentIds.length;
        }
      }

      return {
        _id: quiz._id,
        title: quiz.title,
        testType: quiz.testType,
        assignedCount,
        attemptCount
      };
    }));

    let resultAnalytics = analyticsList;
    if (req.user.role === 'mentor') {
      resultAnalytics = analyticsList.filter(t => t.assignedCount > 0 || t.attemptCount > 0);
    }

    res.json(resultAnalytics);
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

    const attemptQuery = {
      quiz: req.params.testId,
      status: { $in: ['completed', 'auto_submitted'] }
    };

    let totalAssigned = quiz.assignedStudents?.length || 0;

    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      const mentorStudentIds = assignments.map(a => a.student.toString());
      attemptQuery.student = { $in: mentorStudentIds };

      if (quiz.assignedStudents && quiz.assignedStudents.length > 0) {
        totalAssigned = quiz.assignedStudents.filter(id => mentorStudentIds.includes(id.toString())).length;
      } else {
        totalAssigned = mentorStudentIds.length;
      }
    }

    const attempts = await QuizAttempt.find(attemptQuery).populate('student', 'name email profilePicture');
    const sorted = [...attempts].sort((a, b) => (b.marksObtained || 0) - (a.marksObtained || 0));
    const total = sorted.length;
    const ranked = rankStudentAttempts(sorted, quiz.questions);

    const students = ranked.map((entry) => ({
      _id: entry._id,
      studentName: entry.studentName,
      studentEmail: entry.studentEmail,
      rank: entry.rank,
      correct: entry.correct,
      incorrect: entry.incorrect,
      skipped: entry.skipped,
      attempted: entry.attempted,
      marksObtained: entry.marksObtained,
      totalMarks: entry.totalMarks,
      totalQuestions: entry.totalQuestions,
      scorePercentage: entry.scorePercentage,
      accuracy: entry.accuracy,
      percentage: entry.percentage,
      percentile: computePercentile(sorted, sorted.find(a => String(a._id) === String(entry._id)), { excludeSelf: true })
    }));

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
      totalAssigned
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

    const attemptQuery = {
      quiz: req.params.testId,
      status: { $in: ['completed', 'auto_submitted'] }
    };

    let totalAssigned = quiz.assignedStudents?.length || 0;

    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      const mentorStudentIds = assignments.map(a => a.student.toString());
      attemptQuery.student = { $in: mentorStudentIds };

      if (quiz.assignedStudents && quiz.assignedStudents.length > 0) {
        totalAssigned = quiz.assignedStudents.filter(id => mentorStudentIds.includes(id.toString())).length;
      } else {
        totalAssigned = mentorStudentIds.length;
      }
    }

    const attempts = await QuizAttempt.find(attemptQuery).populate('student', 'name email profilePicture');
    const sorted = [...attempts].sort((a, b) => (b.marksObtained || 0) - (a.marksObtained || 0));
    const total = sorted.length;
    const quizQuestionCount = quiz.questions.length || 0;
    const completionRate = totalAssigned > 0 ? Math.round((total / totalAssigned) * 100) : 0;
    const marksList = sorted.map(a => Number(a.marksObtained || 0));
    const avgScore = marksList.length > 0 ? roundTo2(marksList.reduce((sum, val) => sum + val, 0) / marksList.length) : 0;
    const highestScore = marksList.length > 0 ? roundTo2(Math.max(...marksList)) : 0;
    const lowestScore = marksList.length > 0 ? roundTo2(Math.min(...marksList)) : 0;

    const getAttemptStats = (attempt) => computeAttemptStats(attempt, quiz.questions);

    let sumCorrect = 0;
    let sumWrong = 0;
    let sumSkipped = 0;
    let sumTimeMinutes = 0;

    sorted.forEach((attempt) => {
      const stats = getAttemptStats(attempt);
      sumCorrect += stats.correct;
      sumWrong += stats.incorrect;
      sumSkipped += stats.skipped;

      if (attempt.startTime && attempt.endTime) {
        sumTimeMinutes += Math.max(0, (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000 / 60);
      }
    });

    const avgCorrect = total > 0 ? roundTo2(sumCorrect / total) : 0;
    const avgWrong = total > 0 ? roundTo2(sumWrong / total) : 0;
    const avgSkipped = total > 0 ? roundTo2(sumSkipped / total) : 0;
    const avgTime = total > 0 ? roundTo2(sumTimeMinutes / total) : 0;

    const questionAnalytics = computeQuestionAnalytics(sorted, quiz.questions).map((q) => {
      const question = quiz.questions[q.questionNumber - 1];
      const options = Array.isArray(question?.options) ? question.options : [];
      return {
        ...q,
        subjectName: q.subjectName || quiz.subject?.name || 'General',
        topicName: q.topicName || question?.topicName || '',
        questionText: question?.question || '',
        optionA: options[0] || '',
        optionB: options[1] || '',
        optionC: options[2] || '',
        optionD: options[3] || '',
        correctOptionLabel: optionLabelFromIndex(question?.correctAnswer),
        correctOptionText: optionTextFromIndex(options, question?.correctAnswer),
        wrongCount: q.wrongCount,
      };
    });

    const csvLines = [];
    const generatedAt = new Date().toISOString();
    const subjectName = quiz.subject?.name || 'General';
    const testType = quiz.testType || 'N/A';

    csvLines.push(toCsvRow(['Test Report']));
    csvLines.push(toCsvRow(['Generated At', generatedAt]));
    csvLines.push('');

    csvLines.push(toCsvRow(['Test Details']));
    csvLines.push(toCsvRow(['Test ID', 'Title', 'Subject', 'Test Type', 'Total Questions', 'Total Marks']));
    csvLines.push(toCsvRow([
      String(quiz._id),
      quiz.title || '',
      subjectName,
      testType,
      quizQuestionCount,
      roundTo2(quiz.totalMarks || 0)
    ]));
    csvLines.push('');

    csvLines.push(toCsvRow(['Overview']));
    csvLines.push(toCsvRow(['Total Assigned', 'Total Attempted', 'Completion Rate (%)', 'Avg Score', 'Highest Score', 'Lowest Score']));
    csvLines.push(toCsvRow([
      totalAssigned,
      total,
      completionRate,
      avgScore,
      highestScore,
      lowestScore
    ]));
    csvLines.push('');

    csvLines.push(toCsvRow(['Performance Metrics']));
    csvLines.push(toCsvRow(['Avg Correct', 'Avg Wrong', 'Avg Skipped', 'Avg Time (min)']));
    csvLines.push(toCsvRow([avgCorrect, avgWrong, avgSkipped, avgTime]));
    csvLines.push('');

    csvLines.push(toCsvRow(['Student Performance']));
    csvLines.push(toCsvRow([
      'Rank',
      'Attempt ID',
      'Student ID',
      'Student Name',
      'Student Email',
      'Correct',
      'Incorrect',
      'Skipped',
      'Answered',
      'Accuracy (%)',
      'Score Percentage (%)',
      'Score',
      'Total Questions',
      'Marks Obtained',
      'Total Marks',
      'Percentage (%)',
      'Percentile',
      'Time Spent (min)',
      'Tab Switch Count',
      'Status',
      'Started At',
      'Completed At',
      'Section Breakdown'
    ]));

    sorted.forEach((attempt, idx) => {
      const stats = getAttemptStats(attempt);
      const marksObtained = roundTo2(attempt.marksObtained || 0);
      const totalMarks = roundTo2(attempt.totalMarks || 0);
      const scorePercentage = stats.scorePercentage ?? 0;
      const percentage = scorePercentage;
      const belowCount = sorted.filter(s => (s.marksObtained || 0) < (attempt.marksObtained || 0)).length;
      const percentile = total > 0 ? roundTo2((belowCount / total) * 100) : 0;
      const timeSpentMinutes = (attempt.startTime && attempt.endTime)
        ? roundTo2((new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000 / 60)
        : 0;

      const sectionBreakdown = Array.isArray(attempt.sectionPerformance) && attempt.sectionPerformance.length > 0
        ? attempt.sectionPerformance.map((section) => {
          const sectionName = section.sectionName || 'Section';
          return `${sectionName} (C:${section.correct || 0}, W:${section.incorrect || 0}, S:${section.skipped || 0}, Acc:${roundTo2(section.accuracy || 0)}%)`;
        }).join(' | ')
        : '';

      csvLines.push(toCsvRow([
        idx + 1,
        String(attempt._id),
        attempt.student?._id ? String(attempt.student._id) : '',
        attempt.student?.name || 'Unknown',
        attempt.student?.email || '',
        stats.correct,
        stats.incorrect,
        stats.skipped,
        stats.answered,
        stats.accuracy ?? '',
        scorePercentage,
        roundTo2(attempt.score || 0),
        stats.totalQuestions,
        marksObtained,
        totalMarks,
        percentage,
        percentile,
        timeSpentMinutes,
        attempt.tabSwitchCount || 0,
        attempt.status || '',
        attempt.startTime ? new Date(attempt.startTime).toISOString() : '',
        attempt.endTime ? new Date(attempt.endTime).toISOString() : '',
        sectionBreakdown
      ]));
    });

    csvLines.push('');
    csvLines.push(toCsvRow(['Question-wise Analytics']));
    csvLines.push(toCsvRow([
      'Question Number',
      'Subject',
      'Topic',
      'Question Text',
      'Option A',
      'Option B',
      'Option C',
      'Option D',
      'Correct Option',
      'Correct Option Text',
      'Correct Count',
      'Wrong Count',
      'Skipped Count',
      'Correct (%)',
      'Wrong (%)',
      'Skipped (%)'
    ]));

    questionAnalytics.forEach((question) => {
      csvLines.push(toCsvRow([
        question.questionNumber,
        question.subjectName,
        question.topicName,
        question.questionText,
        question.optionA,
        question.optionB,
        question.optionC,
        question.optionD,
        question.correctOptionLabel,
        question.correctOptionText,
        question.correctCount,
        question.wrongCount,
        question.skippedCount,
        question.percentCorrect,
        question.percentWrong,
        question.percentSkipped
      ]));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${quiz.title.replace(/"/g, '')}_report.csv"`);
    res.send(csvLines.join('\n'));
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// CSV download of per-student analytics report (admin only)
router.get('/analytics/student/:studentId/csv', auth, authorize('admin'), async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId).select('name email role');
    if (!student || student.role !== 'student') {
      return res.status(404).json({ message: 'Student not found' });
    }

    const attempts = await QuizAttempt.find({
      student: req.params.studentId,
      status: { $in: ['completed', 'auto_submitted'] }
    })
      .populate({
        path: 'quiz',
        select: 'title subject testType totalMarks positiveMarks negativeMarks questions',
        populate: [
          { path: 'subject', select: 'name' },
          {
            path: 'questions',
            select: 'qid question options correctAnswer topicName subject',
            populate: { path: 'subject', select: 'name' }
          }
        ]
      })
      .sort({ endTime: -1 });

    const totalTests = attempts.length;
    const totalMarks = roundTo2(attempts.reduce((sum, a) => sum + Number(a.totalMarks || 0), 0));
    const obtainedMarks = roundTo2(attempts.reduce((sum, a) => sum + Number(a.marksObtained || 0), 0));
    const avgPercentage = totalMarks > 0 ? roundTo2((obtainedMarks / totalMarks) * 100) : 0;

    const csvLines = [];
    const generatedAt = new Date().toISOString();

    csvLines.push(toCsvRow(['Student Analytics Report']));
    csvLines.push(toCsvRow(['Generated At', generatedAt]));
    csvLines.push('');

    csvLines.push(toCsvRow(['Student Details']));
    csvLines.push(toCsvRow(['Student ID', 'Student Name', 'Student Email']));
    csvLines.push(toCsvRow([String(student._id), student.name || '', student.email || '']));
    csvLines.push('');

    csvLines.push(toCsvRow(['Summary']));
    csvLines.push(toCsvRow(['Total Tests', 'Total Marks', 'Obtained Marks', 'Average Percentage (%)']));
    csvLines.push(toCsvRow([totalTests, totalMarks, obtainedMarks, avgPercentage]));
    csvLines.push('');

    csvLines.push(toCsvRow(['Attempt Summary']));
    csvLines.push(toCsvRow([
      'Attempt ID',
      'Quiz ID',
      'Quiz Title',
      'Quiz Subject',
      'Test Type',
      'Score',
      'Total Questions',
      'Marks Obtained',
      'Total Marks',
      'Percentage (%)',
      'Status',
      'Tab Switch Count',
      'Started At',
      'Completed At'
    ]));

    attempts.forEach((attempt) => {
      const quiz = attempt.quiz;
      const quizSubject = quiz?.subject?.name || 'General';
      const percentage = attempt.totalMarks > 0
        ? roundTo2((Number(attempt.marksObtained || 0) / Number(attempt.totalMarks || 0)) * 100)
        : 0;

      csvLines.push(toCsvRow([
        String(attempt._id),
        quiz?._id ? String(quiz._id) : '',
        quiz?.title || '',
        quizSubject,
        quiz?.testType || '',
        roundTo2(attempt.score || 0),
        attempt.totalQuestions || 0,
        roundTo2(attempt.marksObtained || 0),
        roundTo2(attempt.totalMarks || 0),
        percentage,
        attempt.status || '',
        attempt.tabSwitchCount || 0,
        attempt.startTime ? new Date(attempt.startTime).toISOString() : '',
        attempt.endTime ? new Date(attempt.endTime).toISOString() : ''
      ]));
    });

    csvLines.push('');
    csvLines.push(toCsvRow(['Question-level Response Details']));
    csvLines.push(toCsvRow([
      'Student ID',
      'Student Name',
      'Student Email',
      'Attempt ID',
      'Quiz ID',
      'Quiz Title',
      'Test Type',
      'Attempt Status',
      'Attempt Start',
      'Attempt End',
      'Question Number',
      'Question ID',
      'Question QID',
      'Question Subject',
      'Question Topic',
      'Question Text',
      'Option A',
      'Option B',
      'Option C',
      'Option D',
      'Correct Option',
      'Correct Option Text',
      'Selected Option',
      'Selected Option Text',
      'Answered',
      'Skipped',
      'Is Correct',
      'Time Spent (sec)',
      'Marks Awarded',
      'Positive Marks',
      'Negative Marks'
    ]));

    attempts.forEach((attempt) => {
      const quiz = attempt.quiz;
      if (!quiz || !Array.isArray(quiz.questions)) return;

      const positiveMarks = Number(quiz.positiveMarks || 0);
      const negativeMarks = Number(quiz.negativeMarks || 0);
      const answerByQuestionIndex = new Map();

      if (Array.isArray(attempt.answers)) {
        attempt.answers.forEach((ans) => {
          answerByQuestionIndex.set(Number(ans.questionIndex), ans);
        });
      }

      quiz.questions.forEach((question, questionIndex) => {
        const answer = answerByQuestionIndex.get(questionIndex);
        const options = Array.isArray(question.options) ? question.options : [];
        const questionType = resolveQuestionType(answer, question);
        const result = classifyAnswer(answer, questionType);
        const isSkipped = result.skipped;
        const isCorrect = result.answered && result.correct;
        const marksAwarded = computeMarksAwarded(
          isCorrect,
          isSkipped,
          positiveMarks,
          negativeMarks
        );

        csvLines.push(toCsvRow([
          String(student._id),
          student.name || '',
          student.email || '',
          String(attempt._id),
          quiz._id ? String(quiz._id) : '',
          quiz.title || '',
          quiz.testType || '',
          attempt.status || '',
          attempt.startTime ? new Date(attempt.startTime).toISOString() : '',
          attempt.endTime ? new Date(attempt.endTime).toISOString() : '',
          questionIndex + 1,
          question._id ? String(question._id) : '',
          question.qid || '',
          question.subject?.name || quiz.subject?.name || 'General',
          question.topicName || '',
          question.question || '',
          options[0] || '',
          options[1] || '',
          options[2] || '',
          options[3] || '',
          optionLabelFromIndex(question.correctAnswer),
          optionTextFromIndex(options, question.correctAnswer),
          isSkipped ? '' : optionLabelFromIndex(answer?.selectedAnswer),
          isSkipped ? '' : optionTextFromIndex(options, answer?.selectedAnswer),
          isSkipped ? 'No' : 'Yes',
          isSkipped ? 'Yes' : 'No',
          isSkipped ? '' : (isCorrect ? 'Yes' : 'No'),
          Number(answer?.timeSpent || 0),
          roundTo2(marksAwarded),
          roundTo2(positiveMarks),
          roundTo2(negativeMarks)
        ]));
      });
    });

    const sanitizedName = (student.name || 'student').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'student';
    const fileName = `${sanitizedName}_${student._id}_analytics.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csvLines.join('\n'));
  } catch (error) {
    console.error('Student CSV export error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Student subject-wise performance report
router.get('/analytics/student/:studentId/subjects', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    if (req.user.role === 'mentor') {
      const assignment = await MentorStudentAssignment.findOne({
        mentor: req.user._id,
        student: req.params.studentId,
        isActive: true
      });

      if (!assignment) {
        return res.status(403).json({ message: 'Not authorized to view this student\'s analytics' });
      }
    }

    const { subject, range } = req.query;
    const filter = {
      student: req.params.studentId,
      status: { $in: ['completed', 'auto_submitted'] }
    };

    let attempts = await QuizAttempt.find(filter)
      .populate({
        path: 'quiz',
        populate: { path: 'subject', select: 'name' }
      })
      .sort({ endTime: -1 });

    attempts = filterAttemptsByDateRange(attempts, range);

    let subjects = aggregateSubjectStats(attempts);
    if (subject) {
      subjects = subjects.filter((s) => s.subjectId === subject);
    }

    res.json({ subjects });
  } catch (error) {
    console.error('Student subject report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Student performance broken down by the seven Question Bank classification
// dimensions (Subject, Topic, Subtopic, System, Question Type, Tag, Difficulty).
// Uses the server-derived metadataSnapshot captured at submit time — never the
// live QuestionBank — so historical accuracy remains stable even if a
// question's classification is edited later. (admin, mentor)
router.get('/analytics/student/:studentId/performance', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    if (req.user.role === 'mentor') {
      const assignment = await MentorStudentAssignment.findOne({
        mentor: req.user._id,
        student: req.params.studentId,
        isActive: true
      });

      if (!assignment) {
        return res.status(403).json({ message: 'Not authorized to view this student\'s analytics' });
      }
    }

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.studentId)) {
      return res.status(400).json({ message: 'Invalid student id' });
    }
    const studentObjectId = new mongoose.Types.ObjectId(req.params.studentId);

    // Pull only the fields needed for bucketing. Answers without a
    // metadataSnapshot predate this feature and are excluded rather than
    // guessed at.
    const rows = await QuizAttempt.aggregate([
      { $match: { student: studentObjectId, status: { $in: ['completed', 'auto_submitted'] } } },
      { $unwind: '$answers' },
      { $match: { 'answers.metadataSnapshot': { $exists: true, $ne: null } } },
      {
        $project: {
          _id: 0,
          selectedAnswer: '$answers.selectedAnswer',
          isCorrect: '$answers.isCorrect',
          snapshot: '$answers.metadataSnapshot'
        }
      }
    ]);

    const breakdown = computePerformanceBuckets(rows.map((row) => ({
      selectedAnswer: row.selectedAnswer,
      isCorrect: row.isCorrect,
      snapshot: row.snapshot,
    })));

    const { strengths, weaknesses } = computeStrengthsWeaknesses(breakdown.bySubject);

    res.json({
      ...breakdown,
      strengths,
      weaknesses,
    });
  } catch (error) {
    console.error('Student performance analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Heatmap data: students × tests matrix with % scores (admin, mentor)
router.get('/analytics/heatmap', auth, authorize('admin', 'mentor'), async (req, res) => {
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

    // Default filter for all students
    let attemptFilter = {
      quiz: { $in: quizIds },
      status: { $in: ['completed', 'auto_submitted'] }
    };

    // If mentor, only fetch attempts for their assigned students
    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      const mentorStudentIds = assignments.map(a => a.student.toString());
      attemptFilter.student = { $in: mentorStudentIds };
    }

    // Get all attempts for these quizzes
    const attempts = await QuizAttempt.find(attemptFilter).populate('student', 'name email profilePicture');

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
      const scorePct = computeScorePercentage(a.marksObtained, a.totalMarks);
      if (scorePct !== null) {
        studentMap[sId].scores[a.quiz.toString()] = scorePct;
      }
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
    let attemptQuery = {
      quiz: quizId,
      status: { $in: ['completed', 'auto_submitted'] }
    };

    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      const mentorStudentIds = assignments.map(a => a.student.toString());
      attemptQuery.student = { $in: mentorStudentIds };
    }

    const attempts = await QuizAttempt.find(attemptQuery).populate('student', 'name email profilePicture');

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
      const stats = computeAttemptStats(a);
      const percentage = stats.scorePercentage ?? 0;
      totalScore += percentage;
      totalCorrect += stats.correct;
      totalTime += getAttemptDurationMinutes(a) || 0;

      return {
        studentId: a.student?._id,
        studentName: a.student?.name || 'Unknown',
        percentage,
        scorePercentage: stats.scorePercentage,
        accuracy: stats.accuracy,
        correct: stats.correct,
        wrong: stats.incorrect,
        skipped: stats.skipped,
        attempted: stats.attempted,
        timeTaken: getAttemptDurationMinutes(a) || 0,
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

// Resolve quiz ID from shareToken (for deep links - authenticated users)
router.get('/by-token/:shareToken', auth, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      shareToken: req.params.shareToken,
      isActive: true
    }).select('_id assignedStudents isPublic');

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    if (req.user.role === 'student') {
      const isAssigned = quiz.assignedStudents.some(id => id.toString() === req.user._id.toString());
      if (!isAssigned) {
        return res.status(403).json({ 
          message: 'Please ask the admin to assign you this test' 
        });
      }
    }

    res.json({ quizId: quiz._id });
  } catch (error) {
    console.error('By-token lookup error:', error);
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
        select: 'question options optionImages topicName subtopicName system questionType tags difficulty '
          + 'questionImage subject correctAnswer explanation explanationImage assertion reason columnA columnB',
        populate: {
          path: 'subject',
          select: 'name'
        }
      })
      .populate({
        path: 'sections.questions',
        model: 'QuestionBank',
        populate: {
          path: 'subject',
          select: 'name'
        }
      })
      .populate('assignedMentors', 'name email');

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check access for mentors
    if (req.user.role === 'mentor') {
        const isCreator = quiz.createdBy && quiz.createdBy.toString() === req.user._id.toString();
        const isAssigned = quiz.assignedMentors.some(m => m._id.toString() === req.user._id.toString());
        
        if (!isCreator && !isAssigned) {
            return res.status(403).json({ message: 'Access denied. You are not assigned to this quiz.' });
        }
    }

    // Check access for students
    if (req.user.role === 'student') {
      if (!quiz.assignedStudents.includes(req.user._id)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if already attempted — include status in response instead of blocking
      const existingAttempt = await QuizAttempt.findOne({
        quiz: quiz._id,
        student: req.user._id
      });

      // Attach attemptStatus so the frontend can handle it in the UI
      // (e.g. show "View Results" instead of "Start Quiz")
      // Stored as temp var - will be added to qObj after toObject()
      var _attemptStatus = existingAttempt ? {
        hasAttempted: existingAttempt.status === 'completed' || existingAttempt.status === 'auto_submitted',
        status: existingAttempt.status,
        attemptId: existingAttempt._id,
        canRetake: existingAttempt.retestApproved && !existingAttempt.retestUsed,
        retestRequested: existingAttempt.retestRequested && !existingAttempt.retestApproved
      } : {
        hasAttempted: false,
        canRetake: false,
        retestRequested: false
      };
    }

    const qObj = quiz.toObject();

    // SECURITY: students must never receive the answer key. Strip it from
    // every question reference (top-level questions[] and sections[].questions[]).
    if (req.user.role === 'student') {
      const stripAnswerKey = (q) => {
        if (!q || typeof q !== 'object') return q;
        delete q.correctAnswer;
        delete q.explanation;
        delete q.explanationImage;
        return q;
      };
      (qObj.questions || []).forEach(stripAnswerKey);
      (qObj.sections || []).forEach(section => (section.questions || []).forEach(stripAnswerKey));
    }

    // Compute unique subject names from questions (same logic as list endpoint)
    const names = [...new Set(
      (qObj.questions || [])
        .map(qu => qu.subject?.name)
        .filter(Boolean)
    )];
    qObj.subjectNames = names.length > 0 ? names : (qObj.subject?.name ? [qObj.subject.name] : []);

    if (Array.isArray(qObj.sections) && qObj.sections.length > 0) {
      const sectionResult = deriveSectionsForQuestions(
        qObj.sections,
        (qObj.questions || []).map(qu => qu._id || qu),
        qObj.duration,
        { strictDuration: false }
      );
      if (!sectionResult.error) {
        qObj.sections = sectionResult.sections;
      }
    }

    // Add attemptStatus for students (set above)
    if (req.user.role === 'student' && _attemptStatus) {
      qObj.attemptStatus = _attemptStatus;
    }

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
    const { questionIndex, selectedAnswer, markedForReview, timeSpent, questionId } = req.body;

    if (typeof questionIndex !== 'number' || questionIndex < 0) {
      return res.status(400).json({ message: 'A valid questionIndex is required' });
    }

    const attempt = await QuizAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id,
      status: 'in_progress'
    });

    if (!attempt) {
      return res.status(404).json({ message: 'No active attempt found' });
    }

    // Resolve the canonical question id server-side from the quiz's ordered
    // question list. A client-supplied questionId is only ever used as a
    // consistency check — never as the source of truth for identity.
    const quizForAnswer = await Quiz.findById(req.params.id).select('questions');
    const resolvedQuestionId = quizForAnswer?.questions?.[questionIndex];
    if (!resolvedQuestionId) {
      return res.status(400).json({ message: 'Invalid question index for this quiz' });
    }
    if (questionId && String(questionId) !== String(resolvedQuestionId)) {
      return res.status(400).json({ message: 'questionId does not match the quiz question at this index' });
    }

    // Find or create answer for this question
    const existingIndex = attempt.answers.findIndex(a => a.questionIndex === questionIndex);

    const answerData = {
      questionIndex,
      questionId: resolvedQuestionId,
      selectedAnswer,
      markedForReview: markedForReview || false,
      timeSpent: timeSpent || 0
      // isCorrect / metadataSnapshot are intentionally omitted here: they are
      // only ever computed server-side at submit time, never on save.
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
      const stats = computeAttemptStats(attempt, attempt.quiz?.questions || []);
      return res.json({
        ...buildSubmitResponsePayload(attempt, attempt.quiz, stats),
        message: 'Quiz already submitted',
        isAlreadySubmitted: true,
      });
    }

    if (attempt.status !== 'in_progress') {
      return res.status(400).json({
        message: 'This quiz attempt cannot be submitted.',
        errorCode: 'INVALID_ATTEMPT_STATUS',
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

      // Server-side grading is the ONLY source of truth for correctness.
      // Never trust a client-submitted isCorrect value.
      const { answered, isCorrect } = gradeQuestion(question, answer ? answer.selectedAnswer : undefined);

      if (answer) {
        // Ensure the answer is always tied to its canonical question, even if
        // it was created before questionId existed on the answer schema.
        answer.questionId = question._id;
        answer.metadataSnapshot = buildMetadataSnapshot(question);
      }

      if (!answered) {
        // Question was skipped (either never visited OR visited but not answered)
        skippedCount++;
        sectionPerformance[section].skipped++;
        if (answer) answer.isCorrect = false;
      } else if (isCorrect) {
        correctCount++;
        const points = quiz.positiveMarks !== undefined ? quiz.positiveMarks : 4;
        marksObtained += points;
        sectionPerformance[section].correct++;
        answer.isCorrect = true;
      } else {
        incorrectCount++;
        sectionPerformance[section].incorrect++;
        answer.isCorrect = false;

        // Deduct negative marks (if any)
        const deduction = quiz.negativeMarks !== undefined ? Math.abs(quiz.negativeMarks) : 1;
        marksObtained -= deduction;
      }

      if (answer) {
        sectionPerformance[section].timeSpent += answer.timeSpent || 0;
      }
    });

    // Calculate accuracy for each section before storing (correct / attempted)
    const sectionPerformanceArray = Object.values(sectionPerformance).map(section => {
      const attemptedInSection = section.correct + section.incorrect;
      const accuracy = attemptedInSection > 0
        ? Math.round((section.correct / attemptedInSection) * 100)
        : 0;

      return {
        ...section,
        accuracy
      };
    });

    marksObtained = roundTo2(marksObtained);

    const finalStatus = isAutoSubmit ? 'auto_submitted' : 'completed';
    const endTime = new Date();
    const shareSolutionAtSubmission = quiz.shareSolution !== undefined ? quiz.shareSolution : true;

    // Atomic finalize — only one concurrent submit can succeed.
    const finalizedAttempt = await QuizAttempt.findOneAndUpdate(
      {
        _id: attempt._id,
        student: req.user._id,
        status: 'in_progress',
      },
      {
        $set: {
          status: finalStatus,
          endTime,
          score: correctCount,
          totalQuestions: quiz.questions.length,
          marksObtained,
          totalMarks: quiz.totalMarks,
          sectionPerformance: sectionPerformanceArray,
          shareSolutionAtSubmission,
          answers: attempt.answers,
        },
      },
      { new: true }
    );

    if (!finalizedAttempt) {
      const existingAttempt = await QuizAttempt.findOne({
        _id: attempt._id,
        student: req.user._id,
      }).populate({
        path: 'quiz',
        populate: { path: 'questions', model: 'QuestionBank' },
      });

      if (
        existingAttempt
        && (existingAttempt.status === 'completed' || existingAttempt.status === 'auto_submitted')
      ) {
        console.log(`[Submit Quiz] Duplicate submit detected, returning existing result: ${attempt._id}`);
        const stats = computeAttemptStats(existingAttempt, existingAttempt.quiz?.questions || []);
        return res.json({
          ...buildSubmitResponsePayload(existingAttempt, existingAttempt.quiz, stats),
          message: 'Quiz already submitted',
          isAlreadySubmitted: true,
        });
      }

      return res.status(409).json({
        message: 'Quiz submission is already in progress. Please wait.',
        errorCode: 'SUBMIT_IN_PROGRESS',
      });
    }

    console.log(`[Submit Quiz] Successfully submitted: ${finalizedAttempt._id}, Score: ${correctCount}/${quiz.questions.length}`);

    // Emit quiz_submitted event back to the student
    const io = req.app.get('io');
    if (io) {
      // Find the socket helper to emit.
      const socketHelpers = require('../utils/socket-helpers');
      if (socketHelpers && socketHelpers.emitToUser) {
        socketHelpers.emitToUser(req.user._id.toString(), 'quiz_submitted', {
          quizId: quiz._id,
          attemptId: finalizedAttempt._id,
          score: correctCount,
          status: finalizedAttempt.status
        });
      }

      // --- NEW FOR MENTOR/ADMIN REMINDERS ---
      try {
        const studentObj = await User.findById(req.user._id).select('name');
        const studentName = studentObj ? studentObj.name : 'A student';
        const attemptDetails = {
          quizId: quiz._id,
          quizTitle: quiz.title,
          studentId: req.user._id,
          studentName: studentName,
          score: correctCount,
          totalQuestions: quiz.questions.length
        };

        // 1. Notify Admins
        const admins = await User.find({ role: 'admin' }).select('_id pushToken fcmToken');
        if (socketHelpers && socketHelpers.emitToAdmins) {
          socketHelpers.emitToAdmins('quiz_completed_alert', attemptDetails);
        }
        for (const admin of admins) {
          if (admin.pushToken || admin.fcmToken) {
            sendPushToUser({
              expoPushToken: admin.pushToken,
              fcmToken: admin.fcmToken,
              title: 'Quiz Completed',
              body: `${studentName} completed ${quiz.title}`,
              data: { type: 'quiz_completed', ...attemptDetails },
            });
          }
        }

        // 2. Notify specific Mentor
        const assignment = await MentorStudentAssignment.findOne({ student: req.user._id, isActive: true }).populate('mentor', '_id pushToken fcmToken');
        if (assignment && assignment.mentor) {
          if (socketHelpers && socketHelpers.emitToUser) {
            socketHelpers.emitToUser(assignment.mentor._id.toString(), 'quiz_completed_alert', attemptDetails);
          }
          if (assignment.mentor.pushToken || assignment.mentor.fcmToken) {
            sendPushToUser({
              expoPushToken: assignment.mentor.pushToken,
              fcmToken: assignment.mentor.fcmToken,
              title: 'Student Quiz Completed',
              body: `${studentName} completed ${quiz.title}`,
              data: { type: 'quiz_completed', ...attemptDetails },
            });
          }
        }
      } catch (notifyErr) {
        console.error('[Submit Quiz] Error sending mentor/admin notifications:', notifyErr);
      }
    }

    const stats = computeAttemptStats(finalizedAttempt, quiz.questions);
    res.json(buildSubmitResponsePayload(finalizedAttempt, quiz, stats));
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
      .populate('student', 'name email profilePicture');

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

    if (attempt.status !== 'completed' && attempt.status !== 'auto_submitted') {
      return res.status(400).json({
        message: 'Results are only available after the quiz has been submitted.',
        errorCode: 'ATTEMPT_NOT_COMPLETED',
      });
    }

    // SECURITY CRITICAL: Fetch current shareSolution setting dynamically
    // This ensures no cached responses can bypass solution hiding
    const quiz = await Quiz.findById(attempt.quiz._id);
    const shareSolution = quiz.shareSolution !== undefined ? quiz.shareSolution : true;

    // Calculate section-aware data
    const hasQuizSections = quiz.sections && quiz.sections.length > 0;
    const questionsWithAnswers = [];
    const sectionPerformance = {};

    // Helper to determine section for a question
    const getSectionInfo = (qId, globalIndex) => {
      if (hasQuizSections) {
        for (const section of quiz.sections) {
          const qIdx = section.questions.findIndex(id => id.toString() === qId.toString());
          if (qIdx !== -1) {
            return { name: section.name, index: qIdx };
          }
        }
      }
      
      // Fallback to groupBy
      let sectionName = 'General';
      const q = attempt.quiz.questions[globalIndex];
      if (groupBy === 'subject') {
        sectionName = q.subject?.name || 'General';
      } else if (groupBy === 'tag') {
        sectionName = (q.tags && q.tags.length > 0) ? q.tags[0] : 'Untagged';
      } else {
        sectionName = q.topicName || 'General';
      }
      return { name: sectionName, index: globalIndex }; // Fallback relative index is global index
    };

    // If quiz has sections, follow section order. Otherwise follow global order.
    if (hasQuizSections) {
      quiz.sections.forEach(section => {
        if (!sectionPerformance[section.name]) {
          sectionPerformance[section.name] = {
            sectionName: section.name,
            correct: 0,
            incorrect: 0,
            skipped: 0,
            timeSpent: 0
          };
        }

        section.questions.forEach((qId, sIdx) => {
          const globalIndex = attempt.quiz.questions.findIndex(qd => qd._id.toString() === qId.toString());
          if (globalIndex !== -1) {
            const q = attempt.quiz.questions[globalIndex];
            const answer = attempt.answers.find(a => a.questionIndex === globalIndex);
            
            // Process performance
            const hasAnswer = answer && answer.selectedAnswer != null && answer.selectedAnswer !== -1;
            if (!hasAnswer) {
              sectionPerformance[section.name].skipped++;
            } else if (answer.isCorrect) {
              sectionPerformance[section.name].correct++;
            } else {
              sectionPerformance[section.name].incorrect++;
            }
            if (answer) {
              sectionPerformance[section.name].timeSpent += answer.timeSpent || 0;
            }

            // Build question data
            const baseData = {
              _id: q._id,
              question: q.question,
              questionImage: q.questionImage,
              options: q.options,
              optionImages: q.optionImages,
              questionType: q.questionType,
              assertion: q.assertion,
              reason: q.reason,
              columnA: q.columnA,
              columnB: q.columnB,
              marks: q.marks,
              subject: q.subject,
              topicName: q.topicName,
              subtopicName: q.subtopicName,
              system: q.system,
              difficulty: q.difficulty,
              tags: q.tags,
              userAnswer: answer?.selectedAnswer,
              isCorrect: answer?.isCorrect,
              timeSpent: answer?.timeSpent,
              markedForReview: answer?.markedForReview,
              section: section.name,
              sectionQuestionIndex: sIdx,
              globalIndex: globalIndex
            };

            if (shareSolution) {
              baseData.correctAnswer = q.correctAnswer;
              baseData.explanation = q.explanation;
              baseData.explanationImage = q.explanationImage;
            }

            questionsWithAnswers.push(baseData);
          }
        });
      });
    } else {
      // Original global-order logic with refactored section determination
      attempt.quiz.questions.forEach((q, index) => {
        const answer = attempt.answers.find(a => a.questionIndex === index);
        const secInfo = getSectionInfo(q._id, index);

        if (!sectionPerformance[secInfo.name]) {
          sectionPerformance[secInfo.name] = {
            sectionName: secInfo.name,
            correct: 0,
            incorrect: 0,
            skipped: 0,
            timeSpent: 0
          };
        }

        const hasAnswer = answer && answer.selectedAnswer != null && answer.selectedAnswer !== -1;
        if (!hasAnswer) {
          sectionPerformance[secInfo.name].skipped++;
        } else if (answer.isCorrect) {
          sectionPerformance[secInfo.name].correct++;
        } else {
          sectionPerformance[secInfo.name].incorrect++;
        }
        if (answer) {
          sectionPerformance[secInfo.name].timeSpent += answer.timeSpent || 0;
        }

        const baseData = {
          _id: q._id,
          question: q.question,
          questionImage: q.questionImage,
          options: q.options,
          optionImages: q.optionImages,
          questionType: q.questionType,
          assertion: q.assertion,
          reason: q.reason,
          columnA: q.columnA,
          columnB: q.columnB,
          marks: q.marks,
          subject: q.subject,
          topicName: q.topicName,
          subtopicName: q.subtopicName,
          system: q.system,
          difficulty: q.difficulty,
          tags: q.tags,
          userAnswer: answer?.selectedAnswer,
          isCorrect: answer?.isCorrect,
          timeSpent: answer?.timeSpent,
          markedForReview: answer?.markedForReview,
          section: secInfo.name,
          sectionQuestionIndex: index,
          globalIndex: index
        };

        if (shareSolution) {
          baseData.correctAnswer = q.correctAnswer;
          baseData.explanation = q.explanation;
          baseData.explanationImage = q.explanationImage;
        }

        questionsWithAnswers.push(baseData);
      });
    }

    // Calculate accuracy for each section (correct / attempted, skips excluded)
    const sectionPerformanceArray = Object.values(sectionPerformance).map(section => {
      const attemptedInSection = section.correct + section.incorrect;
      const accuracy = attemptedInSection > 0
        ? Math.round((section.correct / attemptedInSection) * 100)
        : 0;

      return {
        ...section,
        accuracy,
        total: section.correct + section.incorrect + section.skipped
      };
    });

    const stats = computeAttemptStats(attempt, attempt.quiz.questions || []);
    const markedForReviewCount = Array.isArray(attempt.answers)
      ? attempt.answers.filter((answer) => answer.markedForReview).length
      : 0;
    const timeTakenSeconds = computeTimeTakenSeconds(attempt, attempt.quiz.questions || []);

    const questionIds = questionsWithAnswers
      .map((question) => question._id)
      .filter(Boolean);

    const historyMap = await aggregateQuestionHistoryForStudent(
      attempt.student._id,
      questionIds,
      { excludeAttemptId: attempt._id }
    );

    const questionPerformance = questionsWithAnswers.map((question) => {
      const history = historyMap.get(String(question._id)) || {
        questionId: String(question._id),
        totalAttempts: 0,
        correctAttempts: 0,
        incorrectAttempts: 0,
        skippedAttempts: 0,
        previousIncorrectAttempts: 0,
      };

      const answered = isAnswerRecorded(question.userAnswer);
      let status = 'unattempted';
      if (answered) {
        status = question.isCorrect ? 'correct' : 'incorrect';
      }

      return {
        questionId: String(question._id),
        questionIndex: question.globalIndex,
        section: question.section,
        status,
        isCorrect: question.isCorrect === true,
        markedForReview: question.markedForReview === true,
        timeSpent: question.timeSpent || 0,
        history,
      };
    });

    const wrongQuestions = questionsWithAnswers
      .filter((question) => {
        const answered = isAnswerRecorded(question.userAnswer);
        return answered && question.isCorrect === false;
      })
      .map((question) => {
        const history = historyMap.get(String(question._id)) || {
          totalAttempts: 0,
          correctAttempts: 0,
          incorrectAttempts: 0,
          skippedAttempts: 0,
          previousIncorrectAttempts: 0,
        };

        const selected = formatAnswerForDisplay(
          question.questionType,
          question.userAnswer,
          question.options,
          question.columnA,
          question.columnB
        );

        const correct = shareSolution
          ? formatAnswerForDisplay(
            question.questionType,
            question.correctAnswer,
            question.options,
            question.columnA,
            question.columnB
          )
          : null;

        return {
          questionId: String(question._id),
          questionIndex: question.globalIndex,
          displayNumber: (question.globalIndex ?? 0) + 1,
          question: question.question,
          questionImage: question.questionImage,
          questionType: question.questionType,
          section: question.section,
          topicName: question.topicName,
          subjectName: question.subject?.name || question.metadataSnapshot?.subjectName || null,
          selectedAnswer: question.userAnswer,
          selectedAnswerLabel: selected.label,
          selectedAnswerText: selected.text,
          correctAnswer: shareSolution ? question.correctAnswer : undefined,
          correctAnswerLabel: correct?.label,
          correctAnswerText: correct?.text,
          explanation: shareSolution ? question.explanation : undefined,
          explanationImage: shareSolution ? question.explanationImage : undefined,
          timeSpent: question.timeSpent || 0,
          history: {
            ...history,
            previousIncorrectAttempts: history.previousIncorrectAttempts || history.incorrectAttempts || 0,
          },
        };
      });

    const frequentlyMissedQuestions = await getFrequentlyMissedQuestions(
      attempt.student._id,
      {
        minIncorrectAttempts: 2,
        limit: 15,
        excludeAttemptId: attempt._id,
      }
    );

    const hasSectionData = sectionPerformanceArray.length > 0
      && !(sectionPerformanceArray.length === 1 && sectionPerformanceArray[0].sectionName === 'General');

    res.json({
      summary: {
        correct: stats.correct,
        incorrect: stats.incorrect,
        skipped: stats.skipped,
        attempted: stats.attempted,
        totalQuestions: stats.totalQuestions,
        marksObtained: roundTo2(stats.marksObtained),
        totalMarks: stats.totalMarks,
        scorePercentage: stats.scorePercentage,
        accuracy: stats.accuracy,
        markedForReviewCount,
        timeTakenSeconds,
      },
      attempt: {
        _id: attempt._id,
        status: attempt.status,
        startTime: attempt.startTime,
        endTime: attempt.endTime,
        score: attempt.score,
        totalQuestions: attempt.totalQuestions,
        marksObtained: roundTo2(attempt.marksObtained),
        totalMarks: attempt.totalMarks,
        sectionPerformance: sectionPerformanceArray,
        tabSwitchCount: attempt.tabSwitchCount,
        retestRequested: attempt.retestRequested || false,
        retestApproved: attempt.retestApproved || false,
        canRequestRetest: !attempt.retestRequested && !attempt.retestApproved,
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
        shareSolution
      },
      student: attempt.student,
      questions: questionsWithAnswers,
      questionPerformance,
      wrongQuestions,
      frequentlyMissedQuestions,
      hasSectionData,
      groupBy
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
      .populate('student', 'name email profilePicture')
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

// Get test list for analytics (admin, mentor)
router.get('/analytics/tests/list', auth, authorize('admin', 'mentor'), async (req, res) => {
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

    // If mentor, fetch their assigned students
    let mentorStudentIds = [];
    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      mentorStudentIds = assignments.map(a => a.student.toString());
    }

    // Get attempt counts for each test
    const testsWithStats = await Promise.all(
      tests.map(async (test) => {
        let attemptQuery = {
          quiz: test._id,
          status: { $in: ['completed', 'auto_submitted'] }
        };

        let assignedCount = test.assignedStudents?.length || 0;

        // Apply mentor filtering
        if (req.user.role === 'mentor') {
          attemptQuery.student = { $in: mentorStudentIds };
          // Calculate mentor's assigned students that are also assigned to this test (or just mentor's stds if test is global)
          if (test.assignedStudents && test.assignedStudents.length > 0) {
            assignedCount = test.assignedStudents.filter(id => mentorStudentIds.includes(id.toString())).length;
          } else {
            assignedCount = mentorStudentIds.length;
          }
        }

        const attemptCount = await QuizAttempt.countDocuments(attemptQuery);

        return {
          _id: test._id,
          title: test.title,
          testType: test.testType,
          assignedCount: assignedCount,
          attemptCount,
          totalMarks: test.totalMarks,
          createdAt: test.createdAt
        };
      })
    );

    let resultTests = testsWithStats;
    if (req.user.role === 'mentor') {
      resultTests = testsWithStats.filter(t => t.assignedCount > 0 || t.attemptCount > 0);
    }

    res.json({ tests: resultTests });
  } catch (error) {
    console.error('Get test list error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get comprehensive test analytics (admin, mentor)
router.get('/analytics/test/:testId', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.testId)
      .populate('subject', 'name')
      .populate('questions');

    if (!quiz) {
      return res.status(404).json({ message: 'Test not found' });
    }

    let attemptQuery = {
      quiz: req.params.testId,
      status: { $in: ['completed', 'auto_submitted'] }
    };

    let totalAssigned = quiz.assignedStudents?.length || 0;

    if (req.user.role === 'mentor') {
      const assignments = await MentorStudentAssignment.find({ mentor: req.user._id, isActive: true }).select('student');
      const mentorStudentIds = assignments.map(a => a.student.toString());
      attemptQuery.student = { $in: mentorStudentIds };

      if (quiz.assignedStudents && quiz.assignedStudents.length > 0) {
        totalAssigned = quiz.assignedStudents.filter(id => mentorStudentIds.includes(id.toString())).length;
      } else {
        totalAssigned = mentorStudentIds.length;
      }
    }

    const attempts = await QuizAttempt.find(attemptQuery)
      .populate('student', 'name email profilePicture')
      .sort({ marksObtained: -1 });

    const totalQuestions = quiz.questions.length;
    const overview = computeTestOverview(attempts, totalAssigned);
    const performanceMetrics = computePerformanceMetricsAverages(attempts, quiz.questions, totalQuestions);
    const questionAnalytics = computeQuestionAnalytics(attempts, quiz.questions);
    const { easiest, hardest } = findEasiestHardestQuestions(questionAnalytics);
    const scoreDistribution = computeScoreDistribution(attempts);
    const studentPerformance = rankStudentAttempts(attempts, quiz.questions);

    res.json({
      test: {
        _id: quiz._id,
        title: quiz.title,
        subject: quiz.subject,
        testType: quiz.testType,
        totalMarks: quiz.totalMarks,
        totalQuestions
      },
      overview,
      performanceMetrics,
      questionAnalytics,
      easiestQuestion: easiest,
      hardestQuestion: hardest,
      scoreDistribution,
      studentPerformance
    });
  } catch (error) {
    console.error('Get test analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get student analytics (admin, mentor)
router.get('/analytics/student/:studentId', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    if (req.user.role === 'mentor') {
      const assignment = await MentorStudentAssignment.findOne({
        mentor: req.user._id,
        student: req.params.studentId,
        isActive: true
      });

      if (!assignment) {
        return res.status(403).json({ message: 'Not authorized to view this student\'s analytics' });
      }
    }

    const { range } = req.query;

    let attempts = await QuizAttempt.find({
      student: req.params.studentId,
      status: { $in: ['completed', 'auto_submitted'] }
    })
      .populate('quiz', 'title subject testType totalMarks')
      .sort({ endTime: -1 });

    attempts = filterAttemptsByDateRange(attempts, range);

    const summary = aggregateStudentSummary(attempts);
    const subjectStats = aggregateSubjectStats(attempts);
    const trend = computeTrend(attempts);
    const insights = computeInsights({ attempts, summary, subjectStats });

    const subjectWise = {};
    subjectStats.forEach((s) => {
      subjectWise[s.subjectId] = {
        tests: s.tests,
        totalMarks: s.totalMarks,
        obtainedMarks: s.obtainedMarks,
      };
    });

    res.json({
      summary,
      attempts: attempts.map(a => {
        const stats = computeAttemptStats(a);
        return {
          _id: a._id,
          quiz: a.quiz,
          score: a.score,
          totalQuestions: stats.totalQuestions,
          marksObtained: stats.marksObtained,
          totalMarks: stats.totalMarks,
          scorePercentage: stats.scorePercentage,
          accuracy: stats.accuracy,
          correct: stats.correct,
          incorrect: stats.incorrect,
          skipped: stats.skipped,
          attempted: stats.attempted,
          percentage: stats.percentage,
          endTime: a.endTime,
          tabSwitchCount: a.tabSwitchCount
        };
      }),
      subjectWise,
      trend,
      insights,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Share quiz with additional students (for Past Tests feature)
router.put('/:id/share', auth, authorize('admin'), async (req, res) => {
  try {
    const { studentIds, assignToAllFreeUsers } = req.body;

    let targetStudentIds = studentIds || [];
    const isAssignToAllFree = assignToAllFreeUsers === true;

    if (isAssignToAllFree) {
      const freeUsers = await User.find({ role: 'student', isFreeUser: true }).select('_id');
      const freeUserIds = freeUsers.map(u => u._id.toString());
      targetStudentIds = Array.from(new Set([...targetStudentIds, ...freeUserIds]));
    }

    if (!isAssignToAllFree && targetStudentIds.length === 0) {
      return res.status(400).json({ message: 'Please provide student IDs to share with' });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    if (isAssignToAllFree) {
      quiz.assignToAllFreeUsers = true;
    }

    // Add new students (avoid duplicates)
    const currentStudents = quiz.assignedStudents.map(s => s.toString());
    const newStudents = targetStudentIds.filter(id => !currentStudents.includes(id));

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

      await notifyQuizAssignedToStudents({
        studentIds: newStudents,
        quiz,
        assignedByName: req.user?.name || 'Admin'
      });
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
    const attempt = await QuizAttempt.findById(req.params.id).populate('quiz', 'createdBy assignedMentors');
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    // SECURITY: only the owning student, an admin, or a mentor assigned to
    // that student may view this attempt. Do not rely on frontend routing alone.
    const isOwner = attempt.student.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    let isAuthorizedMentor = false;
    if (!isOwner && !isAdmin && req.user.role === 'mentor') {
      const assignment = await MentorStudentAssignment.findOne({
        mentor: req.user._id,
        student: attempt.student,
        isActive: true
      });
      isAuthorizedMentor = !!assignment;
    }

    if (!isOwner && !isAdmin && !isAuthorizedMentor) {
      return res.status(403).json({ message: 'You are not authorized to view this attempt' });
    }

    res.json(attempt);
  } catch (error) {
    console.error('Get attempt error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;
