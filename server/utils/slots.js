const { DateTime } = require('luxon');

/**
 * Slot maths, in one place.
 *
 * Every appointment time in this system is a clinic-local wall-clock string
 * ("09:30" on "2026-08-24"). The clinic's IANA zone comes from TIMEZONE, and
 * the server's own clock is never trusted for slot decisions - a Render dyno
 * running UTC must still compute "is this slot in the past?" against Indian
 * local time.
 */

const clinicZone = () => process.env.TIMEZONE || 'Asia/Kolkata';

/** Current instant, expressed in the clinic's timezone. */
const nowInClinic = () => DateTime.now().setZone(clinicZone());

/** Today's date in the clinic's timezone as YYYY-MM-DD. */
const todayInClinic = () => nowInClinic().toISODate();

/** Combine a YYYY-MM-DD date and an HH:mm time into a zoned DateTime. */
const toClinicDateTime = (date, time) =>
  DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', { zone: clinicZone() });

/** Weekday name ("Monday") for a YYYY-MM-DD date in the clinic's timezone. */
const weekdayFor = (date) => DateTime.fromISO(date, { zone: clinicZone() }).weekdayLong;

const isValidDate = (date) => DateTime.fromISO(date, { zone: clinicZone() }).isValid;

/** True when the given clinic-local date is before today. */
const isPastDate = (date) => {
  const day = DateTime.fromISO(date, { zone: clinicZone() });
  return day.isValid && day.startOf('day') < nowInClinic().startOf('day');
};

/** True when the slot's start has already passed in clinic-local time. */
const isPastSlot = (date, startTime) => {
  const slot = toClinicDateTime(date, startTime);
  return slot.isValid && slot <= nowInClinic();
};

/**
 * Enumerate every slot a doctor's working hours produce on a given date.
 * Returns [] when the doctor does not work that weekday.
 *
 * @returns {{startTime: string, endTime: string}[]}
 */
const generateSlots = (profile, date) => {
  const daySchedule = (profile.workingHours || []).find((w) => w.dayOfWeek === weekdayFor(date));
  if (!daySchedule || !daySchedule.isAvailable) return [];

  const duration = profile.slotDurationMins || 30;
  const dayStart = toClinicDateTime(date, daySchedule.startTime);
  const dayEnd = toClinicDateTime(date, daySchedule.endTime);
  if (!dayStart.isValid || !dayEnd.isValid) return [];

  const slots = [];
  let cursor = dayStart;
  // Guard against a pathological config producing an unbounded loop.
  let guard = 0;
  while (cursor.plus({ minutes: duration }) <= dayEnd && guard++ < 500) {
    const next = cursor.plus({ minutes: duration });
    slots.push({ startTime: cursor.toFormat('HH:mm'), endTime: next.toFormat('HH:mm') });
    cursor = next;
  }
  return slots;
};

/**
 * Confirm that (date, startTime, endTime) is a slot this doctor actually
 * offers - not an arbitrary time a client invented and POSTed directly.
 */
const isRealSlot = (profile, date, startTime, endTime) =>
  generateSlots(profile, date).some((s) => s.startTime === startTime && s.endTime === endTime);

module.exports = {
  clinicZone,
  nowInClinic,
  todayInClinic,
  toClinicDateTime,
  weekdayFor,
  isValidDate,
  isPastDate,
  isPastSlot,
  generateSlots,
  isRealSlot,
};
