const test = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, clearDb, seedFixtures, futureWeekday } = require('./helpers');

/**
 * Verification plan: double-booking prevention and the slot-hold lifecycle.
 * These exercise real MongoDB index behaviour, not application-level checks.
 */

test('booking concurrency and hold expiry', async (t) => {
  await startDb();
  const Appointment = require('../models/Appointment');

  t.after(async () => {
    await stopDb();
  });

  t.beforeEach(async () => {
    await clearDb();
  });

  await t.test('concurrent holds on the same slot: exactly one wins', async () => {
    const { doctor } = await seedFixtures();
    const User = require('../models/User');

    // Ten different patients all going for the same slot in the same tick.
    const patients = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        User.create({ name: `P${i}`, email: `p${i}@race.com`, password: 'password123', role: 'PATIENT' })
      )
    );

    const date = futureWeekday(3);
    const results = await Promise.allSettled(
      patients.map((p) =>
        Appointment.create({
          patient: p._id,
          doctor: doctor._id,
          date,
          startTime: '10:00',
          endTime: '10:30',
          status: 'HELD',
          holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const duplicateKeyErrors = results.filter(
      (r) => r.status === 'rejected' && r.reason.code === 11000
    );

    assert.equal(succeeded.length, 1, 'exactly one hold should be created');
    assert.equal(duplicateKeyErrors.length, 9, 'the other nine must fail with E11000, not silently double-book');

    const stored = await Appointment.countDocuments({ doctor: doctor._id, date, startTime: '10:00' });
    assert.equal(stored, 1, 'the database must hold exactly one row for the slot');
  });

  await t.test('a cancelled slot becomes immediately re-bookable', async () => {
    const { patient, doctor } = await seedFixtures();
    const date = futureWeekday(4);

    const first = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date,
      startTime: '11:00',
      endTime: '11:30',
      status: 'CONFIRMED',
    });

    // The partial filter excludes cancelled rows, so the unique index no
    // longer applies and the slot frees up.
    first.status = 'CANCELLED_BY_PATIENT';
    await first.save();

    const second = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date,
      startTime: '11:00',
      endTime: '11:30',
      status: 'CONFIRMED',
    });

    assert.ok(second._id, 'the freed slot must be re-bookable');
    assert.notEqual(String(first._id), String(second._id));
  });

  await t.test('an expired hold cannot be confirmed', async () => {
    const { patient, doctor } = await seedFixtures();
    const date = futureWeekday(5);

    const held = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date,
      startTime: '12:00',
      endTime: '12:30',
      status: 'HELD',
      holdExpiresAt: new Date(Date.now() - 1000), // lapsed one second ago
    });

    // This is the exact atomic filter confirmBooking uses.
    const claimed = await Appointment.findOneAndUpdate(
      { _id: held._id, patient: patient._id, status: 'HELD', holdExpiresAt: { $gt: new Date() } },
      { $set: { status: 'CONFIRMED' } },
      { new: true }
    );

    assert.equal(claimed, null, 'a lapsed hold must not be claimable - the caller returns 410');
  });

  await t.test('a live hold can be confirmed exactly once', async () => {
    const { patient, doctor } = await seedFixtures();
    const date = futureWeekday(6);

    const held = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date,
      startTime: '14:00',
      endTime: '14:30',
      status: 'HELD',
      holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const filter = { _id: held._id, patient: patient._id, status: 'HELD', holdExpiresAt: { $gt: new Date() } };
    const update = { $set: { status: 'CONFIRMED' }, $unset: { holdExpiresAt: '' } };

    const [first, second] = await Promise.all([
      Appointment.findOneAndUpdate(filter, update, { new: true }),
      Appointment.findOneAndUpdate(filter, update, { new: true }),
    ]);

    const winners = [first, second].filter(Boolean);
    assert.equal(winners.length, 1, 'a double-submitted confirm must only succeed once');
    assert.equal(winners[0].status, 'CONFIRMED');
    assert.equal(winners[0].holdExpiresAt, undefined, 'the TTL field must be cleared so Mongo cannot purge the booking');
  });

  await t.test("another patient's hold cannot be confirmed", async () => {
    const { patient, doctor } = await seedFixtures();
    const User = require('../models/User');
    const attacker = await User.create({
      name: 'Attacker',
      email: 'attacker@test.com',
      password: 'password123',
      role: 'PATIENT',
    });

    const date = futureWeekday(7);
    const held = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date,
      startTime: '15:00',
      endTime: '15:30',
      status: 'HELD',
      holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const claimed = await Appointment.findOneAndUpdate(
      { _id: held._id, patient: attacker._id, status: 'HELD', holdExpiresAt: { $gt: new Date() } },
      { $set: { status: 'CONFIRMED' } },
      { new: true }
    );

    assert.equal(claimed, null, 'ownership is part of the atomic filter');
  });
});
