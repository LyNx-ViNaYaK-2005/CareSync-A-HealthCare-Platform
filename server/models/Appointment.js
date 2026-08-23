const mongoose = require('mongoose');

const prescriptionItemSchema = new mongoose.Schema(
  {
    medicineName: { type: String, required: true },
    dosage: { type: String, required: true }, // e.g. "500mg" or "1 tablet"
    frequencyPerDay: { type: Number, required: true, default: 1 },
    times: [{ type: String }], // 24h clock in clinic timezone, e.g. ["09:00", "21:00"]
    durationDays: { type: Number, required: true, default: 5 },
    instructions: { type: String, default: 'Take after meals' },
  },
  { _id: false }
);

/**
 * The medication schedule the LLM derived from the clinical notes.
 * Stored for display and for cross-checking against what the doctor entered.
 * Reminders are always driven by the doctor's `prescription` array, never by
 * this - an LLM must not be the source of truth for what a patient takes.
 */
const llmMedicationSchema = new mongoose.Schema(
  {
    medicineName: { type: String },
    dosage: { type: String },
    frequencyPerDay: { type: Number },
    times: [{ type: String }],
    durationDays: { type: Number },
    instructions: { type: String },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD in clinic timezone
      required: true,
    },
    startTime: {
      type: String, // HH:mm, e.g. "09:30"
      required: true,
    },
    endTime: {
      type: String, // HH:mm, e.g. "10:00"
      required: true,
    },
    status: {
      type: String,
      enum: ['HELD', 'CONFIRMED', 'COMPLETED', 'CANCELLED_BY_PATIENT', 'CANCELLED_BY_DOCTOR', 'EXPIRED'],
      default: 'HELD',
    },
    holdExpiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 }, // TTL: Mongo purges unconfirmed holds
    },
    symptomsText: {
      type: String,
      default: '',
    },
    preVisitSummary: {
      urgencyLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
      chiefComplaint: { type: String, default: '' },
      suggestedQuestions: [{ type: String }],
      llmStatus: { type: String, enum: ['SUCCESS', 'FAILED_FALLBACK'], default: 'SUCCESS' },
      generatedAt: { type: Date },
    },
    postVisitNotes: {
      type: String,
      default: '',
    },
    prescription: [prescriptionItemSchema],
    /** Date the prescription course starts counting from (drives reminder expiry). */
    prescribedAt: {
      type: Date,
    },
    postVisitSummary: {
      patientFriendlySummary: { type: String, default: '' },
      medicationSchedule: { type: [llmMedicationSchema], default: [] },
      followUpSteps: [{ type: String }],
      llmStatus: { type: String, enum: ['SUCCESS', 'FAILED_FALLBACK'], default: 'SUCCESS' },
      generatedAt: { type: Date },
    },
    googleEventId: {
      type: String,
      default: '',
    },
    googleEventLink: {
      type: String,
      default: '',
    },
    cancellationReason: {
      type: String,
      default: '',
    },
    rescheduleHistory: [
      {
        fromDate: String,
        fromStartTime: String,
        toDate: String,
        toStartTime: String,
        rescheduledAt: { type: Date, default: Date.now },
        rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    remindersSent: [
      {
        sentAt: { type: Date, default: Date.now },
        medicineName: String,
        scheduledTime: String,
        /** `${medicineName}|${YYYY-MM-DD}|${HH:mm}` - the idempotency key for the cron. */
        dedupeKey: { type: String, index: true },
      },
    ],
  },
  {
    timestamps: true,
  }
);

/**
 * Double-booking guard.
 * At most one HELD-or-CONFIRMED appointment can exist per doctor/date/startTime.
 * Cancelled and expired rows fall outside the partial filter, so a freed slot
 * becomes immediately re-bookable.
 */
appointmentSchema.index(
  { doctor: 1, date: 1, startTime: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['HELD', 'CONFIRMED'] } },
  }
);

// Supports the reminder cron's scan for active prescription courses.
appointmentSchema.index({ status: 1, prescribedAt: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
