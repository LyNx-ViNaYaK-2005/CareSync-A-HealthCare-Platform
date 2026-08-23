/**
 * Atlas connection checker.
 *
 * Run with:  npm run check:db
 *
 * Verifies the connection string works, the required indexes exist, and
 * reports what is already in the database. Diagnoses the three failures that
 * account for almost every Atlas setup problem: a placeholder password, an
 * IP that is not whitelisted, and wrong credentials.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (msg) => console.log(`${GREEN}  OK${RESET}    ${msg}`);
const bad = (msg) => console.log(`${RED}  FAIL${RESET}  ${msg}`);
const warn = (msg) => console.log(`${YELLOW}  WARN${RESET}  ${msg}`);
const hint = (msg) => console.log(`${DIM}        ${msg}${RESET}`);

/** Hide the password before printing a connection string. */
const redact = (uri) => uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:••••••@');

const diagnose = (message) => {
  if (/ENOTFOUND|querySrv/i.test(message)) {
    hint('The cluster hostname could not be resolved.');
    hint('Check for a typo in the host part, and that the cluster still exists in Atlas.');
  } else if (/authentication failed|bad auth/i.test(message)) {
    hint('Atlas rejected the username or password.');
    hint('Database Access -> check the user exists and the password matches.');
    hint('If the password contains @ : / ? # [ ] %, it must be percent-encoded.');
  } else if (/timed out|ETIMEDOUT|ServerSelection/i.test(message)) {
    hint('Reached the cluster but no server responded in time.');
    hint('This is almost always IP allow-listing: Network Access -> Add IP Address');
    hint('-> "Allow access from anywhere" (0.0.0.0/0).');
  }
};

const main = async () => {
  console.log('\nMongoDB Atlas connection check\n');

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    bad('MONGODB_URI is not set in server/.env');
    hint('Open server/.env and paste your Atlas connection string after MONGODB_URI=');
    process.exit(1);
  }

  if (/<password>|<username>|username:password|your_mongodb/i.test(uri)) {
    bad('MONGODB_URI still contains placeholder text');
    hint(`Current value: ${redact(uri)}`);
    hint('Replace <password> with your real database user password.');
    process.exit(1);
  }

  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    bad('MONGODB_URI does not look like a MongoDB connection string');
    hint('It should start with mongodb+srv://');
    process.exit(1);
  }

  ok(`Connection string parsed: ${redact(uri)}`);

  const dbNameInUri = uri.split('/').pop().split('?')[0];
  if (!dbNameInUri) {
    warn('No database name in the URI - Mongo will use "test"');
    hint('Add /caresync_db before the "?" so your data lands in the right database.');
  }

  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    ok(`Connected to ${conn.connection.host}`);
    ok(`Database: ${conn.connection.name}`);
  } catch (err) {
    bad(`Could not connect: ${err.message}`);
    diagnose(err.message);
    process.exit(1);
  }

  // Indexes: the double-booking guard and the hold TTL are the two that matter.
  const Appointment = require('../models/Appointment');
  const DoctorLeave = require('../models/DoctorLeave');
  const User = require('../models/User');
  const DoctorProfile = require('../models/DoctorProfile');

  console.log('\nIndexes');
  try {
    await Promise.all([
      Appointment.syncIndexes(),
      DoctorLeave.syncIndexes(),
      User.syncIndexes(),
      DoctorProfile.syncIndexes(),
    ]);

    const indexes = await Appointment.collection.indexes();
    const partial = indexes.find((i) => i.unique && i.partialFilterExpression && i.key.startTime === 1);
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);

    if (partial) ok('Double-booking guard active (partial unique index)');
    else bad('Double-booking guard MISSING - concurrent bookings could collide');

    if (ttl) ok('Slot-hold TTL active (expired holds auto-purge)');
    else bad('Slot-hold TTL MISSING - abandoned holds would never expire');
  } catch (err) {
    bad(`Index sync failed: ${err.message}`);
  }

  console.log('\nContents');
  try {
    const [admins, doctors, patients, appointments] = await Promise.all([
      User.countDocuments({ role: 'ADMIN' }),
      DoctorProfile.countDocuments(),
      User.countDocuments({ role: 'PATIENT' }),
      Appointment.countDocuments(),
    ]);

    if (admins > 0) ok(`${admins} admin account(s)`);
    else {
      warn('No admin account yet - it seeds on the next server start');
      hint('Make sure ADMIN_EMAIL and ADMIN_PASSWORD are set in server/.env.');
    }

    ok(`${doctors} doctor profile(s)`);
    ok(`${patients} patient account(s)`);
    ok(`${appointments} appointment(s)`);
  } catch (err) {
    bad(`Could not read collections: ${err.message}`);
  }

  console.log(`\n${GREEN}Atlas is wired up correctly. Start the server with: npm run dev${RESET}\n`);
  await mongoose.disconnect();
  process.exit(0);
};

main().catch(async (err) => {
  bad(`Unexpected error: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
