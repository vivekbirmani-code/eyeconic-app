const xlsx = require('xlsx');
const { QUESTION_TYPE_LABELS, QUESTION_TYPES } = require('../constants/question');

const TEMPLATE_HEADERS = [
    'SUBJECT', 'TOPIC', 'SUBTOPIC', 'SYSTEM', 'QUESTION_TYPE', 'DIFFICULTY', 'TAGS',
    'QUESTION', 'Q_IMAGE', 'SOLUTION', 'SOLUTION_IMAGE',
    'OPTION1', 'OPTION2', 'OPTION3', 'OPTION4', 'OPTION5', 'OPTION6',
    'O_IMAGE_1', 'O_IMAGE_2', 'O_IMAGE_3', 'O_IMAGE_4', 'O_IMAGE_5', 'O_IMAGE_6',
    'ASSERTION', 'REASON', 'COLUMN_A', 'COLUMN_B', 'CORRECT', 'QID', 'MARROW_CODE',
];

const EXAMPLE_ROWS = [
    {
        SUBJECT: 'Pathology',
        TOPIC: 'Cell Biology',
        SUBTOPIC: 'Organelles',
        SYSTEM: 'Cell Biology',
        QUESTION_TYPE: QUESTION_TYPE_LABELS[QUESTION_TYPES.MCQ_SINGLE],
        DIFFICULTY: 'medium',
        TAGS: 'high-yield,cell-biology',
        QUESTION: 'What is the powerhouse of the cell?',
        OPTION1: 'Nucleus',
        OPTION2: 'Mitochondria',
        OPTION3: 'Ribosome',
        OPTION4: 'Golgi apparatus',
        CORRECT: 'B',
        QID: 'DEMO-001',
        MARROW_CODE: 'DEMO-001',
    },
    {
        SUBJECT: 'Biology',
        TOPIC: 'Genetics',
        SUBTOPIC: 'Mendelian Inheritance',
        SYSTEM: 'Genetics',
        QUESTION_TYPE: QUESTION_TYPE_LABELS[QUESTION_TYPES.MULTIPLE_CORRECT],
        DIFFICULTY: 'medium',
        TAGS: 'high-yield,genetics',
        QUESTION: 'Which of the following are nitrogenous bases found in DNA?',
        OPTION1: 'Adenine',
        OPTION2: 'Uracil',
        OPTION3: 'Guanine',
        OPTION4: 'Cytosine',
        OPTION5: 'Thymine',
        CORRECT: 'A,C,E',
        QID: 'DEMO-002',
        MARROW_CODE: 'DEMO-002',
    },
    {
        SUBJECT: 'Physics',
        TOPIC: 'Mechanics',
        SUBTOPIC: "Newton's Laws",
        SYSTEM: 'Mechanics',
        QUESTION_TYPE: QUESTION_TYPE_LABELS[QUESTION_TYPES.ASSERTION_REASON],
        DIFFICULTY: 'medium',
        TAGS: 'conceptual,physics',
        QUESTION: 'Consider the following assertion and reason.',
        OPTION1: 'A and R are both true, and R is the correct explanation of A.',
        OPTION2: 'A and R are both true, but R is not the correct explanation of A.',
        OPTION3: 'A is true, but R is false.',
        OPTION4: 'A is false, but R is true.',
        ASSERTION: 'An object moving with constant velocity has zero net force acting on it.',
        REASON: 'Constant velocity means that the acceleration of the object is zero.',
        CORRECT: 'A',
        QID: 'DEMO-003',
        MARROW_CODE: 'DEMO-003',
    },
    {
        SUBJECT: 'Chemistry',
        TOPIC: 'Physical Chemistry',
        SUBTOPIC: 'Mole Concept',
        SYSTEM: 'Chemistry',
        QUESTION_TYPE: QUESTION_TYPE_LABELS[QUESTION_TYPES.NUMERICAL],
        DIFFICULTY: 'easy',
        TAGS: 'calculation,chemistry',
        QUESTION: 'How many moles are present in 18 grams of water (H₂O)?',
        CORRECT: '1',
        QID: 'DEMO-004',
        MARROW_CODE: 'DEMO-004',
    },
    {
        SUBJECT: 'Biology',
        TOPIC: 'Human Physiology',
        SUBTOPIC: 'Cardiovascular System',
        SYSTEM: 'Cardiovascular System',
        QUESTION_TYPE: QUESTION_TYPE_LABELS[QUESTION_TYPES.MATCH_THE_FOLLOWING],
        DIFFICULTY: 'hard',
        TAGS: 'high-yield,matching',
        QUESTION: 'Match the cardiac structures with their primary functions.',
        COLUMN_A: 'A. SA node; B. AV node; C. Bundle of His; D. Purkinje fibres',
        COLUMN_B: '1. Atrial pacemaker; 2. Delays impulse; 3. Conducts impulse through ventricles; 4. Ventricular conduction',
        CORRECT: '1-A,2-B,3-C,4-D',
        QID: 'DEMO-005',
        MARROW_CODE: 'DEMO-005',
    },
    {
        SUBJECT: 'Pathology',
        TOPIC: 'Histology',
        SUBTOPIC: 'Epithelium',
        SYSTEM: 'Histology',
        QUESTION_TYPE: QUESTION_TYPE_LABELS[QUESTION_TYPES.IMAGE_BASED],
        DIFFICULTY: 'medium',
        TAGS: 'image,histology',
        QUESTION: 'Identify the tissue shown in the image.',
        Q_IMAGE: 'https://example.com/sample-tissue.jpg',
        OPTION1: 'Simple squamous',
        OPTION2: 'Stratified squamous',
        OPTION3: 'Simple columnar',
        OPTION4: 'Transitional',
        CORRECT: 'C',
        QID: 'DEMO-006',
        MARROW_CODE: 'DEMO-006',
    },
];

