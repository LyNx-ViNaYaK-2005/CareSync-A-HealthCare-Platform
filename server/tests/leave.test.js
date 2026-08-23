const test = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, clearDb, seedFixtures, futureWeekday } = require('./helpers');

/**
 * Verification plan: doctor-leave conflict resolution.
 * Marking leave must cancel every affected booking, record a reason, and
 * queue notifications for both sides.
 */

test('doctor leave cascade', async (t) => {
  await startDb();

  const Appointment = require('../models/Appointment');
  const DoctorLeave = require('../models/DoctorLeave');
  const NotificationLog = require('../models/NotificationLog');
  const User = require('../models/User');
  const { markDoctorLeave, cancelDoctorLeave } = require('../controllers/doctorController');

  t.after(async () => {
    await stopDb();
  });

  t.beforeEach(async () => {
    await clearDb();
  });

  /** Minimal Express res double that captures status and payload. */
  const mockRes = () => {
    const res = { statusCode: 200, payload: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.payload = data;
      return res;
    };
    return res;
  };

  await t.test('cancels every booking on the leave date and notifies both sides', async () => {
    const { doctor } = await seedFixtures();
    const date = futureWeekday(5);

    const patients = await Promise.all(
      ['a', 'b', 'c'].map((k) =>
        User.create({ name: `Patient ${k}`, email: `${k}@leave.com`, password: 'password123', role: 'PATIENT' })
      )
    );

    await Promise.all(
      patients.map((p, i) =>
        Appointment.create({
          patient: p._id,
          doctor: doctor._id,
          date,
          startTime: `1${i}:00`,
          endTime: `1${i}:30`,
          status: 'CONFIRMED',
        })
      )
    );

    // A booking on a different day must survive untouched.
    const otherDay = futureWeekday(6);
    const survivor = await Appointment.create({
      patient: patients[0]._id,
      doctor: doctor._id,
      date: otherDay,
      startTime: '10:00',
      endTime: '10:30',
      status: 'CONFIRMED',
    });

    const res = mockRes();
    await markDoctorLeave(
      {
        params: { id: doctor._id.toString() },
        body: { date, reason: 'Medical conference' },
        user: { id: doctor._id.toString(), role: 'DOCTOR' },
      },
      res
    );

    assert.equal(res.payload.success, true);
    assert.equal(res.payload.cancelledAppointmentsCount, 3);

    const cancelled = await Appointment.find({ date, status: 'CANCELLED_BY_DOCTOR' });
    assert.equal(cancelled.length, 3);
    cancelled.forEach((a) => {
      assert.match(a.cancellationReason, /Medical conference/);
    });

    const untouched = await Appointment.findById(survivor._id);
    assert.equal(untouched.status, 'CONFIRMED', 'other dates must not be affected');

    // Three patient emails + three doctor emails.
    const logs = await NotificationLog.find({ type: 'CANCELLATION' });
    assert.equal(logs.length, 6, 'both the patient and the doctor are notified for each cancellation');
    assert.equal(logs.filter((l) => l.recipientRole === 'PATIENT').length, 3);
    assert.equal(logs.filter((l) => l.recipientRole === 'DOCTOR').length, 3);
  });

  await t.test('a leave date in the past is rejected', async () => {
    const { doctor } = await seedFixtures();
    const res = mockRes();

    await markDoctorLeave(
      {
        params: { id: doctor._id.toString() },
        body: { date: '2020-01-01', reason: 'Backdated' },
        user: { id: doctor._id.toString(), role: 'DOCTOR' },
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(await DoctorLeave.countDocuments(), 0);
  });

  await t.test('a doctor cannot mark leave for a different doctor', async () => {
    const { doctor } = await seedFixtures();
    const other = await User.create({
      name: 'Other Doctor',
      email: 'other@leave.com',
      password: 'password123',
      role: 'DOCTOR',
    });

    const res = mockRes();
    await markDoctorLeave(
      {
        params: { id: doctor._id.toString() },
        body: { date: futureWeekday(3), reason: 'Not mine to take' },
        user: { id: other._id.toString(), role: 'DOCTOR' },
      },
      res
    );

    assert.equal(res.statusCode, 403);
    assert.equal(await DoctorLeave.countDocuments(), 0);
  });

  await t.test('marking the same date twice is idempotent', async () => {
    const { doctor } = await seedFixtures();
    const date = futureWeekday(4);
    const req = {
      params: { id: doctor._id.toString() },
      body: { date, reason: 'Conference' },
      user: { id: doctor._id.toString(), role: 'DOCTOR' },
    };

    await markDoctorLeave(req, mockRes());
    await markDoctorLeave(req, mockRes());

    assert.equal(await DoctorLeave.countDocuments({ doctor: doctor._id, date }), 1, 'the unique index prevents duplicates');
  });

  await t.test('withdrawing leave reopens the date but does not resurrect bookings', async () => {
    const { patient, doctor } = await seedFixtures();
    const date = futureWeekday(7);

    await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date,
      startTime: '10:00',
      endTime: '10:30',
      status: 'CONFIRMED',
    });

    const req = {
      params: { id: doctor._id.toString() },
      body: { date, reason: 'Changed my mind' },
      user: { id: doctor._id.toString(), role: 'DOCTOR' },
    };

    await markDoctorLeave(req, mockRes());
    const withdrawRes = mockRes();
    await cancelDoctorLeave({ ...req, body: { date } }, withdrawRes);

    assert.equal(withdrawRes.payload.success, true);

    const leave = await DoctorLeave.findOne({ doctor: doctor._id, date });
    assert.equal(leave.status, 'CANCELLED', 'the date is bookable again');

    const appt = await Appointment.findOne({ date });
    assert.equal(appt.status, 'CANCELLED_BY_DOCTOR', 'the patient was told to rebook; do not silently restore');
  });
});
