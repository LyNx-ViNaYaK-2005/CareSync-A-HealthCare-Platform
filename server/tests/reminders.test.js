const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { startDb, stopDb, clearDb, seedFixtures } = require('./helpers');

/**
 * Verification plan: medication reminders must fire at the right clinic-local
 * time, exactly once per dose, and stop when the course ends.
 *
 * The timezone case is the important one: these assertions run against a UTC
 * server clock (as on Render) with an Asia/Kolkata clinic, the exact
 * combination that made the previous implementation fire 5.5 hours early.
 */

test('medication reminder scheduling', async (t) => {
  await startDb();

  const originalTz = process.env.TIMEZONE;
  process.env.TIMEZONE = 'Asia/Kolkata';

  const Appointment = require('../models/Appointment');
  const NotificationLog = require('../models/NotificationLog');
  const {
    checkAndSendMedicationReminders,
    parseTimeToMinutes,
    deriveTimesFromFrequency,
    expireStaleHolds,
  } = require('../services/reminderCron');

  t.after(async () => {
    if (originalTz) process.env.TIMEZONE = originalTz;
    await stopDb();
  });

  t.beforeEach(async () => {
    await clearDb();
  });

  /** A completed visit with one twice-daily medication. */
  const seedPrescription = async ({ times = ['09:00', '21:00'], durationDays = 5, prescribedAt = new Date() } = {}) => {
    const { patient, doctor } = await seedFixtures();
    return Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date: DateTime.now().setZone('Asia/Kolkata').toISODate(),
      startTime: '10:00',
      endTime: '10:30',
      status: 'COMPLETED',
      prescribedAt,
      prescription: [
        { medicineName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: times.length, times, durationDays, instructions: 'After meals' },
      ],
    });
  };

  await t.test('a dose fires at the clinic-local time, not the server\'s UTC time', async () => {
    const appt = await seedPrescription({ times: ['09:00'] });

    // 09:00 Asia/Kolkata == 03:30 UTC. Passing that instant must trigger.
    const nineAmIst = DateTime.fromISO(`${DateTime.now().setZone('Asia/Kolkata').toISODate()}T09:00`, {
      zone: 'Asia/Kolkata',
    }).toJSDate();

    const sent = await checkAndSendMedicationReminders(nineAmIst);
    assert.equal(sent, 1, 'the 09:00 IST dose must fire when the clock reads 09:00 in Kolkata');

    const updated = await Appointment.findById(appt._id);
    assert.equal(updated.remindersSent.length, 1);
    assert.equal(updated.remindersSent[0].scheduledTime, '09:00');
  });

  await t.test('the same dose never fires twice', async () => {
    await seedPrescription({ times: ['09:00'] });
    const doseTime = DateTime.fromISO(`${DateTime.now().setZone('Asia/Kolkata').toISODate()}T09:00`, {
      zone: 'Asia/Kolkata',
    }).toJSDate();

    const first = await checkAndSendMedicationReminders(doseTime);
    // Five minutes later the dose is still inside the catch-up window.
    const second = await checkAndSendMedicationReminders(new Date(doseTime.getTime() + 5 * 60 * 1000));

    assert.equal(first, 1);
    assert.equal(second, 0, 'the dedupe key must suppress the repeat');
  });

  await t.test('a dose scheduled off the cron tick still fires', async () => {
    // 09:02 is not a multiple of the 5-minute tick. The old exact-string match
    // would have skipped this dose forever.
    await seedPrescription({ times: ['09:02'] });

    const tickAt = DateTime.fromISO(`${DateTime.now().setZone('Asia/Kolkata').toISODate()}T09:05`, {
      zone: 'Asia/Kolkata',
    }).toJSDate();

    const sent = await checkAndSendMedicationReminders(tickAt);
    assert.equal(sent, 1, 'the 09:05 tick must catch the 09:02 dose via the window');
  });

  await t.test('nothing fires before the dose time', async () => {
    await seedPrescription({ times: ['21:00'] });
    const morning = DateTime.fromISO(`${DateTime.now().setZone('Asia/Kolkata').toISODate()}T08:00`, {
      zone: 'Asia/Kolkata',
    }).toJSDate();

    assert.equal(await checkAndSendMedicationReminders(morning), 0);
  });

  await t.test('reminders stop once the course finishes', async () => {
    const tenDaysAgo = DateTime.now().setZone('Asia/Kolkata').minus({ days: 10 }).toJSDate();
    await seedPrescription({ times: ['09:00'], durationDays: 5, prescribedAt: tenDaysAgo });

    const now = DateTime.fromISO(`${DateTime.now().setZone('Asia/Kolkata').toISODate()}T09:00`, {
      zone: 'Asia/Kolkata',
    }).toJSDate();

    assert.equal(
      await checkAndSendMedicationReminders(now),
      0,
      'a 5-day course started 10 days ago must not still be sending'
    );
  });

  await t.test('reminders are logged to the notification outbox', async () => {
    await seedPrescription({ times: ['09:00'] });
    const doseTime = DateTime.fromISO(`${DateTime.now().setZone('Asia/Kolkata').toISODate()}T09:00`, {
      zone: 'Asia/Kolkata',
    }).toJSDate();

    await checkAndSendMedicationReminders(doseTime);

    const logs = await NotificationLog.find({ type: 'MEDICATION_REMINDER' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'SENT'); // simulated transport with no SMTP configured
  });

  await t.test('stale holds are swept to EXPIRED', async () => {
    const { patient, doctor } = await seedFixtures();
    await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date: '2026-12-01',
      startTime: '10:00',
      endTime: '10:30',
      status: 'HELD',
      holdExpiresAt: new Date(Date.now() - 60 * 1000),
    });

    assert.equal(await expireStaleHolds(), 1);
    const swept = await Appointment.findOne({ date: '2026-12-01' });
    assert.equal(swept.status, 'EXPIRED');
    assert.equal(swept.holdExpiresAt, undefined);
  });

  await t.test('time parsing helpers', () => {
    assert.equal(parseTimeToMinutes('09:30'), 570);
    assert.equal(parseTimeToMinutes('9:05'), 545);
    assert.equal(parseTimeToMinutes('00:00'), 0);
    assert.equal(parseTimeToMinutes('23:59'), 1439);
    assert.equal(parseTimeToMinutes('25:00'), null, 'an impossible hour must be rejected, not wrapped');
    assert.equal(parseTimeToMinutes('morning'), null);
    assert.equal(parseTimeToMinutes(null), null);
  });

  await t.test('frequency derives sensible dose times', () => {
    assert.deepEqual(deriveTimesFromFrequency(1), ['09:00']);
    assert.equal(deriveTimesFromFrequency(2).length, 2);
    assert.equal(deriveTimesFromFrequency(3).length, 3);
    // Every derived time must land inside waking hours.
    deriveTimesFromFrequency(4).forEach((t) => {
      const mins = parseTimeToMinutes(t);
      assert.ok(mins >= 8 * 60 && mins <= 22 * 60, `${t} should be within 08:00-22:00`);
    });
  });
});
