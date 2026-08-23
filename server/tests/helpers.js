const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

/**
 * Shared test harness.
 *
 * Tests run against an in-memory MongoDB so the concurrency and TTL behaviour
 * being verified is real database behaviour, not a mock. Indexes are built
 * explicitly - the partial unique index is the thing under test in the
 * double-booking suite, so it must exist before the first write.
 */

let memoryServer;

const startDb = async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());

  const Appointment = require('../models/Appointment');
  const DoctorLeave = require('../models/DoctorLeave');
  const User = require('../models/User');
  const DoctorProfile = require('../models/DoctorProfile');

  await Promise.all([
    Appointment.syncIndexes(),
    DoctorLeave.syncIndexes(),
    User.syncIndexes(),
    DoctorProfile.syncIndexes(),
  ]);
};

const stopDb = async () => {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
};

const clearDb = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
};

/** A patient, a doctor, and the doctor's profile - the minimum for a booking. */
const seedFixtures = async (overrides = {}) => {
  const User = require('../models/User');
  const DoctorProfile = require('../models/DoctorProfile');

  const patient = await User.create({
    name: 'Test Patient',
    email: `patient${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.com`,
    password: 'password123',
    role: 'PATIENT',
  });

  const doctor = await User.create({
    name: 'Test Doctor',
    email: `doctor${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.com`,
    password: 'password123',
    role: 'DOCTOR',
  });

  const profile = await DoctorProfile.create({
    user: doctor._id,
    specialization: 'General Medicine',
    slotDurationMins: 30,
    roomNumber: 'Room 101',
    ...overrides.profile,
  });

  return { patient, doctor, profile };
};

/** A date N days from now, as YYYY-MM-DD, that is guaranteed to be a weekday. */
const futureWeekday = (daysAhead = 1) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1); // skip Sunday (not a working day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = { startDb, stopDb, clearDb, seedFixtures, futureWeekday };
