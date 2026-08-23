const User = require('./models/User');
const DoctorProfile = require('./models/DoctorProfile');

/**
 * Idempotent bootstrap data.
 *
 * The admin account matters most: nothing in the API can create an ADMIN
 * (self-registration is hardcoded to PATIENT, and doctors are created *by* an
 * admin), so without this the admin console is unreachable on a fresh
 * database. Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * Sample doctors are demo data and only seed when SEED_SAMPLE_DOCTORS is not
 * explicitly false.
 */

const SAMPLE_DOCTORS = [
  {
    name: 'Gregory House',
    email: 'dr.house@caresync.com',
    specialization: 'General Medicine',
    slotDurationMins: 30,
    roomNumber: 'Room 101',
    bio: 'Diagnostic medicine and complex internal health conditions.',
  },
  {
    name: 'Meredith Grey',
    email: 'dr.grey@caresync.com',
    specialization: 'Dermatology',
    slotDurationMins: 30,
    roomNumber: 'Room 102',
    bio: 'Skin health, preventive dermatology, and cosmetic consultation.',
  },
  {
    name: 'Stephen Strange',
    email: 'dr.strange@caresync.com',
    specialization: 'Neurology',
    slotDurationMins: 45,
    roomNumber: 'Room 201',
    bio: 'Neurological and spinal health, headache and seizure management.',
  },
  {
    name: 'Cristina Yang',
    email: 'dr.yang@caresync.com',
    specialization: 'Cardiology',
    slotDurationMins: 30,
    roomNumber: 'Room 301',
    bio: 'Cardiovascular screening, heart health, and post-operative care.',
  },
  {
    name: 'Shaun Murphy',
    email: 'dr.murphy@caresync.com',
    specialization: 'Pediatrics',
    slotDurationMins: 30,
    roomNumber: 'Room 202',
    bio: 'Child development, routine checkups, and early disease prevention.',
  },
];

/**
 * Ensure exactly one admin account exists, matching the configured credentials.
 * Re-running is safe: an existing admin is left alone unless its password no
 * longer matches ADMIN_PASSWORD, in which case it is reset.
 */
const seedAdmin = async () => {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    const anyAdmin = await User.exists({ role: 'ADMIN' });
    if (!anyAdmin) {
      console.warn(
        '[Seed] No ADMIN account exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set. ' +
          'The admin console will be unreachable. Set both in server/.env and restart.'
      );
    }
    return null;
  }

  if (password.length < 8) {
    console.warn('[Seed] ADMIN_PASSWORD is shorter than 8 characters. Use a stronger one before deploying.');
  }

  const existing = await User.findOne({ email }).select('+password');

  if (!existing) {
    const admin = await User.create({
      name: process.env.ADMIN_NAME || 'Clinic Administrator',
      email,
      password,
      role: 'ADMIN',
      mustResetPassword: false,
    });
    console.log(`[Seed] Admin account created: ${admin.email}`);
    return admin;
  }

  let changed = false;
  if (existing.role !== 'ADMIN') {
    existing.role = 'ADMIN';
    changed = true;
  }
  if (!(await existing.matchPassword(password))) {
    existing.password = password; // re-hashed by the pre-save hook
    existing.mustResetPassword = false;
    changed = true;
    console.log(`[Seed] Admin password re-synced from ADMIN_PASSWORD for ${existing.email}`);
  }
  if (changed) await existing.save();
  else console.log(`[Seed] Admin account present: ${existing.email}`);

  return existing;
};

/**
 * Seed demo doctors. Each doctor is created independently so a partially
 * seeded database converges on a full roster instead of stopping at the first
 * one that already exists.
 */
const seedDoctors = async () => {
  if (process.env.SEED_SAMPLE_DOCTORS === 'false') {
    console.log('[Seed] Sample doctor seeding disabled (SEED_SAMPLE_DOCTORS=false).');
    return 0;
  }

  const password = process.env.SEED_DOCTOR_PASSWORD || 'DoctorPassword123!';
  let created = 0;

  for (const doc of SAMPLE_DOCTORS) {
    try {
      let user = await User.findOne({ email: doc.email });
      if (!user) {
        user = await User.create({
          name: doc.name,
          email: doc.email,
          password,
          role: 'DOCTOR',
          phone: '+91 98765 43210',
          mustResetPassword: false,
        });
      }

      const hasProfile = await DoctorProfile.exists({ user: user._id });
      if (!hasProfile) {
        await DoctorProfile.create({
          user: user._id,
          specialization: doc.specialization,
          slotDurationMins: doc.slotDurationMins,
          roomNumber: doc.roomNumber,
          bio: doc.bio,
        });
        created++;
      }
    } catch (err) {
      console.error(`[Seed] Failed to seed ${doc.email}: ${err.message}`);
    }
  }

  const total = await DoctorProfile.countDocuments();
  console.log(`[Seed] Doctor roster ready: ${total} profile(s) (${created} created this run).`);
  return created;
};

const seedDatabase = async () => {
  try {
    await seedAdmin();
    await seedDoctors();
  } catch (err) {
    console.error(`[Seed Error]: ${err.message}`);
  }
};

module.exports = seedDatabase;
module.exports.seedAdmin = seedAdmin;
module.exports.seedDoctors = seedDoctors;
module.exports.SAMPLE_DOCTORS = SAMPLE_DOCTORS;
