const mongoose = require('mongoose');

let mongoMemoryServer = null;

/**
 * Cloud-first MongoDB connection.
 *
 * Resolution order:
 *   1. MONGODB_URI  (MongoDB Atlas / any cloud cluster)  <-- the production path
 *   2. Local mongod, only when ALLOW_LOCAL_DB_FALLBACK=true
 *   3. In-memory server, only when ALLOW_INMEMORY_DB=true
 *
 * The fallbacks are opt-in on purpose: silently booting onto a throwaway
 * in-memory database in production looks like a working deploy while every
 * appointment written to it disappears on the next restart.
 */

const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isPlaceholderUri = (uri) =>
  !uri ||
  uri.includes('<username>') ||
  uri.includes('<password>') ||
  uri.includes('username:password') ||
  uri.includes('your_mongodb');

const connectAtlas = async (uri) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        retryWrites: true,
      });
      console.log(`[DB] MongoDB Atlas connected: ${conn.connection.host}/${conn.connection.name}`);
      return true;
    } catch (err) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 15000);
      console.error(`[DB] Atlas connection attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[DB] Retrying in ${backoff}ms...`);
        await sleep(backoff);
      }
    }
  }
  return false;
};

/**
 * Build the indexes the booking logic depends on.
 *
 * syncIndexes() matters on a pre-existing Atlas collection: Mongoose only
 * auto-creates indexes it thinks are missing at model-compile time, so a
 * collection created before the partial-unique index was added would keep
 * accepting double bookings forever. This makes index state explicit.
 */
const ensureIndexes = async () => {
  try {
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

    const apptIndexes = await Appointment.collection.indexes();
    const hasPartialUnique = apptIndexes.some(
      (i) => i.unique && i.partialFilterExpression && i.key.doctor === 1 && i.key.startTime === 1
    );
    const hasTtl = apptIndexes.some((i) => i.expireAfterSeconds !== undefined);

    console.log(
      `[DB] Indexes synced. Double-booking guard: ${hasPartialUnique ? 'ACTIVE' : 'MISSING'} | ` +
        `Slot-hold TTL: ${hasTtl ? 'ACTIVE' : 'MISSING'}`
    );

    if (!hasPartialUnique) {
      console.error('[DB] WARNING: partial unique index missing - double bookings are possible.');
    }
  } catch (err) {
    console.error(`[DB] Index sync failed: ${err.message}`);
  }
};

const attachConnectionHandlers = () => {
  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] MongoDB disconnected. The driver will attempt to reconnect automatically.');
  });
  mongoose.connection.on('reconnected', () => {
    console.log('[DB] MongoDB reconnected.');
  });
  mongoose.connection.on('error', (err) => {
    console.error(`[DB] MongoDB connection error: ${err.message}`);
  });
};

const connectDB = async () => {
  attachConnectionHandlers();

  const uri = process.env.MONGODB_URI;

  if (!isPlaceholderUri(uri)) {
    const connected = await connectAtlas(uri);
    if (connected) {
      await ensureIndexes();
      return true;
    }

    if (process.env.NODE_ENV === 'production') {
      console.error('[DB] FATAL: could not reach MongoDB Atlas in production. Exiting.');
      process.exit(1);
    }
    console.error('[DB] Could not reach MongoDB Atlas. Checking for opt-in local fallbacks...');
  } else if (uri) {
    console.error('[DB] MONGODB_URI still contains placeholder values. Replace it with your real Atlas connection string.');
  } else {
    console.error('[DB] MONGODB_URI is not set. Copy server/.env.example to server/.env and fill it in.');
  }

  if (process.env.ALLOW_LOCAL_DB_FALLBACK === 'true') {
    try {
      const localUri = process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/caresync_db';
      const conn = await mongoose.connect(localUri, { serverSelectionTimeoutMS: 3000 });
      console.log(`[DB] MongoDB connected (local fallback): ${conn.connection.host}`);
      await ensureIndexes();
      return true;
    } catch (localErr) {
      console.warn(`[DB] Local MongoDB unavailable: ${localErr.message}`);
    }
  }

  if (process.env.ALLOW_INMEMORY_DB === 'true') {
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongoMemoryServer = await MongoMemoryServer.create();
      const conn = await mongoose.connect(mongoMemoryServer.getUri());
      console.warn(
        `[DB] Connected to EPHEMERAL in-memory MongoDB (${conn.connection.host}). ` +
          'All data is lost on restart - never use this for a graded demo or deployment.'
      );
      await ensureIndexes();
      return true;
    } catch (memErr) {
      console.error(`[DB] In-memory fallback failed: ${memErr.message}`);
    }
  }

  console.error(
    '[DB] No database connection established. Set MONGODB_URI to your Atlas cluster, ' +
      'or set ALLOW_LOCAL_DB_FALLBACK=true / ALLOW_INMEMORY_DB=true for local development.'
  );
  return false;
};

const disconnectDB = async () => {
  await mongoose.disconnect();
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
    mongoMemoryServer = null;
  }
};

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
module.exports.ensureIndexes = ensureIndexes;
