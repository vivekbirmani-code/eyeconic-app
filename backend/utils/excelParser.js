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
            OPTION1: 'option1',
            OPTION2: 'option2',
            OPTION3: 'option3',
            OPTION4: 'option4',
            OIMAGE1: 'option1Image',
            OIMAGE2: 'option2Image',
            OIMAGE3: 'option3Image',
            OIMAGE4: 'option4Image',
            CORRECT: 'correctAnswer',
            SOLUTION: 'explanation',
            SOLUTIONIMAGE: 'explanationImage',
            MARKS: 'marks',
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
                else if (normalized.includes('QIMAGE')) rowData.questionImage = row[key];
                else if (normalized.includes('OPTION1')) rowData.option1 = row[key];
                else if (normalized.includes('OPTION2')) rowData.option2 = row[key];
                else if (normalized.includes('OPTION3')) rowData.option3 = row[key];
                else if (normalized.includes('OPTION4')) rowData.option4 = row[key];
                else if (normalized.includes('CORRECT')) rowData.correctAnswer = row[key];
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

            questions.push({
                subjectName: rowData.subject.trim(),
                topicName: rowData.topicName ? rowData.topicName.trim() : '',
                question: rowData.question.trim(),
                questionImage: rowData.questionImage || null,
                options,
                optionImages,
                correctAnswer: correctIndex,
                explanation: rowData.explanation || '',
                explanationImage: rowData.explanationImage || null,
                marks: parseInt(rowData.marks) || 1,
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
