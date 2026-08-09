const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();
const { getMongoUri } = require('./utils/mongoUri');

const studentsData = [
  { name: 'ANKUSH KESARWANI', email: 'sadgurumann@gmail.com', password: 'student1' },
  { name: 'SAUMYA', email: 'saumya4774@gmail.com', password: 'student2' },
  { name: 'AKRITI RAO', email: 'raoakriti02@gmail.com', password: 'student3' },
  { name: 'SHILPA', email: '15shilpa1998@gmail.com', password: 'student4' },
  { name: 'CHAITANYA NANDKISHORE', email: 'chaitu.987bhand@gmail.com', password: 'student5' },
  { name: 'DEEP SHINDE', email: 'deepshinde3112@gmail.com', password: 'student6' },
  { name: 'RAJITA CHOUDHURY', email: 'rajitachoudhury@gmail.com', password: 'student7' },
  { name: 'RISHI RAPOL', email: 'sairishirapol2611@gmail.com', password: 'student8' },
  { name: 'AMANDEEP KAUR', email: 'amandeeplalton123@gmail.com', password: 'student9' },
  { name: 'AAKARSHIT', email: 'attriaakarshit@gmail.com', password: 'student10' },
  { name: 'SALONI', email: 'salonikaswa99@gmail.com', password: 'student11' },
  { name: 'ESHAA CHAUHAN', email: 'eshaa1406chauhan1406@gmail.com', password: 'student12' },
  { name: 'MANSI NAGVEKAR', email: 'mansinagvekar25@gmail.com', password: 'student13' },
  { name: 'MANTHRA', email: 'saimanthra30@gmail.com', password: 'student14' },
  { name: 'APARNA', email: 'tiwariaparna1999@gmail.com', password: 'student15' },
  { name: 'DIPANSHU GUPTA', email: 'dipanshuguptadipa567@gmail.com', password: 'student16' },
  { name: 'HIYA KALITA', email: 'kalitahiya21@gmail.com', password: 'student17' },
  { name: 'KAUSTUBH SINGH', email: 'singhkaustubh21@gmail.com', password: 'student18' },
  { name: 'AYUSH MISHRA', email: 'ajstulesakm@gmail.com', password: 'student19' },
  { name: 'SUMIT YADAV', email: 'sumity9950@gmail.com', password: 'student20' },
  { name: 'KEVIN S PATEL', email: 'kevinsanjaypatel@gmail.com', password: 'student21' },
  { name: 'MOHAMMAD ISMAIL KACHI', email: 'kachimohammedismail@gmail.com', password: 'student22' },
  { name: 'ASHISH RANJAN MEHER', email: 'ashishranjanmeher@gmail.com', password: 'student23' },
  { name: 'SAVAN', email: 'savan.tejani2001@gmail.com', password: 'student24' },
  { name: 'MOHAN AGARWAL', email: 'mohan.agarwal2204@gmail.com', password: 'student25' },
  { name: 'FARAZ', email: 'farazansary788@gmail.com', password: 'student26' },
  { name: 'ARCHIT JOHRI', email: 'architjohri27@gmail.com', password: 'student27' }
];

const seedStudents = async () => {
  try {
    await mongoose.connect(getMongoUri());
    console.log('Connected to MongoDB');

    for (const student of studentsData) {
      const existingUser = await User.findOne({ email: student.email });
      if (!existingUser) {
        const newUser = new User({
          name: student.name,
          email: student.email,
          password: student.password,
          role: 'student',
          isActive: true,
          isProfileComplete: false
        });
        await newUser.save();
        console.log(`✅ Student created: ${student.name} (${student.email})`);
      } else {
        console.log(`ℹ️  Student already exists: ${student.email}`);
      }
    }

    await mongoose.disconnect();
    console.log('Seeding complete! Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding students:', error);
    process.exit(1);
  }
};

seedStudents();
