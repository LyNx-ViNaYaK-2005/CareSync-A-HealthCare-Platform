const rateLimit = require('express-rate-limit');

/**
 * Rate limits.
 *
 * `trust proxy` is set in server.js so req.ip is the real client behind
 * Render's load balancer - without it every request would share the proxy's
 * IP and one user could exhaust the limit for everybody.
 *
 * Each cap is env-tunable so a load test or a busy clinic can raise it
 * without a code change.
 */

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_AUTH, 30),
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** LLM calls cost money and take seconds; keep them tight. */
const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_LLM, 10),
  message: {
    success: false,
    message: 'Too many AI generation requests. Please wait a minute and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Slot holds are cheap but scriptable; this stops one client parking every slot. */
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_BOOKING, 20),
  message: {
    success: false,
    message: 'Too many booking attempts. Please slow down and try again shortly.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, llmLimiter, bookingLimiter };
