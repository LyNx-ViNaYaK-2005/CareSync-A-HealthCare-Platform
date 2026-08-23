const mongoose = require('mongoose');

/**
 * Outbox record for every outbound email.
 *
 * Rows start PENDING, flip to SENT on success or FAILED on error. The retry
 * worker in reminderCron.js picks up FAILED rows with attempts below the cap
 * and re-dispatches them with exponential backoff; anything that exhausts its
 * attempts is flagged for admin review rather than silently dropped.
 */
const notificationLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'BOOKING_CONFIRMATION',
        'CANCELLATION',
        'RESCHEDULE',
        'MEDICATION_REMINDER',
        'DOCTOR_INVITE',
      ],
      required: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    recipientRole: {
      type: String,
      enum: ['PATIENT', 'DOCTOR', 'ADMIN'],
    },
    subject: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'SENT', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
      default: '',
    },
    /** Set once retries are exhausted, so an admin can see what never went out. */
    requiresAdminReview: {
      type: Boolean,
      default: false,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
    },
    scheduledFor: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Drives the retry worker's scan: oldest eligible failures first.
notificationLogSchema.index({ status: 1, attempts: 1, updatedAt: 1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
