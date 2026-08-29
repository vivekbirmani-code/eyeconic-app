const mongoose = require('mongoose');
const QuestionBank = require('../models/QuestionBank');

const COMPLETED_STATUSES = ['completed', 'auto_submitted'];

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
};

const isAnswerRecorded = (selectedAnswer) => {
  if (selectedAnswer === undefined || selectedAnswer === null || selectedAnswer === -1) {
    return false;
  }
  if (Array.isArray(selectedAnswer)) {
    return selectedAnswer.length > 0;
  }
  if (typeof selectedAnswer === 'object') {
    return Object.keys(selectedAnswer).length > 0;
  }
  return true;
};

/**
 * Aggregate per-question attempt history for a student across completed attempts.
 * Returns a Map keyed by questionId string.
 */
async function aggregateQuestionHistoryForStudent(studentId, questionIds, options = {}) {
  const { excludeAttemptId } = options;
  const studentObjectId = toObjectId(studentId);
  if (!studentObjectId) return new Map();

  const normalizedQuestionIds = [...new Set(
    (questionIds || [])
      .map(toObjectId)
      .filter(Boolean)
  )];

  if (normalizedQuestionIds.length === 0) {
    return new Map();
  }

  const matchStage = {
    student: studentObjectId,
    status: { $in: COMPLETED_STATUSES },
  };

  if (excludeAttemptId) {
    const excludeId = toObjectId(excludeAttemptId);
    if (excludeId) {
      matchStage._id = { $ne: excludeId };
    }
  }

  const rows = await mongoose.model('QuizAttempt').aggregate([
    { $match: matchStage },
    { $unwind: '$answers' },
    {
      $match: {
        'answers.questionId': { $in: normalizedQuestionIds },
      },
    },
    {
      $group: {
        _id: '$answers.questionId',
        totalAttempts: { $sum: 1 },
        correctAttempts: {
          $sum: {
            $cond: [{ $eq: ['$answers.isCorrect', true] }, 1, 0],
          },
        },
        incorrectAttempts: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$answers.isCorrect', false] },
                  {
                    $or: [
                      { $isArray: '$answers.selectedAnswer' },
                      {
                        $and: [
                          { $ne: ['$answers.selectedAnswer', null] },
                          { $ne: ['$answers.selectedAnswer', -1] },
                        ],
                      },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        skippedAttempts: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$answers.selectedAnswer', null] },
                  { $eq: ['$answers.selectedAnswer', -1] },
                ],
              },
              1,
              0,
            ],
          },
        },
        lastAttemptAt: { $max: '$endTime' },
        lastIncorrectAt: {
          $max: {
            $cond: [
              {
                $and: [
                  { $eq: ['$answers.isCorrect', false] },
                  {
                    $or: [
                      { $isArray: '$answers.selectedAnswer' },
                      {
                        $and: [
                          { $ne: ['$answers.selectedAnswer', null] },
                          { $ne: ['$answers.selectedAnswer', -1] },
                        ],
                      },
                    ],
                  },
                ],
              },
              '$endTime',
              null,
            ],
          },
        },
      },
    },
  ]);

  const historyMap = new Map();
  rows.forEach((row) => {
    const key = String(row._id);
    historyMap.set(key, {
      questionId: key,
      totalAttempts: row.totalAttempts || 0,
      correctAttempts: row.correctAttempts || 0,
      incorrectAttempts: row.incorrectAttempts || 0,
      skippedAttempts: row.skippedAttempts || 0,
      previousIncorrectAttempts: row.incorrectAttempts || 0,
      lastAttemptAt: row.lastAttemptAt || null,
      lastIncorrectAt: row.lastIncorrectAt || null,
    });
  });

  return historyMap;
}

/**
 * Questions the student has answered incorrectly on multiple occasions.
 * Sorted by incorrectAttempts desc, then incorrect percentage desc.
 */
