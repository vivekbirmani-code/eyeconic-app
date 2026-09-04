/**
 * Import institute students from a Google-Sheet-exported CSV into the
 * database as paid (isFreeUser: false) student accounts.
 *
 * CSV format (Google Sheets "Download as CSV"):
 *   email,name          (header row optional — auto-detected)
 *
 * Behaviour per row:
 *   - email not in DB  -> CREATE paid student with the shared password
 *   - existing student -> UPDATE: name from sheet, shared password, paid
 *   - existing admin/  -> SKIP (staff accounts are never modified)
 *     mentor
 *
 * Usage:
 *   node scripts/importStudents.js [--input <file>] [--password <pwd>]
 *                                  [--dry-run] [--no-report]
 *
 * Outputs (unless --no-report):
 *   backend/scripts/student_credentials_<ts>.csv — what to hand to students
 *   backend/scripts/import_report_<ts>.csv       — full per-row audit trail
 *
 * The script is idempotent — re-running it updates rather than duplicates.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Load backend/.env (MONGODB_URI) regardless of the current working directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');
const { isValidEmail, normalizeEmail } = require('../utils/otpHelpers');

const DEFAULT_INPUT = path.join(__dirname, 'students_input.csv');
const DEFAULT_PASSWORD = 'Eyeconic@2026';
const STAFF_ROLES = new Set(['admin', 'mentor']);

const parseArgs = () => {
  const args = { input: DEFAULT_INPUT, password: DEFAULT_PASSWORD, dryRun: false, report: true };
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '--input') args.input = raw[i + 1];
    else if (raw[i] === '--password') args.password = raw[i + 1];
    else if (raw[i] === '--dry-run') args.dryRun = true;
    else if (raw[i] === '--no-report') args.report = false;
    else {
      console.error(`Unknown argument: ${raw[i]}`);
      process.exit(1);
    }
  }
  return args;
};

// Minimal CSV line parser that handles quoted fields ("Last, First").
const parseCsvLine = (line) => {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
};

const readStudents = (inputPath) => {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(inputPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  const students = [];
  const inFileDuplicates = new Set();
  const seenEmails = new Set();
  let skippedRows = 0;

  lines.forEach((line, index) => {
    // The sheet exports "email,name" — detect and drop a header row if present.
    const [first, second] = parseCsvLine(line);
    if (index === 0 && !first.includes('@')) {
      return; // header row
    }

    const email = first || '';
    const name = second || '';

    if (!email || !name) {
      console.warn(`Row ${index + 1}: skipped — missing email or name (${line})`);
      skippedRows += 1;
      return;
    }

    if (!isValidEmail(email)) {
      console.warn(`Row ${index + 1}: skipped — invalid email "${email}"`);
      skippedRows += 1;
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    if (seenEmails.has(normalizedEmail)) {
      inFileDuplicates.add(normalizedEmail);
      return; // keep the first occurrence
    }
    seenEmails.add(normalizedEmail);

    students.push({ email: normalizedEmail, name });
  });

  return { students, inFileDuplicates: [...inFileDuplicates], skippedRows };
};

const writeReport = (fileName, rows) => {
  const header = Object.keys(rows[0] || { status: '', email: '', name: '' }).join(',');
  const body = rows
    .map((row) =>
      Object.values(row)
        .map((value) => {
          const text = String(value ?? '');
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(',')
    )
    .join('\n');
  const outPath = path.join(__dirname, fileName);
  fs.writeFileSync(outPath, `${header}\n${body}\n`);
  return outPath;
};

const run = async () => {
  const args = parseArgs();

  if (args.password.length < 6) {
    console.error('Password must be at least 6 characters (User model requirement).');
    process.exit(1);
  }

  const { students, inFileDuplicates, skippedRows } = readStudents(args.input);

  console.log(`Parsed ${students.length} students from ${args.input}` +
    (skippedRows ? ` (${skippedRows} invalid/empty rows skipped)` : '') +
    (inFileDuplicates.length ? ` (${inFileDuplicates.length} duplicate emails in file, first occurrence kept)` : ''));
  if (args.dryRun) {
    console.log('DRY RUN — no changes will be written to the database.');
  }

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set (checked backend/.env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to database');

  const results = [];
  let created = 0;
  let updated = 0;
  let skippedStaff = 0;

  for (const student of students) {
    const existing = await User.findOne({ email: student.email });

    if (!existing) {
      if (!args.dryRun) {
        await User.create({
          name: student.name,
          email: student.email,
          password: args.password,
          role: 'student',
          isFreeUser: false, // institute student — paid user
          isProfileComplete: false,
        });
      }
      created += 1;
      results.push({
        status: 'created',
        email: student.email,
        name: student.name,
        password: args.password,
        note: '',
      });
      continue;
    }

    if (STAFF_ROLES.has(existing.role)) {
      skippedStaff += 1;
      results.push({
        status: 'skipped_staff',
        email: student.email,
        name: student.name,
        password: '',
        note: `existing ${existing.role} account left untouched`,
      });
      continue;
    }

    // Existing student: align name/password/paid status with the rollout.
    const changes = [];
    if (existing.name !== student.name) {
      if (!args.dryRun) existing.name = student.name;
      changes.push('name');
    }
    if (existing.isFreeUser !== false) {
      if (!args.dryRun) existing.isFreeUser = false;
      changes.push('isFreeUser->false');
    }
    // Always (re)set the shared password so credentials can be distributed
    // uniformly; bcrypt re-hashes only when the plaintext differs.
    if (!args.dryRun) {
      existing.password = args.password;
      await existing.save();
    }
    changes.push('password (re)set');

    updated += 1;
    results.push({
      status: 'updated',
      email: student.email,
      name: student.name,
      password: args.password,
      note: changes.join('; '),
    });
  }

  console.log('\n===== IMPORT SUMMARY =====');
  console.log(`Created (paid students): ${created}`);
  console.log(`Updated (existing students): ${updated}`);
  console.log(`Skipped (staff accounts):  ${skippedStaff}`);
  console.log(`Total processed:          ${students.length}`);
  if (args.dryRun) {
    console.log('(dry run — nothing was written)');
  }

  if (args.report && results.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const credentialsRows = results.filter((r) => r.status === 'created' || r.status === 'updated');
    const credsPath = writeReport(`student_credentials_${timestamp}.csv`, credentialsRows);
    const reportPath = writeReport(`import_report_${timestamp}.csv`, results);
    console.log(`\nCredentials file (hand to students): ${credsPath}`);
    console.log(`Full audit report:                   ${reportPath}`);
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Import failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
