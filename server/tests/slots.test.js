const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');

/**
 * Slot generation and the past-slot guard. These are pure functions, so no
 * database is needed.
 */

test('slot maths', async (t) => {
  const originalTz = process.env.TIMEZONE;
  process.env.TIMEZONE = 'Asia/Kolkata';

  const { generateSlots, isRealSlot, isPastSlot, isPastDate, weekdayFor } = require('../utils/slots');

  t.after(() => {
    if (originalTz) process.env.TIMEZONE = originalTz;
  });

  /** A profile that works 09:00-17:00 on every day of the week. */
  const alwaysOpen = (slotDurationMins = 30) => ({
    slotDurationMins,
    workingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({
      dayOfWeek: d,
      startTime: '09:00',
      endTime: '17:00',
      isAvailable: true,
    })),
  });

  await t.test('generates back-to-back slots across working hours', () => {
    const slots = generateSlots(alwaysOpen(30), '2026-09-07');

    assert.equal(slots.length, 16, '8 hours / 30 minutes');
    assert.deepEqual(slots[0], { startTime: '09:00', endTime: '09:30' });
    assert.deepEqual(slots[slots.length - 1], { startTime: '16:30', endTime: '17:00' });
  });

  await t.test('respects a non-30-minute slot duration', () => {
    const slots = generateSlots(alwaysOpen(45), '2026-09-07');
    assert.equal(slots[0].endTime, '09:45');
    // 8 hours / 45 min = 10 whole slots; the trailing 30 minutes are not offered.
    assert.equal(slots.length, 10);
    assert.equal(slots[slots.length - 1].endTime, '16:30');
  });

  await t.test('returns nothing for a day the doctor does not work', () => {
    const profile = alwaysOpen();
    profile.workingHours = profile.workingHours.map((h) =>
      h.dayOfWeek === 'Sunday' ? { ...h, isAvailable: false } : h
    );
    // 2026-09-06 is a Sunday.
    assert.equal(weekdayFor('2026-09-06'), 'Sunday');
    assert.deepEqual(generateSlots(profile, '2026-09-06'), []);
  });

  await t.test('rejects a slot the doctor does not offer', () => {
    const profile = alwaysOpen(30);

    assert.equal(isRealSlot(profile, '2026-09-07', '09:00', '09:30'), true);
    assert.equal(isRealSlot(profile, '2026-09-07', '03:00', '03:30'), false, 'a 3am slot is not on offer');
    assert.equal(isRealSlot(profile, '2026-09-07', '09:15', '09:45'), false, 'off-grid start times are rejected');
    assert.equal(isRealSlot(profile, '2026-09-07', '09:00', '10:00'), false, 'the duration must match');
    assert.equal(isRealSlot(profile, '2026-09-07', '17:00', '17:30'), false, 'past closing time');
  });

  await t.test('identifies past dates and slots in clinic-local time', () => {
    assert.equal(isPastDate('2020-01-01'), true);
    assert.equal(isPastDate('2099-01-01'), false);

    const yesterday = DateTime.now().setZone('Asia/Kolkata').minus({ days: 1 }).toISODate();
    assert.equal(isPastSlot(yesterday, '09:00'), true);

    const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();
    assert.equal(isPastSlot(tomorrow, '09:00'), false);
  });

  await t.test('today\'s earlier slots count as past', () => {
    const now = DateTime.now().setZone('Asia/Kolkata');
    const today = now.toISODate();

    // Only meaningful once the clinic day is underway.
    if (now.hour > 1) {
      const anHourAgo = now.minus({ hours: 1 }).toFormat('HH:mm');
      assert.equal(isPastSlot(today, anHourAgo), true, 'a slot earlier today must not be bookable');
    }
    if (now.hour < 22) {
      const inTwoHours = now.plus({ hours: 2 }).toFormat('HH:mm');
      assert.equal(isPastSlot(today, inTwoHours), false);
    }
  });

  await t.test('a malformed working-hours range yields no slots instead of looping', () => {
    const broken = {
      slotDurationMins: 30,
      workingHours: [{ dayOfWeek: 'Monday', startTime: '17:00', endTime: '09:00', isAvailable: true }],
    };
    // 2026-09-07 is a Monday.
    assert.equal(weekdayFor('2026-09-07'), 'Monday');
    assert.deepEqual(generateSlots(broken, '2026-09-07'), []);
  });
});
