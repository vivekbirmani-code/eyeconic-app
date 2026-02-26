const xlsx = require('xlsx');

// Standardize header names
const normalizeHeader = (header) => {
    if (!header) return '';
    return header.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const parseExcel = async (buffer) => {
    try {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const rawData = xlsx.utils.sheet_to_json(sheet);

        if (!rawData || rawData.length === 0) {
            throw new Error('Excel sheet is empty');
        }

        const questions = [];
        const errors = [];

        // Map for headers to keys
        const HEADERS = {
            SUBJECT: 'subject',
            TOPIC: 'topicName',
            TAG: 'tags',
            QUESTION: 'question',
            QIMAGE: 'questionImage',
            Q_IMAGE: 'questionImage', // alias
            OPTION1: 'option1',
            OPTION2: 'option2',
            OPTION3: 'option3',
            OPTION4: 'option4',
            OIMAGE1: 'option1Image',
            OIMAGE2: 'option2Image',
            OIMAGE3: 'option3Image',
            OIMAGE4: 'option4Image',
            O_IMAGE_1: 'option1Image', // alias
            O_IMAGE_2: 'option2Image',
            O_IMAGE_3: 'option3Image',
            O_IMAGE_4: 'option4Image',
            CORRECT: 'correctAnswer',
            SOLUTION: 'explanation',
            SOLUTIONIMAGE: 'explanationImage',
            SOLUTION_IMAGE: 'explanationImage', // alias
            MARKS: 'marks',
            // Positive / Negative marks (Issue 2 fix)
            POSITIVEMARKS: 'positiveMarks',
            POSITIVEMARK: 'positiveMarks',
            POSITIVE_MARKS: 'positiveMarks',
            POSITIVEMARKS_: 'positiveMarks',
            NEGATIVEMARKS: 'negativeMarks',
            NEGATIVEMARK: 'negativeMarks',
            NEGATIVE_MARKS: 'negativeMarks',
            NEGATIVEMARKS_: 'negativeMarks',
            // Aliases or leftovers supported for robustness
            EXPLANATION: 'explanation',
            EXIMAGE: 'explanationImage',
            TAGS: 'tags'
        };

        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            const rowData = {};

            // Normalize keys
            Object.keys(row).forEach(key => {
                const normalized = normalizeHeader(key);
                if (HEADERS[normalized]) {
                    rowData[HEADERS[normalized]] = row[key];
                }
                // Fallbacks if exact match fails
                else if (normalized.includes('SUBJECT')) rowData.subject = row[key];
                else if (normalized.includes('QUESTION') && !normalized.includes('IMAGE')) rowData.question = row[key];
                else if (normalized.includes('QIMAGE') || (normalized.includes('Q') && normalized.includes('IMAGE'))) rowData.questionImage = row[key];
                else if (normalized.includes('OPTION1') && !normalized.includes('IMAGE')) rowData.option1 = row[key];
                else if (normalized.includes('OPTION2') && !normalized.includes('IMAGE')) rowData.option2 = row[key];
                else if (normalized.includes('OPTION3') && !normalized.includes('IMAGE')) rowData.option3 = row[key];
                else if (normalized.includes('OPTION4') && !normalized.includes('IMAGE')) rowData.option4 = row[key];
                else if ((normalized.includes('OIMAGE1') || (normalized.includes('OPTION1') && normalized.includes('IMAGE')) || (normalized.includes('O') && normalized.includes('IMAGE') && normalized.includes('1')))) rowData.option1Image = row[key];
                else if ((normalized.includes('OIMAGE2') || (normalized.includes('OPTION2') && normalized.includes('IMAGE')) || (normalized.includes('O') && normalized.includes('IMAGE') && normalized.includes('2')))) rowData.option2Image = row[key];
                else if ((normalized.includes('OIMAGE3') || (normalized.includes('OPTION3') && normalized.includes('IMAGE')) || (normalized.includes('O') && normalized.includes('IMAGE') && normalized.includes('3')))) rowData.option3Image = row[key];
                else if ((normalized.includes('OIMAGE4') || (normalized.includes('OPTION4') && normalized.includes('IMAGE')) || (normalized.includes('O') && normalized.includes('IMAGE') && normalized.includes('4')))) rowData.option4Image = row[key];
                else if (normalized.includes('CORRECT')) rowData.correctAnswer = row[key];
                else if ((normalized.includes('SOLUTION') && normalized.includes('IMAGE')) || normalized.includes('EXIMAGE')) rowData.explanationImage = row[key];
                // Issue 2 fix: detect POSITIVE MARKS / NEGATIVE MARKS columns
                else if (normalized.includes('POSITIVE') && normalized.includes('MARK')) rowData.positiveMarks = row[key];
                else if (normalized.includes('NEGATIVE') && normalized.includes('MARK')) rowData.negativeMarks = row[key];
            });

            // Validation
            if (!rowData.subject || !rowData.question || !rowData.option1 || !rowData.option2 || !rowData.correctAnswer) {
                // If marks or other fields are widely present but core fields missing, maybe it's just an empty row
                if (!rowData.question && !rowData.subject) continue;
                errors.push(`Row ${i + 2}: Missing required fields (Subject, Question, Option 1/2, Correct Answer)`);
                continue;
            }

            // Process Options
            const options = [rowData.option1, rowData.option2];
            if (rowData.option3) options.push(rowData.option3);
            if (rowData.option4) options.push(rowData.option4);

            // Process Correct Answer
            let correctIndex = -1;
            const correctRaw = rowData.correctAnswer.toString().toUpperCase().trim();
            const answerVal = correctRaw; // for numeric check

            if (['1', 'A'].includes(correctRaw)) correctIndex = 0;
            else if (['2', 'B'].includes(correctRaw)) correctIndex = 1;
            else if (['3', 'C'].includes(correctRaw)) correctIndex = 2;
            else if (['4', 'D'].includes(correctRaw)) correctIndex = 3;
            else {
                // Try numeric parsing
                const numVal = parseInt(answerVal);
                if (numVal >= 1 && numVal <= 4) correctIndex = numVal - 1;
                // Fallback: Check if answer text matches one of the options
                else {
                    const matchIndex = options.findIndex(opt => opt && opt.toString().trim().toUpperCase() === correctRaw);
                    if (matchIndex !== -1) correctIndex = matchIndex;
                }
            }

            if (correctIndex === -1 || correctIndex >= options.length) {
                errors.push(`Row ${i + 2}: Invalid correct answer '${correctRaw}' for ${options.length} options`);
                continue;
            }

            // Process Tags (comma separated)
            let tags = [];
            if (rowData.tags) {
                tags = rowData.tags.toString().split(',').map(t => t.trim()).filter(t => t);
            }

            // Process Images
            // User asked: "keep the sol1_image....etc if they were not in excel file it will be considered empty"
            const optionImages = [
                rowData.option1Image,
                rowData.option2Image,
                rowData.option3Image,
                rowData.option4Image
            ].slice(0, options.length).map(img => img || '');

            // Parse positive/negative marks with safe defaults (Issue 2 fix)
            const positiveMarks = rowData.positiveMarks !== undefined
                ? (parseFloat(rowData.positiveMarks) || 4)
                : 4;
            const negativeMarks = rowData.negativeMarks !== undefined
                ? Math.abs(parseFloat(rowData.negativeMarks) || 0)
                : 0;

            questions.push({
                subjectName: String(rowData.subject).trim(),
                topicName: rowData.topicName ? String(rowData.topicName).trim() : '',
                question: String(rowData.question).trim(),
                questionImage: rowData.questionImage || null,
                options,
                optionImages,
                correctAnswer: correctIndex,
                explanation: rowData.explanation ? String(rowData.explanation).trim() : '',
                explanationImage: rowData.explanationImage || null,
                marks: positiveMarks, // sync marks with positiveMarks for backward compat
                positiveMarks,
                negativeMarks,
                tags,
                source: 'excel_import'
            });
        }

        return { questions, errors };
    } catch (error) {
        throw new Error('Failed to parse Excel: ' + error.message);
    }
};

module.exports = { parseExcel };
