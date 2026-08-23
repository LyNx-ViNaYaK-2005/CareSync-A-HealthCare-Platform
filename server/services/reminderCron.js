const cron = require('node-cron');
const { DateTime } = require('luxon');
const Appointment = require('../models/Appointment');
const NotificationLog = require('../models/NotificationLog');
const { sendEmail, sendMedicationReminderEmail } = require('./emailService');

/**
 * Background workers: medication reminders and failed-notification retries.
 *
 * Two things this module is careful about:
 *
 * 1. Timezone. All slot and prescription times are clinic-local ("09:00" means
 *    9am in Asia/Kolkata). Render and most cloud hosts run in UTC, so reading
 *    the server's wall clock would fire Indian reminders 5.5 hours early.
 *    Everything below resolves through TIMEZONE via Luxon.
 *
 * 2. Tick alignment. The cron fires on a fixed cadence, so an exact string
 *    match against "HH:mm" would silently never fire for a dose scheduled at,
 *    say, 09:02. Instead each dose is due across a window, and a per-dose
 *    dedupe key guarantees at-most-once delivery.
 */

const CLINIC_TZ = () => process.env.TIMEZONE || 'Asia/Kolkata';
const TICK_MINUTES = Number(process.env.REMINDER_TICK_MINUTES) || 5;
const WINDOW_MINUTES = Number(process.env.REMINDER_WINDOW_MINUTES) || 15;
const MAX_RETRY_ATTEMPTS = Number(process.env.NOTIFICATION_MAX_ATTEMPTS) || 3;

/** `${medicineName}|${YYYY-MM-DD}|${HH:mm}` - at most one send per dose per day. */
const buildDedupeKey = (medicineName, isoDate, time) => `${medicineName}|${isoDate}|${time}`;

