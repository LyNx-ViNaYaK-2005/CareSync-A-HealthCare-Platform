const crypto = require('crypto');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const DoctorLeave = require('../models/DoctorLeave');
const Appointment = require('../models/Appointment');
const { sendDoctorInviteEmail, sendCancellationEmail } = require('../services/emailService');
const { deleteCalendarEvent } = require('../services/googleCalendarService');
const { isPastDate, todayInClinic } = require('../utils/slots');

const idOf = (ref) => (ref && ref._id ? ref._id.toString() : String(ref));

/** Temporary password for an invited doctor: random, not guessable from the name. */
const generateTempPassword = () =>
  `Dr${crypto.randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, 'x')}!7`;

/**
 * @desc    Admin creates a doctor account + profile and emails an invite
 * @route   POST /api/doctors
 * @access  Private (ADMIN)
 */
const createDoctor = async (req, res) => {
  try {
    const { name, email, specialization, phone, slotDurationMins, roomNumber, bio, workingHours } = req.body;

    if (await User.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'A user with this email already exists' });
    }

    const tempPassword = generateTempPassword();

    const user = await User.create({
      name,
      email,
      password: tempPassword,
      role: 'DOCTOR',
      phone,
      mustResetPassword: true,
    });

    let profile;
    try {
      profile = await DoctorProfile.create({
        user: user._id,
        specialization,
        slotDurationMins,
        roomNumber,
        bio,
        ...(workingHours ? { workingHours } : {}),
      });
    } catch (profileErr) {
      // Never leave an orphaned doctor User with no profile behind.
      await User.deleteOne({ _id: user._id });
      throw profileErr;
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    await sendDoctorInviteEmail({
      doctorEmail: user.email,
      doctorName: user.name,
      tempPassword,
      loginUrl: `${clientUrl}/login`,
    });

    return res.status(201).json({
      success: true,
      message: `Doctor account created. An invite with a temporary password was sent to ${user.email}.`,
      doctor: {
        id: user._id,
        name: user.name,
        email: user.email,
        specialization: profile.specialization,
        slotDurationMins: profile.slotDurationMins,
        roomNumber: profile.roomNumber,
        workingHours: profile.workingHours,
      },
    });
  } catch (error) {
    console.error('Create Doctor Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    List doctors, optionally filtered by specialization or free-text search
 * @route   GET /api/doctors
 * @access  Public
 */
const getDoctors = async (req, res) => {
  try {
    const { specialization, search, includeInactive } = req.query;

    const query = {};
    if (includeInactive !== 'true') query.isActive = true;
    if (specialization) {
      // Escape user input before it becomes a regex.
      query.specialization = new RegExp(specialization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const profiles = await DoctorProfile.find(query).populate('user', 'name email phone');

    let doctors = profiles
      .filter((p) => p.user) // skip profiles whose user was deleted
      .map((p) => ({
        id: p.user._id,
        profileId: p._id,
        name: p.user.name,
        email: p.user.email,
        phone: p.user.phone,
        specialization: p.specialization,
        slotDurationMins: p.slotDurationMins,
        roomNumber: p.roomNumber,
        bio: p.bio,
        workingHours: p.workingHours,
        isActive: p.isActive,
      }));

    if (search) {
      const needle = search.toLowerCase();
      doctors = doctors.filter(
        (d) => d.name.toLowerCase().includes(needle) || d.specialization.toLowerCase().includes(needle)
      );
    }

    return res.json({ success: true, count: doctors.length, doctors });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Single doctor profile with upcoming leave dates
 * @route   GET /api/doctors/:id
 * @access  Public
 */
const getDoctorById = async (req, res) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.params.id }).populate('user', 'name email phone');
    if (!profile || !profile.user) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found' });
    }

    const leaves = await DoctorLeave.find({
      doctor: req.params.id,
      status: 'ACTIVE',
      date: { $gte: todayInClinic() },
    })
      .select('date reason')
      .sort({ date: 1 });

    return res.json({
      success: true,
      doctor: {
        id: profile.user._id,
        profileId: profile._id,
        name: profile.user.name,
        email: profile.user.email,
        phone: profile.user.phone,
        specialization: profile.specialization,
        slotDurationMins: profile.slotDurationMins,
        roomNumber: profile.roomNumber,
        bio: profile.bio,
        workingHours: profile.workingHours,
        isActive: profile.isActive,
        leaves: leaves.map((l) => ({ date: l.date, reason: l.reason })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update working hours, slot duration, specialization, room, active flag
 * @route   PUT /api/doctors/:id
 * @access  Private (ADMIN, or the doctor themselves)
 */
const updateDoctorProfile = async (req, res) => {
  try {
    const doctorUserId = req.params.id;

    if (req.user.role === 'DOCTOR' && req.user.id !== doctorUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized to update another doctor profile' });
    }
    // Deactivating a doctor is an admin decision, not a doctor's.
    if (req.user.role === 'DOCTOR' && req.body.isActive !== undefined) {
      return res.status(403).json({ success: false, message: 'Only an administrator can change active status' });
    }

    const profile = await DoctorProfile.findOne({ user: doctorUserId });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found' });
    }

    const { specialization, slotDurationMins, roomNumber, bio, workingHours, isActive } = req.body;
    if (specialization !== undefined) profile.specialization = specialization;
    if (slotDurationMins !== undefined) profile.slotDurationMins = slotDurationMins;
    if (roomNumber !== undefined) profile.roomNumber = roomNumber;
    if (bio !== undefined) profile.bio = bio;
    if (workingHours !== undefined) profile.workingHours = workingHours;
    if (isActive !== undefined) profile.isActive = isActive;

    await profile.save();

    return res.json({ success: true, message: 'Doctor profile updated', profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Mark a doctor on leave and resolve every conflicting booking
 * @route   POST /api/doctors/:id/leave
 * @access  Private (ADMIN, or the doctor themselves)
 *
 * Cascade: record the leave, cancel each HELD/CONFIRMED appointment on that
 * date, remove its calendar event, and email both the patient and the doctor.
 * Notification failures are logged to the outbox and retried by the cron
 * worker - one dead mailbox must not abort the rest of the cascade.
 */
const markDoctorLeave = async (req, res) => {
  try {
    const doctorUserId = req.params.id;
    const { date, reason } = req.body;

    if (req.user.role === 'DOCTOR' && req.user.id !== doctorUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized to mark leave for another doctor' });
    }
    if (isPastDate(date)) {
      return res.status(400).json({ success: false, message: 'Cannot mark leave for a date in the past' });
    }

    const doctor = await User.findOne({ _id: doctorUserId, role: 'DOCTOR' }).select('name email');
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const leave = await DoctorLeave.findOneAndUpdate(
      { doctor: doctorUserId, date },
      { $set: { status: 'ACTIVE', reason } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const affected = await Appointment.find({
      doctor: doctorUserId,
      date,
      status: { $in: ['HELD', 'CONFIRMED'] },
    }).populate('patient', 'name email');

    const results = { cancelled: 0, notificationFailures: 0 };

    for (const appt of affected) {
      appt.status = 'CANCELLED_BY_DOCTOR';
      appt.cancellationReason = `Doctor on leave: ${reason}`;
      appt.holdExpiresAt = undefined;
      await appt.save();
      results.cancelled++;

      if (appt.googleEventId) {
        await deleteCalendarEvent(appt.googleEventId);
      }

      const mail = await sendCancellationEmail({
        patientEmail: appt.patient?.email,
        patientName: appt.patient?.name,
        doctorEmail: doctor.email,
        doctorName: doctor.name,
        date: appt.date,
        startTime: appt.startTime,
        reason: `Dr. ${doctor.name} is on leave on ${date} (${reason})`,
        cancelledBy: 'doctor leave',
        appointmentId: appt._id,
      });
      if (!mail.success) results.notificationFailures++;
    }

    console.log(`[Leave] Dr. ${doctor.name} on leave ${date}: ${results.cancelled} appointment(s) cancelled.`);

    return res.json({
      success: true,
      message:
        `Leave recorded for ${date}. ${results.cancelled} affected appointment(s) cancelled and patients notified.` +
        (results.notificationFailures
          ? ` ${results.notificationFailures} email(s) failed and were queued for retry.`
          : ''),
      leave,
      cancelledAppointmentsCount: results.cancelled,
      notificationFailures: results.notificationFailures,
    });
  } catch (error) {
    console.error('Mark Leave Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Withdraw a scheduled leave day
 * @route   DELETE /api/doctors/:id/leave
 * @access  Private (ADMIN, or the doctor themselves)
 *
 * Appointments already cancelled by the cascade are not resurrected - those
 * patients were told to rebook, and silently reinstating them would be worse
 * than leaving the slot free.
 */
const cancelDoctorLeave = async (req, res) => {
  try {
    const doctorUserId = req.params.id;
    const { date } = req.body;

    if (req.user.role === 'DOCTOR' && req.user.id !== doctorUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify leave for another doctor' });
    }

    const leave = await DoctorLeave.findOneAndUpdate(
      { doctor: doctorUserId, date, status: 'ACTIVE' },
      { $set: { status: 'CANCELLED' } },
      { new: true }
    );

    if (!leave) {
      return res.status(404).json({ success: false, message: `No active leave found for ${date}` });
    }

    return res.json({
      success: true,
      message: `Leave on ${date} withdrawn. Slots are open again. Previously cancelled patients were asked to rebook and are not restored automatically.`,
      leave,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Scheduled leave days for a doctor
 * @route   GET /api/doctors/:id/leave
 * @access  Private
 */
const getDoctorLeaves = async (req, res) => {
  try {
    const { includePast } = req.query;
    const query = { doctor: req.params.id, status: 'ACTIVE' };
    if (includePast !== 'true') query.date = { $gte: todayInClinic() };

    const leaves = await DoctorLeave.find(query).sort({ date: 1 });
    return res.json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createDoctor,
  getDoctors,
  getDoctorById,
  updateDoctorProfile,
  markDoctorLeave,
  cancelDoctorLeave,
  getDoctorLeaves,
};
