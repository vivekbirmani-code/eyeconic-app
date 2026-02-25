require('dotenv').config();
const mongoose = require('mongoose');

const fixSubjects = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const Subject = mongoose.model('Subject', new mongoose.Schema({ name: String }, { strict: false }));
        const QuestionBank = mongoose.model('QuestionBank', new mongoose.Schema({ subject: mongoose.Schema.Types.ObjectId, question: String }, { strict: false }));

        const allSubjects = await Subject.find({});
        console.log(`Found ${allSubjects.length} subjects in total`);

        const standardMap = {
            'COMMUNITY MEDICINE': 'PSM',
            'FORENSIC MEDICINE': 'FMT',
            'OBSTETRICS AND GYNAECOLOGY': 'OBGYN',
            'OBSTETRICS & GYNAECOLOGY': 'OBGYN'
        };

        const standardIds = {};
        allSubjects.forEach(s => {
            if (['PSM', 'FMT', 'OBGYN', 'ANATOMY', 'PHYSIOLOGY', 'BIOCHEMISTRY', 'PATHOLOGY', 'PHARMACOLOGY', 'MICROBIOLOGY', 'ENT', 'OPHTHALMOLOGY', 'MEDICINE', 'SURGERY', 'ORTHOPAEDICS', 'ANAESTHESIA', 'PAEDIATRICS', 'PSYCHIATRY', 'RADIOLOGY', 'DERMATOLOGY'].includes(s.name)) {
                standardIds[s.name] = s._id;
            }
        });

        let questionsUpdated = 0;
        let subjectsDeleted = 0;

        for (const duplicate of allSubjects) {
            if (standardMap[duplicate.name]) {
                const targetName = standardMap[duplicate.name];
                const targetId = standardIds[targetName];

                if (targetId) {
                    const result = await QuestionBank.updateMany({ subject: duplicate._id }, { $set: { subject: targetId } });
                    questionsUpdated += result.modifiedCount;
                    console.log(`Updated ${result.modifiedCount} questions from ${duplicate.name} to ${targetName}`);

                    await Subject.deleteOne({ _id: duplicate._id });
                    subjectsDeleted++;
                    console.log(`Deleted duplicate subject ${duplicate.name}`);
                }
            } else if (!['PSM', 'FMT', 'OBGYN', 'ANATOMY', 'PHYSIOLOGY', 'BIOCHEMISTRY', 'PATHOLOGY', 'PHARMACOLOGY', 'MICROBIOLOGY', 'ENT', 'OPHTHALMOLOGY', 'MEDICINE', 'SURGERY', 'ORTHOPAEDICS', 'ANAESTHESIA', 'PAEDIATRICS', 'PSYCHIATRY', 'RADIOLOGY', 'DERMATOLOGY'].includes(duplicate.name)) {
                console.log(`Warning: Found unrecognized subject ${duplicate.name}`);
            }
        }

        console.log(`Migration complete. Updated ${questionsUpdated} questions, deleted ${subjectsDeleted} duplicate subjects.`);

        const finalSubjects = await Subject.find({});
        console.log(`Remaining subjects active: ${finalSubjects.length}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

fixSubjects();