const FORMAT_GUIDE_ROWS = [
    {
        QUESTION_TYPE: 'Canonical id',
        'Relevant columns': 'Required fields',
        CORRECT: 'Example',
    },
    {
        QUESTION_TYPE: QUESTION_TYPES.MCQ_SINGLE,
        'Relevant columns': 'OPTION1–OPTION6; CORRECT',
        CORRECT: 'B or 2 or exact option text',
    },
    {
        QUESTION_TYPE: QUESTION_TYPES.MULTIPLE_CORRECT,
        'Relevant columns': 'OPTION1–OPTION6; CORRECT',
        CORRECT: 'A,C or 1,3',
    },
    {
        QUESTION_TYPE: QUESTION_TYPES.ASSERTION_REASON,
        'Relevant columns': 'ASSERTION; REASON; OPTION1–OPTION4 (optional); CORRECT',
        CORRECT: 'A or 1',
    },
    {
        QUESTION_TYPE: QUESTION_TYPES.MATCH_THE_FOLLOWING,
        'Relevant columns': 'COLUMN_A; COLUMN_B; CORRECT',
        CORRECT: '1-C,2-A,3-B',
    },
    {
        QUESTION_TYPE: QUESTION_TYPES.IMAGE_BASED,
        'Relevant columns': 'Q_IMAGE; OPTION1–OPTION6; CORRECT',
        CORRECT: 'C or 3',
    },
    {
        QUESTION_TYPE: QUESTION_TYPES.NUMERICAL,
        'Relevant columns': 'CORRECT (OPTION1–OPTION4 optional distractors)',
        CORRECT: '1 or 12.5',
    },
];

/**
 * Build a canonical Question Bank import template workbook buffer.
 * Uses human-readable QUESTION_TYPE labels in example rows and canonical ids
 * in the Format Guide sheet.
 */
function buildImportTemplateBuffer() {
    const workbook = xlsx.utils.book_new();

    const questionSheet = xlsx.utils.json_to_sheet(EXAMPLE_ROWS, { header: TEMPLATE_HEADERS });
    xlsx.utils.book_append_sheet(workbook, questionSheet, 'Question Bank');

    const guideSheet = xlsx.utils.json_to_sheet(FORMAT_GUIDE_ROWS);
    xlsx.utils.book_append_sheet(workbook, guideSheet, 'Format Guide');

    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    buildImportTemplateBuffer,
    TEMPLATE_HEADERS,
    EXAMPLE_ROWS,
};