async function getFrequentlyMissedQuestions(studentId, options = {}) {
  const {
    minIncorrectAttempts = 2,
    limit = 15,
    excludeAttemptId,
    excludeQuestionIds = [],
  } = options;

  const studentObjectId = toObjectId(studentId);
  if (!studentObjectId) return [];

  const matchStage = {
    student: studentObjectId,
    status: { $in: COMPLETED_STATUSES },
  };

  if (excludeAttemptId) {
    const excludeId = toObjectId(excludeAttemptId);
    if (excludeId) {
      matchStage._id = { $ne: excludeId };
    }
  }

  const excludedIds = excludeQuestionIds
    .map(toObjectId)
    .filter(Boolean);

  const pipeline = [
    { $match: matchStage },
    { $unwind: '$answers' },
    {
      $match: {
        'answers.questionId': { $exists: true, $ne: null },
        ...(excludedIds.length > 0
          ? { 'answers.questionId': { $nin: excludedIds } }
          : {}),
      },
    },
    {
      $group: {
        _id: '$answers.questionId',
        totalAttempts: { $sum: 1 },
        correctAttempts: {
          $sum: { $cond: [{ $eq: ['$answers.isCorrect', true] }, 1, 0] },
        },
        incorrectAttempts: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$answers.isCorrect', false] },
                  {
                    $or: [
                      { $isArray: '$answers.selectedAnswer' },
                      {
                        $and: [
                          { $ne: ['$answers.selectedAnswer', null] },
                          { $ne: ['$answers.selectedAnswer', -1] },
                        ],
                      },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        latestResult: { $last: '$answers.isCorrect' },
        latestAttemptAt: { $max: '$endTime' },
        topicName: { $last: '$answers.metadataSnapshot.topicName' },
        subjectName: { $last: '$answers.metadataSnapshot.subjectName' },
      },
    },
    {
      $match: {
        incorrectAttempts: { $gte: minIncorrectAttempts },
      },
    },
    {
      $addFields: {
        incorrectPercentage: {
          $cond: [
            { $gt: ['$totalAttempts', 0] },
            {
              $multiply: [
                { $divide: ['$incorrectAttempts', '$totalAttempts'] },
                100,
              ],
            },
            0,
          ],
        },
      },
    },
    { $sort: { incorrectAttempts: -1, incorrectPercentage: -1, latestAttemptAt: -1 } },
    { $limit: limit },
  ];

  const rows = await mongoose.model('QuizAttempt').aggregate(pipeline);
  if (rows.length === 0) return [];

  const questionDocs = await QuestionBank.find({
    _id: { $in: rows.map((row) => row._id) },
  })
    .select('question topicName subject')
    .populate('subject', 'name')
    .lean();

  const questionById = new Map(
    questionDocs.map((doc) => [String(doc._id), doc])
  );

  return rows.map((row) => {
    const questionDoc = questionById.get(String(row._id));
    const subjectName = row.subjectName
      || questionDoc?.subject?.name
      || null;
    const topicName = row.topicName || questionDoc?.topicName || null;

    return {
      questionId: String(row._id),
      question: questionDoc?.question || 'Question unavailable',
      totalAttempts: row.totalAttempts,
      correctAttempts: row.correctAttempts,
      incorrectAttempts: row.incorrectAttempts,
      incorrectPercentage: Math.round(row.incorrectPercentage || 0),
      latestResult: row.latestResult === true ? 'correct' : 'incorrect',
      latestAttemptAt: row.latestAttemptAt,
      topicName,
      subjectName,
      section: subjectName || topicName || null,
    };
  });
}

/**
 * Compute total time taken in seconds for an attempt.
 */
function computeTimeTakenSeconds(attempt, questions = []) {
  if (attempt?.startTime && attempt?.endTime) {
    const ms = new Date(attempt.endTime) - new Date(attempt.startTime);
    if (Number.isFinite(ms) && ms >= 0) {
      return Math.round(ms / 1000);
    }
  }

  if (Array.isArray(attempt?.answers) && attempt.answers.length > 0) {
    const total = attempt.answers.reduce(
      (sum, answer) => sum + (Number(answer.timeSpent) || 0),
      0
    );
    if (total > 0) return total;
  }

  if (Array.isArray(attempt?.sectionPerformance)) {
    const total = attempt.sectionPerformance.reduce(
      (sum, section) => sum + (Number(section.timeSpent) || 0),
      0
    );
    if (total > 0) return total;
  }

  return 0;
}

function classifyQuestionResult(answer) {
  if (!answer || !isAnswerRecorded(answer.selectedAnswer)) {
    return 'unattempted';
  }
  return answer.isCorrect === true ? 'correct' : 'incorrect';
}

module.exports = {
  aggregateQuestionHistoryForStudent,
  getFrequentlyMissedQuestions,
  computeTimeTakenSeconds,
  classifyQuestionResult,
  isAnswerRecorded,
};
