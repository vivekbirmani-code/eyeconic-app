const { QUESTION_TYPES } = require('../constants/question');

/**
 * Determine whether a submitted response for a given question type counts as
 * "answered" at all (vs. skipped). Skipped questions are never marked
 * incorrect and never incur negative marking.
 */
function isAnswered(questionType, selectedAnswer) {
    if (selectedAnswer === undefined || selectedAnswer === null) return false;

    switch (questionType) {
        case QUESTION_TYPES.MCQ_SINGLE:
        case QUESTION_TYPES.IMAGE_BASED:
        case QUESTION_TYPES.ASSERTION_REASON:
            return typeof selectedAnswer === 'number' && selectedAnswer >= 0;

        case QUESTION_TYPES.MULTIPLE_CORRECT:
            return Array.isArray(selectedAnswer) && selectedAnswer.length > 0;

        case QUESTION_TYPES.MATCH_THE_FOLLOWING: {
            if (!selectedAnswer || typeof selectedAnswer !== 'object' || Array.isArray(selectedAnswer)) return false;
            return Object.keys(selectedAnswer).length > 0;
        }

        case QUESTION_TYPES.NUMERICAL:
            return typeof selectedAnswer === 'number' && Number.isFinite(selectedAnswer);

        default:
            // Legacy questions created before questionType existed behave as mcq_single.
            return typeof selectedAnswer === 'number' && selectedAnswer >= 0;
    }
}

const arraysEqualAsSets = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const setA = new Set(a.map(Number));
    const setB = new Set(b.map(Number));
    if (setA.size !== setB.size) return false;
    for (const v of setA) if (!setB.has(v)) return false;
    return true;
};

const mappingsEqual = (submitted, correct) => {
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return false;
    if (!correct || typeof correct !== 'object') return false;
    const correctKeys = Object.keys(correct);
    const submittedKeys = Object.keys(submitted);
    if (correctKeys.length !== submittedKeys.length) return false;
    return correctKeys.every((k) => String(submitted[k]) === String(correct[k]));
};

/**
 * Grade a single question response server-side. Never trust a client-supplied
 * isCorrect — this is the only source of truth for correctness.
 *
 * @param {object} question - canonical QuestionBank document (or plain object)
 *   with `questionType` and `correctAnswer`.
 * @param {*} selectedAnswer - the student's submitted response, shaped
 *   according to the question's type (see model comments).
 * @returns {{ answered: boolean, isCorrect: boolean }}
 */
function gradeQuestion(question, selectedAnswer) {
    const type = question.questionType || QUESTION_TYPES.MCQ_SINGLE;
    const answered = isAnswered(type, selectedAnswer);

    if (!answered) {
        return { answered: false, isCorrect: false };
    }

    let isCorrect = false;

    switch (type) {
        case QUESTION_TYPES.MCQ_SINGLE:
        case QUESTION_TYPES.IMAGE_BASED:
        case QUESTION_TYPES.ASSERTION_REASON:
            isCorrect = Number(selectedAnswer) === Number(question.correctAnswer);
            break;

        case QUESTION_TYPES.MULTIPLE_CORRECT:
            isCorrect = arraysEqualAsSets(selectedAnswer, question.correctAnswer);
            break;

        case QUESTION_TYPES.MATCH_THE_FOLLOWING:
            isCorrect = mappingsEqual(selectedAnswer, question.correctAnswer);
            break;

        case QUESTION_TYPES.NUMERICAL:
            isCorrect = Number(selectedAnswer) === Number(question.correctAnswer);
            break;

        default:
            isCorrect = Number(selectedAnswer) === Number(question.correctAnswer);
    }

    return { answered: true, isCorrect };
}

module.exports = {
    isAnswered,
    gradeQuestion,
};
