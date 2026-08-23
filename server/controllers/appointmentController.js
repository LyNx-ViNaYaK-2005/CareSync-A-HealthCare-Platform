const Appointment = require('../models/Appointment');
const DoctorProfile = require('../models/DoctorProfile');
const DoctorLeave = require('../models/DoctorLeave');
const { generatePreVisitSummary, generatePostVisitSummary } = require('../services/llmService');
const {
  sendBookingConfirmationEmail,
  sendCancellationEmail,
  sendRescheduleEmail,
} = require('../services/emailService');
const {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} = require('../services/googleCalendarService');
const {
  clinicZone,
  todayInClinic,
  weekdayFor,
  isPastSlot,
  isPastDate,
  generateSlots,
  isRealSlot,
} = require('../utils/slots');

const HOLD_DURATION_MS = (Number(process.env.SLOT_HOLD_MINUTES) || 5) * 60 * 1000;

/** Ids populated by Mongoose can be documents or raw ObjectIds; normalise both. */
const idOf = (ref) => (ref && ref._id ? ref._id.toString() : String(ref));

/**
 * @desc    Available slots for a doctor on a date
 * @route   GET /api/appointments/available-slots
 * @access  Public
 */
const getAvailableSlots = async (req, res) => {
  try {
    const { doctorId, date } = req.validatedQuery || req.query;

    // Doctor on leave: no slots at all, and say why.
    const leave = await DoctorLeave.findOne({ doctor: doctorId, date, status: 'ACTIVE' });
    if (leave) {
      return res.json({ success: true, date, onLeave: true, leaveReason: leave.reason, slots: [] });
    }

    const profile = await DoctorProfile.findOne({ user: doctorId, isActive: true });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found or inactive' });
    }

    const allSlots = generateSlots(profile, date);
    if (allSlots.length === 0) {
      return res.json({
        success: true,
        date,
        isWorkingDay: false,
        dayOfWeek: weekdayFor(date),
        slots: [],
      });
    }

    // Anything HELD (and unexpired) or CONFIRMED occupies its slot.
    const taken = await Appointment.find({
      doctor: doctorId,
      date,
      $or: [{ status: 'CONFIRMED' }, { status: 'HELD', holdExpiresAt: { $gt: new Date() } }],
    }).select('startTime');
    const takenTimes = new Set(taken.map((a) => a.startTime));

    const slots = allSlots.map((slot) => {
      const past = isPastSlot(date, slot.startTime);
      return {
        ...slot,
        isAvailable: !takenTimes.has(slot.startTime) && !past,
        // Distinguishes "someone booked it" from "that time already went by".
        reason: takenTimes.has(slot.startTime) ? 'BOOKED' : past ? 'PAST' : null,
      };
    });

    return res.json({
      success: true,
      date,
      dayOfWeek: weekdayFor(date),
      timezone: clinicZone(),
      slotDurationMins: profile.slotDurationMins,
      roomNumber: profile.roomNumber,
      slots,
    });
  } catch (error) {
    console.error('Get Available Slots Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Reserve a slot for 5 minutes while the patient fills the symptom form
 * @route   POST /api/appointments/hold
 * @access  Private (PATIENT)
 *
 * The partial unique index on { doctor, date, startTime } filtered to
 * HELD/CONFIRMED is the real guarantee here: the pre-check below is a
 * courtesy that produces a friendlier message, but two requests landing in
 * the same millisecond are separated by the database, and the loser surfaces
 * as an E11000 duplicate-key error caught at the bottom.
 */
const holdSlot = async (req, res) => {
  try {
    const { doctorId, date, startTime, endTime } = req.body;
    const patientId = req.user.id;

    // The slot must be one the doctor actually offers - never trust a
    // client-supplied time, which would otherwise let a patient book 03:00.
    const profile = await DoctorProfile.findOne({ user: doctorId, isActive: true });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found or inactive' });
    }
    if (!isRealSlot(profile, date, startTime, endTime)) {
      return res.status(400).json({
        success: false,
        message: 'That is not a valid slot in this doctor\'s schedule. Please refresh and pick again.',
      });
    }
    if (isPastSlot(date, startTime)) {
      return res.status(400).json({ success: false, message: 'That slot is in the past. Please pick a future slot.' });
    }

    const onLeave = await DoctorLeave.findOne({ doctor: doctorId, date, status: 'ACTIVE' });
    if (onLeave) {
      return res.status(409).json({
        success: false,
        message: `Dr. is on leave on ${date} (${onLeave.reason}). Please choose another date.`,
      });
    }

    const existing = await Appointment.findOne({
      doctor: doctorId,
      date,
      startTime,
      $or: [{ status: 'CONFIRMED' }, { status: 'HELD', holdExpiresAt: { $gt: new Date() } }],
    });

    if (existing) {
      // Same patient re-entering the flow: extend their own hold rather than reject.
      if (existing.status === 'HELD' && idOf(existing.patient) === patientId) {
        existing.holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MS);
        await existing.save();
        return res.json({
          success: true,
          message: 'Slot hold extended',
          appointmentId: existing._id,
          holdExpiresAt: existing.holdExpiresAt,
        });
      }
      return res.status(409).json({
        success: false,
        message: 'This slot was just reserved or booked by another patient. Please select another slot.',
      });
    }

    const appointment = await Appointment.create({
      patient: patientId,
      doctor: doctorId,
      date,
      startTime,
      endTime,
      status: 'HELD',
      holdExpiresAt: new Date(Date.now() + HOLD_DURATION_MS),
    });

    return res.status(201).json({
      success: true,
      message: `Slot reserved for ${HOLD_DURATION_MS / 60000} minutes`,
      appointmentId: appointment._id,
      holdExpiresAt: appointment.holdExpiresAt,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This slot was just reserved or booked by another patient. Please select another slot.',
      });
    }
    console.error('Hold Slot Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Confirm a held slot: AI pre-visit summary, calendar sync, emails
 * @route   POST /api/appointments/confirm
 * @access  Private (PATIENT)
 */
const confirmBooking = async (req, res) => {
  try {
    const { appointmentId, symptomsText } = req.body;
    const patientId = req.user.id;

    // Claim the hold atomically. Filtering on status, owner and expiry inside
    // the update means a hold that lapsed a millisecond ago cannot be
    // confirmed by a slow client, and the row cannot be claimed twice.
    const claimed = await Appointment.findOneAndUpdate(
      {
        _id: appointmentId,
        patient: patientId,
        status: 'HELD',
        holdExpiresAt: { $gt: new Date() },
      },
      { $set: { status: 'CONFIRMED', symptomsText }, $unset: { holdExpiresAt: '' } },
      { new: true }
    )
      .populate('patient', 'name email')
      .populate('doctor', 'name email');

    if (!claimed) {
      // Work out which failure it was, so the client can react correctly.
      const existing = await Appointment.findById(appointmentId);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Appointment hold not found. Please select a slot again.' });
      }
      if (idOf(existing.patient) !== patientId) {
        return res.status(403).json({ success: false, message: 'Not authorized to confirm this appointment' });
      }
      if (existing.status === 'CONFIRMED') {
        return res.status(409).json({ success: false, message: 'This appointment is already confirmed.' });
      }
      return res.status(410).json({
        success: false,
        message: 'SLOT_EXPIRED: Your hold on this slot has lapsed. Please select a slot again.',
      });
    }

    // Side effects run after the slot is safely locked. None of them may
    // block or roll back a booking that is already committed.
    const { summary: preSummary } = await generatePreVisitSummary(symptomsText);

    const profile = await DoctorProfile.findOne({ user: claimed.doctor._id }).select('roomNumber');

    const calResult = await createCalendarEvent({
      summary: `Appointment: ${claimed.patient.name} with Dr. ${claimed.doctor.name}`,
      description: `Chief complaint: ${preSummary.chiefComplaint}\n\nReported symptoms: ${symptomsText}`,
      date: claimed.date,
      startTime: claimed.startTime,
      endTime: claimed.endTime,
      patientEmail: claimed.patient.email,
      doctorEmail: claimed.doctor.email,
    });

    claimed.preVisitSummary = {
      urgencyLevel: preSummary.urgencyLevel,
      chiefComplaint: preSummary.chiefComplaint,
      suggestedQuestions: preSummary.suggestedQuestions,
      llmStatus: preSummary.llmStatus,
      generatedAt: new Date(),
    };
    claimed.googleEventId = calResult.eventId || '';
    claimed.googleEventLink = calResult.htmlLink || '';
    await claimed.save();

    await sendBookingConfirmationEmail({
      patientEmail: claimed.patient.email,
      patientName: claimed.patient.name,
      doctorEmail: claimed.doctor.email,
      doctorName: claimed.doctor.name,
      date: claimed.date,
      startTime: claimed.startTime,
      endTime: claimed.endTime,
      roomNumber: profile?.roomNumber,
      chiefComplaint: preSummary.chiefComplaint,
      urgencyLevel: preSummary.urgencyLevel,
      appointmentId: claimed._id,
      googleEventLink: calResult.htmlLink,
    });

    return res.json({ success: true, message: 'Appointment confirmed', appointment: claimed });
  } catch (error) {
    console.error('Confirm Booking Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    List appointments, scoped to the caller's role
 * @route   GET /api/appointments
 * @access  Private
 */
const getAppointments = async (req, res) => {
  try {
    const query = {};
    if (req.user.role === 'PATIENT') query.patient = req.user.id;
    else if (req.user.role === 'DOCTOR') query.doctor = req.user.id;
    // ADMIN sees everything.

    const { status, date, doctorId } = req.query;
    if (status) query.status = status;
    if (date) query.date = date;
    if (doctorId && req.user.role === 'ADMIN') query.doctor = doctorId;

    // Held-but-unconfirmed rows are transient booking state, not appointments;
    // showing them would confuse every dashboard.
    if (!status) query.status = { $ne: 'HELD' };

    const appointments = await Appointment.find(query)
      .populate('patient', 'name email phone')
      .populate('doctor', 'name email')
      .sort({ date: -1, startTime: 1 });

    return res.json({ success: true, count: appointments.length, appointments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Single appointment
 * @route   GET /api/appointments/:id
 * @access  Private (own appointment, or admin)
 */
const getAppointmentById = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'name email phone')
      .populate('doctor', 'name email');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    const involved = idOf(appointment.patient) === req.user.id || idOf(appointment.doctor) === req.user.id;
    if (req.user.role !== 'ADMIN' && !involved) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this appointment' });
    }

    return res.json({ success: true, appointment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Doctor records notes + prescription; AI writes the patient summary
 * @route   POST /api/appointments/:id/consultation
 * @access  Private (DOCTOR who owns the appointment, or ADMIN)
 */
const submitPostVisitConsultation = async (req, res) => {
  try {
    const { clinicalNotes, prescription } = req.body;

    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'name email')
      .populate('doctor', 'name email');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    if (req.user.role === 'DOCTOR' && idOf(appointment.doctor) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to record notes for this appointment' });
    }
    if (['CANCELLED_BY_PATIENT', 'CANCELLED_BY_DOCTOR', 'EXPIRED'].includes(appointment.status)) {
      return res.status(409).json({ success: false, message: 'Cannot record a consultation for a cancelled appointment' });
    }

    const { summary: postSummary } = await generatePostVisitSummary(clinicalNotes, prescription);

    appointment.status = 'COMPLETED';
    appointment.postVisitNotes = clinicalNotes;
    appointment.prescription = prescription;
    // Reminder scheduling counts from the moment the prescription is written.
    if (prescription.length > 0 && !appointment.prescribedAt) {
      appointment.prescribedAt = new Date();
    }
    appointment.postVisitSummary = {
      patientFriendlySummary: postSummary.patientFriendlySummary,
      // The doctor's `prescription` remains the source of truth for reminders;
      // this is the LLM's rendering of it, kept for the patient-facing view.
      medicationSchedule: postSummary.medicationSchedule,
      followUpSteps: postSummary.followUpSteps,
      llmStatus: postSummary.llmStatus,
      generatedAt: new Date(),
    };

    await appointment.save();

    return res.json({
      success: true,
      message: 'Consultation recorded and patient summary generated',
      appointment,
    });
  } catch (error) {
    console.error('Submit Consultation Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Cancel an appointment; removes the calendar event, notifies both sides
 * @route   PUT /api/appointments/:id/cancel
 * @access  Private (patient, their doctor, or admin)
 */
const cancelAppointment = async (req, res) => {
  try {
    const { reason } = req.body;
    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'name email')
      .populate('doctor', 'name email');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    const isPatient = idOf(appointment.patient) === req.user.id;
    const isDoctor = idOf(appointment.doctor) === req.user.id;
    if (!isPatient && !isDoctor && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this appointment' });
    }
    if (appointment.status.startsWith('CANCELLED')) {
      return res.status(409).json({ success: false, message: 'This appointment is already cancelled' });
    }
    if (appointment.status === 'COMPLETED') {
      return res.status(409).json({ success: false, message: 'A completed consultation cannot be cancelled' });
    }

    appointment.status = isPatient ? 'CANCELLED_BY_PATIENT' : 'CANCELLED_BY_DOCTOR';
    appointment.cancellationReason = reason || (isPatient ? 'Cancelled by patient' : 'Cancelled by clinic');
    appointment.holdExpiresAt = undefined;
    await appointment.save();

    if (appointment.googleEventId) {
      await deleteCalendarEvent(appointment.googleEventId);
    }

    // Both parties are notified regardless of who cancelled - the other side
    // is precisely the one who needs to know.
    await sendCancellationEmail({
      patientEmail: appointment.patient?.email,
      patientName: appointment.patient?.name,
      doctorEmail: appointment.doctor?.email,
      doctorName: appointment.doctor?.name,
      date: appointment.date,
      startTime: appointment.startTime,
      reason: appointment.cancellationReason,
      cancelledBy: isPatient ? 'cancelled by the patient' : 'cancelled by the clinic',
      appointmentId: appointment._id,
    });

    return res.json({ success: true, message: 'Appointment cancelled', appointment });
  } catch (error) {
    console.error('Cancel Appointment Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Move an appointment to a new slot
 * @route   PUT /api/appointments/:id/reschedule
 * @access  Private (patient, their doctor, or admin)
 */
const rescheduleAppointment = async (req, res) => {
  try {
    const { newDate, newStartTime, newEndTime } = req.body;
    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'name email')
      .populate('doctor', 'name email');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    // Authorization: only the two people involved, or an admin.
    const isPatient = idOf(appointment.patient) === req.user.id;
    const isDoctor = idOf(appointment.doctor) === req.user.id;
    if (!isPatient && !isDoctor && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized to reschedule this appointment' });
    }
    if (appointment.status !== 'CONFIRMED') {
      return res.status(409).json({
        success: false,
        message: `Only a confirmed appointment can be rescheduled (this one is ${appointment.status}).`,
      });
    }

    const doctorId = idOf(appointment.doctor);

    if (isPastDate(newDate) || isPastSlot(newDate, newStartTime)) {
      return res.status(400).json({ success: false, message: 'Cannot reschedule into the past' });
    }

    const profile = await DoctorProfile.findOne({ user: doctorId, isActive: true });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found or inactive' });
    }
    if (!isRealSlot(profile, newDate, newStartTime, newEndTime)) {
      return res.status(400).json({
        success: false,
        message: 'The requested time is not a valid slot in this doctor\'s schedule',
      });
    }

    const onLeave = await DoctorLeave.findOne({ doctor: doctorId, date: newDate, status: 'ACTIVE' });
    if (onLeave) {
      return res.status(409).json({
        success: false,
        message: `The doctor is on leave on ${newDate} (${onLeave.reason})`,
      });
    }

    const oldDate = appointment.date;
    const oldStartTime = appointment.startTime;

    appointment.date = newDate;
    appointment.startTime = newStartTime;
    appointment.endTime = newEndTime;
    appointment.rescheduleHistory.push({
      fromDate: oldDate,
      fromStartTime: oldStartTime,
      toDate: newDate,
      toStartTime: newStartTime,
      rescheduledAt: new Date(),
      rescheduledBy: req.user.id,
    });

    try {
      // The partial unique index rejects a collision here, same as on booking.
      await appointment.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'The requested new slot is no longer available' });
      }
      throw err;
    }

    if (appointment.googleEventId) {
      await updateCalendarEvent({
        eventId: appointment.googleEventId,
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime,
        summary: `Appointment: ${appointment.patient.name} with Dr. ${appointment.doctor.name}`,
      });
    }

    await sendRescheduleEmail({
      patientEmail: appointment.patient?.email,
      patientName: appointment.patient?.name,
      doctorEmail: appointment.doctor?.email,
      doctorName: appointment.doctor?.name,
      oldDate,
      oldStartTime,
      newDate,
      newStartTime,
      newEndTime,
      appointmentId: appointment._id,
    });

    return res.json({ success: true, message: 'Appointment rescheduled', appointment });
  } catch (error) {
    console.error('Reschedule Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Clinic-wide statistics for the admin console
 * @route   GET /api/appointments/stats
 * @access  Private (ADMIN)
 */
const getAppointmentStats = async (req, res) => {
  try {
    const NotificationLog = require('../models/NotificationLog');
    const today = todayInClinic();

    const [byStatus, todayCount, upcomingCount, urgency, notifications, failedNotifications] = await Promise.all([
      Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Appointment.countDocuments({ date: today, status: { $in: ['CONFIRMED', 'COMPLETED'] } }),
      Appointment.countDocuments({ date: { $gt: today }, status: 'CONFIRMED' }),
      Appointment.aggregate([
        { $match: { 'preVisitSummary.urgencyLevel': { $exists: true }, status: { $ne: 'HELD' } } },
        { $group: { _id: '$preVisitSummary.urgencyLevel', count: { $sum: 1 } } },
      ]),
      NotificationLog.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      NotificationLog.countDocuments({ requiresAdminReview: true }),
    ]);

    const toMap = (rows) => rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});

    return res.json({
      success: true,
      stats: {
        appointmentsByStatus: toMap(byStatus),
        todayCount,
        upcomingCount,
        urgencyBreakdown: toMap(urgency),
        notificationsByStatus: toMap(notifications),
        failedNotifications,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAvailableSlots,
  holdSlot,
  confirmBooking,
  getAppointments,
  getAppointmentById,
  submitPostVisitConsultation,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentStats,
};
