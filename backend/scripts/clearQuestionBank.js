/**
 * clearQuestionBank.js
 * ---------------------
 * One-off script to delete ALL documents from the QuestionBank collection.
 * Quizzes, attempts, subjects, topics, and all other collections are left intact.
 *
 * Usage:
 *   node scripts/clearQuestionBank.js
 */

const mongoose = require('mongoose');
const QuestionBank = require('../models/QuestionBank');
require('dotenv').config();
const { getMongoUri } = require('../utils/mongoUri');

const clearQuestionBank = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(getMongoUri());
        console.log('✅ Connected to MongoDB');

        const countBefore = await QuestionBank.countDocuments({});
        console.log(`📊 Questions found in bank: ${countBefore}`);

        if (countBefore === 0) {
            console.log('ℹ️  Question bank is already empty. Nothing to delete.');
        } else {
            const result = await QuestionBank.deleteMany({});
            console.log(`🗑️  Deleted ${result.deletedCount} question(s) from the question bank.`);
        }

        console.log('\n✅ Done.');
        await mongoose.disconnect();
        console.log('Database connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing question bank:', error);
        process.exit(1);
    }
};

clearQuestionBank();
