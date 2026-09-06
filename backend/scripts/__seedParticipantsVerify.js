// TEMP verification seed — creates a public quiz + guest attempts against the
// in-memory harness DB. Deleted after the verification run.
const mongoose = require('mongoose');
const User = require('../models/User');
const Subject = require('../models/Subject');
const QuestionBank = require('../models/QuestionBank');
const Quiz = require('../models/Quiz');
const Guest = require('../models/Guest');
const GuestAttempt = require('../models/GuestAttempt');

const MONGO = process.env.SEED_MONGO_URI || 'mongodb+srv://REDACTED:REDACTED@neet.com' });
  if (!admin) {
    admin = await User.create({ name: 'Admin', email: 'admin@neet.com', password: 'admin123', role: 'admin', isActive: true });
  }

  // Subject + 6 questions
  let subject = await Subject.findOne({ name: 'Pathology' });
  if (!subject) subject = await Subject.create({ name: 'Pathology', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 6; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Participants verify Q${i + 1}?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
    }));
  }

  const shareToken = `verify-participants-${Date.now()}`;
  const quiz = await Quiz.create({
    title: 'Public Participants Card Verify',
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin._id,
    isPublic: true,
    shareToken,
    assignedStudents: [],
  });

  // Verified lead via the model (never raw insert — hydration matters)
  const makeLead = async ({ name, email, phone, consent }) => {
    const lead = new Guest({
      name, email, phone,
      emailVerifiedAt: new Date(),
      marketingConsent: { granted: consent, updatedAt: new Date() },
      source: 'web',
      firstQuiz: quiz._id,
      quizzesTaken: [quiz._id],
      lastActiveAt: new Date(),
    });
    await lead.save();
    return lead;
  };

  const vivek = await makeLead({ name: 'Vivek Birmani', email: 'vivek.birmani@example.com', phone: '+919876543210', consent: true });
  const ananya = await makeLead({ name: 'Ananya Krishnamurthy Subramaniam Venkatesan', email: 'ananya.krishnamurthy.subramaniam@engineering-institute-chennai.example.org', phone: '+919812345678', consent: false });

  // Legacy pre-email lead: raw insert, phone-verified, no email field shape
  const now = new Date();
  const legacyInsert = await Guest.collection.insertOne({
    name: 'Legacy Lead',
    phone: '+919876500000',
    phoneVerifiedAt: now,
    marketingConsent: { granted: true, updatedAt: now },
    source: 'web',
    firstQuiz: null,
    quizzesTaken: [],
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const buildAnswers = (correctCount, attemptedCount) =>
    questions.map((q, i) => ({
      questionIndex: i,
      questionId: q._id,
      selectedAnswer: i < attemptedCount ? (i < correctCount ? 1 : 0) : -1,
      isCorrect: i < correctCount,
      markedForReview: false,
      timeSpent: 10,
    }));

  const sectionPerf = (correct, incorrect, skipped) => [{
    sectionName: 'Pathology', correct, incorrect, skipped, timeSpent: 60, accuracy: correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0,
  }];

  const attempts = [
    {
      // Matches the screenshot: 2 correct / 4 wrong / 0 skipped → 4/24 = 17%, acc 33%, ~1 min
      lead: vivek, guestName: 'Vivek Birmani', guestEmail: 'vivek.birmani@example.com', guestPhone: '+919876543210',
      answers: buildAnswers(2, 6), score: 2, marksObtained: 4, totalMarks: 24,
      sectionPerformance: sectionPerf(2, 4, 0),
      startTime: new Date(Date.now() - 65 * 1000), endTime: new Date(),
    },
    {
      // Long name + very long email, no consent, 100%, 2h 5m, 2 days ago
      lead: ananya, guestName: 'Ananya Krishnamurthy Subramaniam Venkatesan', guestEmail: 'ananya.krishnamurthy.subramaniam@engineering-institute-chennai.example.org', guestPhone: '+919812345678',
      answers: buildAnswers(6, 6), score: 6, marksObtained: 24, totalMarks: 24,
      sectionPerformance: sectionPerf(6, 0, 0),
      startTime: new Date(Date.now() - 2 * 86400e3 - 7500 * 1000), endTime: new Date(Date.now() - 2 * 86400e3),
    },
    {
      // Legacy lead: no email, phone-verified, all skipped, 0 marks, 45s, yesterday
      lead: { _id: legacyInsert.insertedId }, guestName: 'Legacy Lead', guestEmail: null, guestPhone: '+919876500000',
      answers: buildAnswers(0, 0), score: 0, marksObtained: 0, totalMarks: 24,
      sectionPerformance: sectionPerf(0, 0, 6),
      startTime: new Date(Date.now() - 86400e3 - 45 * 1000), endTime: new Date(Date.now() - 86400e3),
    },
  ];

  for (const a of attempts) {
    await GuestAttempt.create({
      quiz: quiz._id,
      guestId: `verify-${a.lead._id}`,
      guest: a.lead._id,
      guestName: a.guestName,
      guestEmail: a.guestEmail,
      guestPhone: a.guestPhone,
      answers: a.answers,
      score: a.score,
      totalQuestions: 6,
      marksObtained: a.marksObtained,
      totalMarks: a.totalMarks,
      sectionPerformance: a.sectionPerformance,
      status: 'completed',
      startTime: a.startTime,
      endTime: a.endTime,
      tabSwitchCount: 0,
    });
  }

  console.log('SEEDED quiz:', quiz._id.toString(), 'token:', shareToken);
  console.log('PARTICIPANTS: 3 (Vivek 17%, Ananya 100% long-name, Legacy no-email)');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
