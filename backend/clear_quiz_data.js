const mongoose = require('mongoose');
const Quiz = require('./models/Quiz');
const QuestionBank = require('./models/QuestionBank');
const QuizAttempt = require('./models/QuizAttempt');
const Subject = require('./models/Subject');
const Topic = require('./models/Topic');
require('dotenv').config();

const clearQuizData = async () => {
    try {
        console.log('Connecting to MongoDB...');
        // Use the same connection string logic as seed.js
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://REDACTED:REDACTED@cluster0.g7l8wx5.mongodb.net/?appName=Cluster0');
        console.log('✅ Connected to MongoDB');

        // Confirm before deleting (optional in script, but good for logs)
        console.log('Starting data cleanup...');

        // 1. Delete Quiz Attempts
        const attemptsResult = await QuizAttempt.deleteMany({});
        console.log(`🗑️  Deleted ${attemptsResult.deletedCount} quiz attempts`);

        // 2. Delete Quizzes
        const quizzesResult = await Quiz.deleteMany({});
        console.log(`🗑️  Deleted ${quizzesResult.deletedCount} quizzes`);

        // 3. Delete Questions
        const questionsResult = await QuestionBank.deleteMany({});
        console.log(`🗑️  Deleted ${questionsResult.deletedCount} questions`);

        // 4. Delete Topics
        const topicsResult = await Topic.deleteMany({});
        console.log(`🗑️  Deleted ${topicsResult.deletedCount} topics`);

        // 5. Delete Subjects
        const subjectsResult = await Subject.deleteMany({});
        console.log(`🗑️  Deleted ${subjectsResult.deletedCount} subjects`);

        console.log('\n✅ Data cleanup complete!');

        await mongoose.disconnect();
        console.log('Database connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing data:', error);
        process.exit(1);
    }
};

clearQuizData();
