const mongoose = require('mongoose');
const Subject = require('./models/Subject');
require('dotenv').config();
const { getMongoUri } = require('./utils/mongoUri');

// Subject data based on the medical curriculum image
const subjects = [
    // 1st Year
    { name: 'ANATOMY', year: '1st', displayOrder: 1 },
    { name: 'PHYSIOLOGY', year: '1st', displayOrder: 2 },
    { name: 'BIOCHEMISTRY', year: '1st', displayOrder: 3 },

    // 2nd Year
    { name: 'PATHOLOGY', year: '2nd', displayOrder: 1 },
    { name: 'PHARMACOLOGY', year: '2nd', displayOrder: 2 },
    { name: 'MICROBIOLOGY', year: '2nd', displayOrder: 3 },

    // 3rd Year
    { name: 'PSM', year: '3rd', displayOrder: 1 },
    { name: 'OPHTHALMOLOGY', year: '3rd', displayOrder: 2 },
    { name: 'ENT', year: '3rd', displayOrder: 3 },
    { name: 'FMT', year: '3rd', displayOrder: 4 },

    // 4th Year
    { name: 'MEDICINE', year: '4th', displayOrder: 1 },
    { name: 'SURGERY', year: '4th', displayOrder: 2 },
    { name: 'ORTHOPAEDICS', year: '4th', displayOrder: 3 },
    { name: 'ANAESTHESIA', year: '4th', displayOrder: 4 },
    { name: 'PAEDIATRICS', year: '4th', displayOrder: 5 },
    { name: 'PSYCHIATRY', year: '4th', displayOrder: 6 },
    { name: 'RADIOLOGY', year: '4th', displayOrder: 7 },
    { name: 'OBGYN', year: '4th', displayOrder: 8 },
    { name: 'DERMATOLOGY', year: '4th', displayOrder: 9 }
];

async function seedSubjects() {
    try {
        // Connect to MongoDB
        await mongoose.connect(getMongoUri());
        console.log('Connected to MongoDB');

        // Clear existing subjects
        await Subject.deleteMany({});
        console.log('Cleared existing subjects');

        // Insert new subjects
        const result = await Subject.insertMany(subjects);
        console.log(`Successfully seeded ${result.length} subjects`);

        // Display the subjects grouped by year
        console.log('\n=== Subjects by Year ===');
        const years = ['1st', '2nd', '3rd', '4th'];
        for (const year of years) {
            const yearSubjects = await Subject.find({ year }).sort({ displayOrder: 1 });
            console.log(`\n${year} Year (${yearSubjects.length} subjects):`);
            yearSubjects.forEach(sub => console.log(`  - ${sub.name}`));
        }

        process.exit(0);
    } catch (error) {
        console.error('Error seeding subjects:', error);
        process.exit(1);
    }
}

seedSubjects();
