/**
 * Import a question-bank Excel through the REAL production import route
 * (POST /api/question-bank/bulk-import-base64), so the file goes through the
 * exact same parse -> validate -> image-transfer (Cloudinary) -> insert
 * pipeline the admin UI uses. Requires the backend to be running locally
 * (backend/.env applies, including MONGODB_URI).
 *
 * Usage:
 *   node scripts/importQuestionBank.js [--file <path>] [--base-url <url>]
 *
 * The route is idempotent per qid: a re-run reports duplicate-key errors for
 * rows already imported and inserts only the new ones.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const file = path.resolve(argValue('--file', path.join(__dirname, '..', '..', 'Q_BankTechTeamFinal (1).xlsx')));
const baseUrl = argValue('--base-url', `http://localhost:${process.env.PORT || 3000}`);

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
    if (!admin) throw new Error('No admin user found in the database.');
    await mongoose.disconnect();

    const token = jwt.sign({ userId: admin._id.toString() }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const data = fs.readFileSync(file).toString('base64');

    console.log(`POST ${baseUrl}/api/question-bank/bulk-import-base64`);
    console.log(`file: ${file} (${(data.length / 1024 / 1024).toFixed(2)} MB base64), admin: ${admin.email}`);

    const res = await fetch(`${baseUrl}/api/question-bank/bulk-import-base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: path.basename(file), data }),
    });
    const body = await res.json();

    console.log(`status ${res.status}`);
    console.log(`message: ${body.message}`);
    console.log(`count: ${body.count} / totalRows: ${body.totalRows}`);
    if (Array.isArray(body.errors)) {
        console.log(`errors (${body.errors.length} shown):`);
        body.errors.forEach((e) => console.log('  ERR ', e));
    }
    if (Array.isArray(body.warnings)) {
        console.log(`warnings (${body.warnings.length} shown):`);
        body.warnings.forEach((w) => console.log('  WARN', w));
    }

    process.exit(res.status === 200 && (body.count || 0) > 0 ? 0 : 1);
})().catch((err) => {
    console.error('Import failed:', err.message);
    process.exit(1);
});
