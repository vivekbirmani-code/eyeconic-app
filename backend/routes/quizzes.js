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

// Get all quizzes (role-based access)
router.get('/', auth, async (req, res) => {
  try {
    let quizzes;

    if (req.user.role === 'admin') {
      // Admin sees all quizzes
      quizzes = await Quiz.find({ isActive: true })
        .populate('subject', 'name')
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 });
    } else if (req.user.role === 'mentor') {
      // Mentor sees all quizzes for now
      quizzes = await Quiz.find({ isActive: true })
        .populate('subject', 'name')
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 });
    } else {
      // Student sees only quizzes assigned to them
      quizzes = await Quiz.find({
        isActive: true,
        assignedStudents: req.user._id
      })
        .populate('subject', 'name')
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 });

      // Add attempt status for each quiz
      const quizIds = quizzes.map(q => q._id);
      const attempts = await QuizAttempt.find({
        quiz: { $in: quizIds },
        student: req.user._id
      });

      quizzes = quizzes.map(quiz => {
        const attempt = attempts.find(a => a.quiz.toString() === quiz._id.toString());
        return {
          ...quiz.toObject(),
          attemptStatus: attempt ? {
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
          }
        };
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
      selectedQuestionIds  // NEW: optional array of specific question IDs for manual selection
    } = req.body;

    console.log('Creating quiz from bank:', { title, subject, subjects, testType, numberOfQuestions, selectedQuestionIds: selectedQuestionIds?.length });

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
      createdBy: req.user._id
    });

    await quiz.save();

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

    const { quizTitle, testType, duration, subjectId, instructions } = req.body;

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
      let subId = subjectsMap[qData.subjectName.toLowerCase()];

      // If subject not found, create it
      if (!subId) {
        const newSub = new Subject({
          name: qData.subjectName,
          year: '1st',
          displayOrder: 99
        });
        await newSub.save();
        subId = newSub._id;
        subjectsMap[qData.subjectName.toLowerCase()] = subId;
      }

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
          marks: processedQData.marks,
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

    // Create Quiz
    const quiz = new Quiz({
      title: quizTitle,
      subject: firstSubjectId || subjectId || createdQuestions[0]?.subject,
      testType: testType || 'daily',
      duration: parseInt(duration) || 30,
      instructions: instructions ? JSON.parse(instructions) : [],
      questions: questionIds,
      assignedStudents: [],
      createdBy: req.user._id
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
    const { title, duration, instructions, questions, testType, subject, assignedStudents } = req.body;

    // Check if quiz exists
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

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

    if (questions && questions.length > 0) {
      quiz.questions = questions;

      // Recalculate total marks (optional if we want to be precise)
      const QuestionBank = require('../models/QuestionBank');
      const qs = await QuestionBank.find({ _id: { $in: questions } });
      quiz.totalMarks = qs.reduce((sum, q) => sum + (q.marks || 1), 0);
    }

    await quiz.save();

    res.json({ message: 'Quiz updated successfully', quiz });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
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
        select: 'question options marks topicName questionImage optionImages' // Never send correctAnswer or explanation
      });

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
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

    res.json(quiz);
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

    const attempt = await QuizAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id
    }).populate('quiz');

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    if (attempt.status === 'completed') {
      return res.json({
        message: 'Quiz already submitted',
        attemptId: attempt._id
      });
    }

    const quiz = await Quiz.findById(attempt.quiz._id).populate('questions');

    // Calculate score
    let correctCount = 0;
    let incorrectCount = 0;
    let skippedCount = 0;
    let marksObtained = 0;

    const sectionPerformance = {};

    quiz.questions.forEach((question, index) => {
      const answer = attempt.answers.find(a => a.questionIndex === index);
      const section = question.topicName || 'General';

      if (!sectionPerformance[section]) {
        sectionPerformance[section] = {
          sectionName: section,
          correct: 0,
          incorrect: 0,
          skipped: 0,
          timeSpent: 0
        };
      }

      if (!answer || answer.selectedAnswer === -1 || answer.selectedAnswer === undefined) {
        skippedCount++;
        sectionPerformance[section].skipped++;
        if (answer) answer.isCorrect = false;
      } else if (answer.selectedAnswer === question.correctAnswer) {
        correctCount++;
        marksObtained += question.marks || 1;
        sectionPerformance[section].correct++;
        answer.isCorrect = true;
      } else {
        incorrectCount++;
        sectionPerformance[section].incorrect++;
        answer.isCorrect = false;
      }

      if (answer) {
        sectionPerformance[section].timeSpent += answer.timeSpent || 0;
      }
    });

    // Update attempt
    attempt.status = isAutoSubmit ? 'auto_submitted' : 'completed';
    attempt.endTime = new Date();
    attempt.score = correctCount;
    attempt.totalQuestions = quiz.questions.length;
    attempt.marksObtained = marksObtained;
    attempt.totalMarks = quiz.totalMarks;
    attempt.sectionPerformance = Object.values(sectionPerformance);

    await attempt.save();

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
    console.error('Submit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get results (after submission)
router.get('/:id/attempt/:attemptId/results', auth, async (req, res) => {
  try {
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

    // Check access
    if (req.user.role === 'student' && attempt.student._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Include full question details with correct answers (for review)
    const questionsWithAnswers = attempt.quiz.questions.map((q, index) => {
      const userAnswer = attempt.answers.find(a => a.questionIndex === index);
      return {
        _id: q._id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        marks: q.marks,
        topicName: q.topicName,
        userAnswer: userAnswer?.selectedAnswer,
        isCorrect: userAnswer?.isCorrect,
        timeSpent: userAnswer?.timeSpent,
        markedForReview: userAnswer?.markedForReview
      };
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
        sectionPerformance: attempt.sectionPerformance,
        tabSwitchCount: attempt.tabSwitchCount
      },
      quiz: {
        _id: attempt.quiz._id,
        title: attempt.quiz.title,
        subject: attempt.quiz.subject,
        testType: attempt.quiz.testType
      },
      student: attempt.student,
      questions: questionsWithAnswers
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
      .populate('quiz', 'title subject testType')
      .populate('student', 'name email')
      .sort({ retestRequestedAt: -1 });

    res.json(requests);
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

module.exports = router;