/** Parse "HH:mm" / "H:mm" / "9" into minutes past midnight, or null if unusable. */
const parseTimeToMinutes = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):?(\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * Even spread across waking hours (08:00-22:00) when a prescription specifies
 * a frequency but no explicit times.
 */
const deriveTimesFromFrequency = (frequencyPerDay) => {
  const n = Math.max(1, Math.min(Number(frequencyPerDay) || 1, 6));
  if (n === 1) return ['09:00'];
  const startMin = 8 * 60;
  const endMin = 22 * 60;
  const step = Math.floor((endMin - startMin) / (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const total = startMin + step * i;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });
};

/** Last day of the course, inclusive. */
const courseEndDate = (startDate, durationDays) =>
  startDate.plus({ days: Math.max(1, Number(durationDays) || 1) - 1 }).endOf('day');

/**
 * Scan active prescriptions and dispatch any dose reminder that has come due
 * within the current window and has not already been sent.
 */
const checkAndSendMedicationReminders = async (nowOverride = null) => {
  const tz = CLINIC_TZ();
  const now = nowOverride ? DateTime.fromJSDate(nowOverride).setZone(tz) : DateTime.now().setZone(tz);
  const todayIso = now.toISODate();
  let dispatched = 0;

  try {
    const appointments = await Appointment.find({
      status: 'COMPLETED',
      'prescription.0': { $exists: true },
    }).populate('patient', 'name email');

    for (const appt of appointments) {
      if (!appt.patient?.email) continue;

      // Course start: when the prescription was written, falling back to the
      // visit date for records created before `prescribedAt` existed.
      const startSource = appt.prescribedAt
        ? DateTime.fromJSDate(appt.prescribedAt).setZone(tz)
        : DateTime.fromISO(appt.date, { zone: tz });
      if (!startSource.isValid) continue;
      const courseStart = startSource.startOf('day');

      const alreadySent = new Set((appt.remindersSent || []).map((r) => r.dedupeKey).filter(Boolean));

      for (const item of appt.prescription) {
        if (!item.medicineName) continue;

        const courseEnd = courseEndDate(courseStart, item.durationDays);
        if (now < courseStart.startOf('day') || now > courseEnd) continue; // course not running today

        const times =
          Array.isArray(item.times) && item.times.length > 0
            ? item.times
            : deriveTimesFromFrequency(item.frequencyPerDay);

        for (const rawTime of times) {
          const minutes = parseTimeToMinutes(rawTime);
          if (minutes === null) {
            console.warn(`[Reminder] Skipping unparseable dose time "${rawTime}" for ${item.medicineName}`);
            continue;
          }

          const normalized = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
          const doseAt = now.startOf('day').plus({ minutes });
          const minutesSinceDose = now.diff(doseAt, 'minutes').minutes;

          // Due if the dose time has passed but is still inside the catch-up
          // window - so a delayed or skipped tick still delivers.
          if (minutesSinceDose < 0 || minutesSinceDose >= WINDOW_MINUTES) continue;

          const dedupeKey = buildDedupeKey(item.medicineName, todayIso, normalized);
          if (alreadySent.has(dedupeKey)) continue;

          // Claim the send atomically before dispatching, so two overlapping
          // cron ticks cannot both email the same dose.
          const claimed = await Appointment.updateOne(
            { _id: appt._id, 'remindersSent.dedupeKey': { $ne: dedupeKey } },
            {
              $push: {
                remindersSent: {
                  sentAt: now.toJSDate(),
                  medicineName: item.medicineName,
                  scheduledTime: normalized,
                  dedupeKey,
                },
              },
            }
          );
          if (claimed.modifiedCount === 0) continue;

          alreadySent.add(dedupeKey);

          console.log(
            `[Reminder] ${appt.patient.email} - ${item.medicineName} @ ${normalized} ${tz} (dose ${dedupeKey})`
          );

          await sendMedicationReminderEmail({
            patientEmail: appt.patient.email,
            patientName: appt.patient.name,
            medicineName: item.medicineName,
            dosage: item.dosage,
            instructions: item.instructions,
            scheduledTime: normalized,
            appointmentId: appt._id,
          });

          dispatched++;
        }
      }
    }

    if (dispatched > 0) {
      console.log(`[Reminder] Dispatched ${dispatched} medication reminder(s) at ${now.toFormat('yyyy-LL-dd HH:mm')} ${tz}`);
    }
    return dispatched;
  } catch (err) {
    console.error(`[Reminder Error]: ${err.message}`);
    return dispatched;
  }
};

/**
 * Retry failed notifications with exponential backoff.
 * Attempt n waits 2^n minutes after the last try, so a flapping SMTP host is
 * not hammered on every tick.
 */
const retryFailedNotifications = async () => {
  let retried = 0;
  try {
    const failedLogs = await NotificationLog.find({
      status: 'FAILED',
      attempts: { $lt: MAX_RETRY_ATTEMPTS },
    })
      .sort({ updatedAt: 1 })
      .limit(25);

    for (const log of failedLogs) {
      const backoffMinutes = 2 ** log.attempts; // 2, 4, 8...
      const nextEligibleAt = new Date(new Date(log.updatedAt).getTime() + backoffMinutes * 60 * 1000);
      if (new Date() < nextEligibleAt) continue;

      console.log(`[Retry] Notification ${log._id} attempt ${log.attempts + 1}/${MAX_RETRY_ATTEMPTS}`);
      log.attempts += 1;

      const result = await sendEmail({
        type: log.type,
        recipientEmail: log.recipientEmail,
        subject: log.subject,
        htmlBody: log.body,
        appointmentId: log.appointmentId,
        existingLog: log, // reuse this row instead of creating a duplicate
      });

      if (result.success) {
        log.status = 'SENT';
        log.lastError = '';
      } else {
        log.lastError = result.error || 'Retry attempt failed';
        if (log.attempts >= MAX_RETRY_ATTEMPTS) {
          log.requiresAdminReview = true;
          console.error(`[Retry] Notification ${log._id} permanently failed after ${log.attempts} attempts.`);
        }
      }

      await log.save();
      retried++;
    }

    return retried;
  } catch (err) {
    console.error(`[Retry Error]: ${err.message}`);
    return retried;
  }
};

/**
 * Sweep stale HELD rows whose TTL has lapsed but which Mongo's background
 * thread has not purged yet (it runs only once a minute).
 */
const expireStaleHolds = async () => {
  try {
    const result = await Appointment.updateMany(
      { status: 'HELD', holdExpiresAt: { $lt: new Date() } },
      { $set: { status: 'EXPIRED' }, $unset: { holdExpiresAt: '' } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[Holds] Expired ${result.modifiedCount} stale slot hold(s).`);
    }
    return result.modifiedCount;
  } catch (err) {
    console.error(`[Holds Error]: ${err.message}`);
    return 0;
  }
};

const initReminderCron = () => {
  const tz = CLINIC_TZ();
  console.log(`[Cron] Background workers started (timezone: ${tz}, tick: ${TICK_MINUTES}m, window: ${WINDOW_MINUTES}m)`);

  cron.schedule(`*/${TICK_MINUTES} * * * *`, () => checkAndSendMedicationReminders(), { timezone: tz });
  cron.schedule('*/15 * * * *', () => retryFailedNotifications(), { timezone: tz });
  cron.schedule('*/2 * * * *', () => expireStaleHolds(), { timezone: tz });
};

module.exports = {
  initReminderCron,
  checkAndSendMedicationReminders,
  retryFailedNotifications,
  expireStaleHolds,
  // exported for tests
  parseTimeToMinutes,
  deriveTimesFromFrequency,
  buildDedupeKey,
};
