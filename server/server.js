const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '.env') });

const connectDB = require('./config/db');
const seedDatabase = require('./seed');
const { initReminderCron } = require('./services/reminderCron');

const app = express();

// Render/Vercel terminate TLS at a proxy; without this req.ip is the proxy's
// address and every rate limit would be shared across all users.
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/**
 * CORS: an explicit allow-list built from CLIENT_URL (comma-separated for
 * preview deployments). Requests with no Origin (curl, health pingers,
 * server-to-server) are allowed through.
 */
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      if (allowedOrigins.includes(normalized) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      console.warn(`[CORS] Blocked origin: ${origin} (allowed: ${allowedOrigins.join(', ')})`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

/**
 * Health endpoint for the uptime pinger that keeps the free-tier dyno awake so
 * the reminder cron keeps firing. Reports DB state so a half-up service does
 * not read as healthy.
 */
app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  const healthy = mongoose.connection.readyState === 1;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'UP' : 'DEGRADED',
    service: 'CareSync - Healthcare Appointment & Follow-up Manager',
    database: dbState,
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/doctors', require('./routes/doctorRoutes'));
app.use('/api/appointments', require('./routes/appointmentRoutes'));

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Origin not permitted' });
  }
  console.error('[Server Error]:', err.stack || err.message);
  return res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

const PORT = process.env.PORT || 5000;

/**
 * Ordered startup: connect, seed, then listen. Starting the listener first
 * would let requests arrive before the connection exists, where Mongoose
 * silently buffers them until they time out.
 */
const start = async () => {
  if (!process.env.JWT_SECRET) {
    console.error('[Startup] FATAL: JWT_SECRET is not set. Copy server/.env.example to server/.env.');
    if (process.env.NODE_ENV === 'production') process.exit(1);
  }

  const connected = await connectDB();
  if (connected) {
    await seedDatabase();
  } else {
    console.error('[Startup] Continuing without a database. API routes will return 503.');
  }

  initReminderCron();

  const server = app.listen(PORT, () => {
    console.log(`[Startup] CareSync API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log(`[Startup] Allowed origins: ${allowedOrigins.join(', ')}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] ${signal} received, closing gracefully...`);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
