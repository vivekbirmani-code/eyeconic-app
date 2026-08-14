const xlsx = require('xlsx');
const { QUESTION_TYPES, normalizeQuestionType, normalizeDifficulty } = require('../constants/question');

const IMPORT_SHEET_NAMES = ['question bank', 'questions', 'questionbank', 'sheet1'];

// Standardize header names
const normalizeHeader = (header) => {
    if (!header) return '';
    return header.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const str = (value) => (value === undefined || value === null ? '' : String(value).trim());

const looksLikeAnswerLetterOrIndex = (value) => /^[A-F]$|^[1-6]$/.test(str(value).toUpperCase());

const looksLikeMappingAnswer = (value) => {
    const raw = str(value);
    if (!raw) return false;
    return /^\d+\s*[-:=>]\s*[A-Za-z0-9]/.test(raw) && raw.includes(',');
};

const looksLikeSemicolonList = (value) => {
    const raw = str(value);
    return raw.includes(';') || raw.includes('\n') || raw.includes('|');
};

/**
 * Split a list cell into individual entries. Supports newline, semicolon, or pipe
 * separators. Preserves entry text (including optional leading labels like "A.").
 */
const splitList = (value) => {
    if (value === undefined || value === null) return [];
    return String(value)
        .split(/[\n|;]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
};

/**
 * Recover type-specific values that were placed in adjacent columns in older or
 * hand-edited templates. Only runs when the canonical columns are empty and the
 * misplaced cells contain values that match the expected shape for that type.
 *
 * Known misplacement pattern (30-column template):
 *   assertion_reason: assertion → O_IMAGE_6, reason → ASSERTION, CORRECT → QID
 *   match_the_following: COLUMN_A → ASSERTION, COLUMN_B → REASON, CORRECT → QID
 */
const recoverMisplacedTypeFields = (questionType, rowData) => {
    if (!questionType) return rowData;

    if (questionType === QUESTION_TYPES.ASSERTION_REASON) {
        const assertionInWrongCol = str(rowData.option6Image);
        const reasonInWrongCol = str(rowData.assertion);
        const correctInQid = !str(rowData.correctRaw) && looksLikeAnswerLetterOrIndex(rowData.qid);

        if (!str(rowData.reason) && assertionInWrongCol && reasonInWrongCol) {
            rowData.assertion = assertionInWrongCol;
            rowData.reason = reasonInWrongCol;
            if (correctInQid) {
                rowData.correctRaw = rowData.qid;
                rowData.qid = undefined;
            }
            rowData.option6Image = undefined;
        }
    }

    if (questionType === QUESTION_TYPES.MATCH_THE_FOLLOWING) {
        const columnAInAssertion = str(rowData.assertion);
        const columnBInReason = str(rowData.reason);
        const correctInQid = !str(rowData.correctRaw) && looksLikeMappingAnswer(rowData.qid);

        if (
            !str(rowData.columnA) &&
            !str(rowData.columnB) &&
            columnAInAssertion &&
            columnBInReason &&
            looksLikeSemicolonList(columnAInAssertion) &&
            looksLikeSemicolonList(columnBInReason)
        ) {
            rowData.columnA = columnAInAssertion;
            rowData.columnB = columnBInReason;
            rowData.assertion = undefined;
            rowData.reason = undefined;
            if (correctInQid) {
                rowData.correctRaw = rowData.qid;
                rowData.qid = undefined;
            }
        }
    }

    return rowData;
};

/**
 * Pick the worksheet that contains question rows. Prefers a sheet named
 * "Question Bank" (or common variants) over the first sheet so workbooks with a
 * leading "Format Guide" sheet still import correctly.
 */
const selectImportWorksheet = (workbook) => {
    const names = workbook.SheetNames || [];
    if (names.length === 0) {
        throw new Error('Excel workbook has no worksheets');
    }

    const preferred = names.find((name) =>
        IMPORT_SHEET_NAMES.includes(name.toLowerCase().trim())
    );

    const sheetName = preferred || names[0];
    return { sheet: workbook.Sheets[sheetName], sheetName };
};

/**
 * Convert an option reference from Excel (letter A-F, 1-based number, or
 * exact option text) into a 0-based option index.
 */
const resolveOptionIndex = (raw, options) => {
    if (raw === undefined || raw === null) return -1;
    const value = String(raw).trim();
    if (!value) return -1;

    const upper = value.toUpperCase();
    if (/^[A-F]$/.test(upper)) {
        return upper.charCodeAt(0) - 'A'.charCodeAt(0);
    }

    const num = Number(value);
    if (Number.isInteger(num) && num >= 1 && num <= (options?.length || 6)) {
        return num - 1;
    }

    if (Array.isArray(options)) {
        const idx = options.findIndex((opt) => str(opt).toUpperCase() === upper);
        if (idx !== -1) return idx;
    }

    return -1;
};

/**
 * Parse a "match the following" correct-mapping cell into a
 * { "<columnAIndex>": "<columnBIndex>" } object.
 * Accepts formats like "1-C,2-A,3-D,4-B" or "1:3,2:1,3:4,4:2".
 */
const parseMapping = (raw, columnBLength) => {
    if (!raw) return null;
    const pairs = String(raw).split(',').map((p) => p.trim()).filter(Boolean);
    const mapping = {};
    for (const pair of pairs) {
        const parts = pair.split(/[-:=>]+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length !== 2) return null;
        const [aRaw, bRaw] = parts;
        const aIdx = Number(aRaw) - 1;
        let bIdx;
        if (/^[A-Za-z]$/.test(bRaw)) {
            bIdx = bRaw.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
        } else {
            bIdx = Number(bRaw) - 1;
        }
        if (!Number.isInteger(aIdx) || aIdx < 0) return null;
        if (!Number.isInteger(bIdx) || bIdx < 0 || bIdx >= columnBLength) return null;
        mapping[String(aIdx)] = String(bIdx);
    }
    return mapping;
};

const HEADERS = {
    SUBJECT: 'subject',
    TOPIC: 'topicName',
    SUBTOPIC: 'subtopicName',
    SYSTEM: 'system',
    QUESTIONTYPE: 'questionType',
    TYPE: 'questionType',
    DIFFICULTY: 'difficulty',
    TAG: 'tags',
    TAGS: 'tags',
    QID: 'qid',
    QUESTION: 'question',
    QIMAGE: 'questionImage',
    ASSERTION: 'assertion',
    REASON: 'reason',
    COLUMNA: 'columnA',
    COLUMNB: 'columnB',
    OPTION1: 'option1',
    OPTION2: 'option2',
    OPTION3: 'option3',
    OPTION4: 'option4',
    OPTION5: 'option5',
    OPTION6: 'option6',
    OIMAGE1: 'option1Image',
    OIMAGE2: 'option2Image',
    OIMAGE3: 'option3Image',
    OIMAGE4: 'option4Image',
    OIMAGE5: 'option5Image',
    OIMAGE6: 'option6Image',
    CORRECT: 'correctRaw',
    CORRECTANSWER: 'correctRaw',
    SOLUTION: 'explanation',
    EXPLANATION: 'explanation',
    SOLUTIONIMAGE: 'explanationImage',
    EXIMAGE: 'explanationImage',
    MARROWCODE: 'marrowCode',
    SOURCE: 'source',
    MARKS: 'marks',
};

const mapRowFromHeaders = (row) => {
    const rowData = {};
    Object.keys(row).forEach((key) => {
        const normalized = normalizeHeader(key);
        if (HEADERS[normalized]) {
            rowData[HEADERS[normalized]] = row[key];
        }
    });
    return rowData;
};

/**
 * Parse an uploaded Question Bank / Quiz Excel workbook into normalized row
 * objects plus a list of row-level validation errors. This is the single
 * canonical parser used by both the standalone Question Bank bulk import and
 * the "import quiz from Excel" flow — do not duplicate this logic elsewhere.
 */
const parseExcel = async (buffer) => {
    try {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const { sheet, sheetName } = selectImportWorksheet(workbook);
        const rawData = xlsx.utils.sheet_to_json(sheet);

        if (!rawData || rawData.length === 0) {
            throw new Error(`Excel sheet "${sheetName}" is empty`);
        }

        const questions = [];
        const errors = [];

        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            const rowNum = i + 2; // header is row 1
            const rowLabel = `Row ${rowNum}`;
            const rowData = mapRowFromHeaders(row);

            // Skip fully blank rows silently.
            if (!rowData.subject && !rowData.question) continue;

            const rowErrors = [];

            const subjectName = str(rowData.subject);
            if (!subjectName) rowErrors.push(`${rowLabel}: Subject is required.`);

            const topicName = str(rowData.topicName);
            if (!topicName) rowErrors.push(`${rowLabel}: Topic is required.`);

            const subtopicName = str(rowData.subtopicName);
            if (!subtopicName) rowErrors.push(`${rowLabel}: Subtopic is required.`);

            const system = str(rowData.system);
            if (!system) rowErrors.push(`${rowLabel}: System is required.`);

            const questionType = normalizeQuestionType(rowData.questionType);
            if (!rowData.questionType) {
                rowErrors.push(`${rowLabel}: Question Type is required.`);
            } else if (!questionType) {
                rowErrors.push(`${rowLabel}: Invalid Question Type "${rowData.questionType}".`);
            }

            const difficulty = normalizeDifficulty(rowData.difficulty);
            if (!rowData.difficulty) {
                rowErrors.push(`${rowLabel}: Difficulty is required.`);
            } else if (!difficulty) {
                rowErrors.push(`${rowLabel}: Difficulty must be one of easy, medium, hard.`);
            }

            const question = str(rowData.question);
            if (!question) rowErrors.push(`${rowLabel}: Question text is required.`);

            if (rowErrors.length > 0 || !questionType) {
                errors.push(...rowErrors);
                continue;
            }

            recoverMisplacedTypeFields(questionType, rowData);

            const tags = rowData.tags
                ? String(rowData.tags).split(',').map((t) => t.trim()).filter(Boolean)
                : [];

            const optionImages = [
                rowData.option1Image, rowData.option2Image, rowData.option3Image,
                rowData.option4Image, rowData.option5Image, rowData.option6Image,
            ].map((v) => str(v) || '');

            const rawOptions = [
                rowData.option1, rowData.option2, rowData.option3,
                rowData.option4, rowData.option5, rowData.option6,
            ].map(str);
            const options = rawOptions.filter((o) => o.length > 0);
            const trimmedOptionImages = optionImages.slice(0, options.length);

            const parsed = {
                qid: str(rowData.qid) || undefined,
                subjectName,
                topicName,
                subtopicName,
                system,
                questionType,
                difficulty: difficulty || undefined,
                tags,
                question,
                questionImage: str(rowData.questionImage) || undefined,
                explanation: str(rowData.explanation),
                explanationImage: str(rowData.explanationImage) || undefined,
                marrowCode: str(rowData.marrowCode) || undefined,
                source: 'excel_import',
            };

            switch (questionType) {
                case QUESTION_TYPES.MCQ_SINGLE:
                case QUESTION_TYPES.IMAGE_BASED: {
                    if (options.length < 2) {
                        rowErrors.push(`${rowLabel}: At least 2 options are required.`);
                        break;
                    }
                    if (questionType === QUESTION_TYPES.IMAGE_BASED && !parsed.questionImage) {
                        rowErrors.push(`${rowLabel}: Image-Based questions require Q_IMAGE.`);
                    }
                    const idx = resolveOptionIndex(rowData.correctRaw, options);
                    if (idx === -1) {
                        rowErrors.push(`${rowLabel}: Invalid correct answer '${rowData.correctRaw}'.`);
                        break;
                    }
                    parsed.options = options;
                    parsed.optionImages = trimmedOptionImages;
                    parsed.correctAnswer = idx;
                    break;
                }

                case QUESTION_TYPES.MULTIPLE_CORRECT: {
                    if (options.length < 2) {
                        rowErrors.push(`${rowLabel}: At least 2 options are required.`);
                        break;
                    }
                    const raws = String(rowData.correctRaw || '').split(/[,;]/).map((v) => v.trim()).filter(Boolean);
                    if (raws.length === 0) {
                        rowErrors.push(`${rowLabel}: At least one correct option must be specified.`);
                        break;
                    }
                    const indices = raws.map((r) => resolveOptionIndex(r, options));
                    if (indices.some((idx) => idx === -1)) {
                        rowErrors.push(`${rowLabel}: Invalid correct answer '${rowData.correctRaw}'.`);
                        break;
                    }
                    parsed.options = options;
                    parsed.optionImages = trimmedOptionImages;
                    parsed.correctAnswer = [...new Set(indices)];
                    break;
                }

                case QUESTION_TYPES.ASSERTION_REASON: {
                    parsed.assertion = str(rowData.assertion);
                    parsed.reason = str(rowData.reason);
                    if (!parsed.assertion) rowErrors.push(`${rowLabel}: Assertion is required.`);
                    if (!parsed.reason) rowErrors.push(`${rowLabel}: Reason is required.`);
                    if (options.length >= 2) {
                        parsed.options = options;
                        parsed.optionImages = trimmedOptionImages;
                    }
                    const optsForIndex = parsed.options && parsed.options.length ? parsed.options : null;
                    const idx = optsForIndex ? resolveOptionIndex(rowData.correctRaw, optsForIndex) : (() => {
                        const n = Number(rowData.correctRaw);
                        return Number.isInteger(n) && n >= 1 && n <= 4 ? n - 1 : -1;
                    })();
                    if (idx === -1) {
                        rowErrors.push(`${rowLabel}: Invalid correct answer '${rowData.correctRaw}'.`);
                        break;
                    }
                    parsed.correctAnswer = idx;
                    break;
                }

                case QUESTION_TYPES.MATCH_THE_FOLLOWING: {
                    const columnA = splitList(rowData.columnA);
                    const columnB = splitList(rowData.columnB);
                    if (columnA.length < 2) rowErrors.push(`${rowLabel}: Column A needs at least 2 entries.`);
                    if (columnB.length < 2) rowErrors.push(`${rowLabel}: Column B needs at least 2 entries.`);
                    if (columnA.length >= 2 && columnB.length >= 2) {
                        const mapping = parseMapping(rowData.correctRaw, columnB.length);
                        if (!mapping || Object.keys(mapping).length !== columnA.length) {
                            rowErrors.push(`${rowLabel}: Invalid or incomplete mapping '${rowData.correctRaw}'.`);
                            break;
                        }
                        parsed.columnA = columnA;
                        parsed.columnB = columnB;
                        parsed.correctAnswer = mapping;
                    }
                    break;
                }

                case QUESTION_TYPES.NUMERICAL: {
                    const num = Number(rowData.correctRaw);
                    if (Number.isNaN(num)) {
                        rowErrors.push(`${rowLabel}: Correct answer must be a valid number.`);
                        break;
                    }
                    parsed.correctAnswer = num;
                    break;
                }

                default:
                    rowErrors.push(`${rowLabel}: Invalid Question Type "${rowData.questionType}".`);
            }

            if (rowErrors.length > 0) {
                errors.push(...rowErrors);
                continue;
            }

            questions.push(parsed);
        }

        return { questions, errors, sheetName };
    } catch (error) {
        throw new Error('Failed to parse Excel: ' + error.message);
    }
};

module.exports = {
    parseExcel,
    normalizeHeader,
    selectImportWorksheet,
    recoverMisplacedTypeFields,
    splitList,
    resolveOptionIndex,
    parseMapping,
    mapRowFromHeaders,
};
