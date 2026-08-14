const { QUESTION_TYPES } = require('../constants/question');

/**
 * Build a trusted, server-derived metadata snapshot for a QuizAttempt/GuestAttempt
 * answer at grading time. Always derived from the canonical QuestionBank
 * document (never from client input), so historical analytics remain stable
 * even if the question's metadata is edited later.
 *
 * `question` must have `subject` populated with at least `name` (or be null,
 * in which case subjectName falls back gracefully).
 */
function buildMetadataSnapshot(question) {
    const subject = question.subject;
    const subjectId = subject && subject._id ? subject._id : (subject || undefined);
    const subjectName = subject && subject.name ? subject.name : undefined;

    return {
        subjectId,
        subjectName,
        topicName: question.topicName || '',
        subtopicName: question.subtopicName || '',
        system: question.system || '',
        questionType: question.questionType || QUESTION_TYPES.MCQ_SINGLE,
        tags: Array.isArray(question.tags) ? question.tags : [],
        difficulty: question.difficulty || undefined,
    };
}

module.exports = {
    buildMetadataSnapshot,
};
