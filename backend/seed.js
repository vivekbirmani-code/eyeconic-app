const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const seedUsers = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://REDACTED:REDACTED@neet.com' });
        if (!existingAdmin) {
            const admin = new User({
                name: 'Admin',
                email: 'admin@neet.com',
                password: 'admin123',
                role: 'admin',
                isActive: true
            });
            await admin.save();
            console.log('✅ Admin created: admin@neet.com / admin123');
        } else {
            console.log('ℹ️  Admin already exists: admin@neet.com');
        }

        // Seed Mentor
        const existingMentor = await User.findOne({ email: 'mentor@neet.com' });
        if (!existingMentor) {
            const mentor = new User({
                name: 'Dr. Sharma',
                email: 'mentor@neet.com',
                password: 'mentor123',
                role: 'mentor',
                isActive: true
            });
            await mentor.save();
            console.log('✅ Mentor created: mentor@neet.com / mentor123');
        } else {
            console.log('ℹ️  Mentor already exists: mentor@neet.com');
        }

        // Seed Student
        const existingStudent = await User.findOne({ email: 'student@neet.com' });
        if (!existingStudent) {
            const student = new User({
                name: 'Rahul Kumar',
                email: 'student@neet.com',
                password: 'student123',
                role: 'student',
                isActive: true
            });
            await student.save();
            console.log('✅ Student created: student@neet.com / student123');
        } else {
            console.log('ℹ️  Student already exists: student@neet.com');
        }

        // Seed another Student
        const existingStudent2 = await User.findOne({ email: 'priya@neet.com' });
        if (!existingStudent2) {
            const student2 = new User({
                name: 'Priya Singh',
                email: 'priya@neet.com',
                password: 'student123',
                role: 'student',
                isActive: true
            });
            await student2.save();
            console.log('✅ Student created: priya@neet.com / student123');
        } else {
            console.log('ℹ️  Student already exists: priya@neet.com');
        }

        await mongoose.disconnect();
        console.log('\n✅ Seeding complete! Database connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding:', error);
        process.exit(1);
    }
};

seedUsers();
