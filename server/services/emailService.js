const nodemailer = require('nodemailer');
const NotificationLog = require('../models/NotificationLog');

/**
 * Email dispatch with an outbox log.
 *
 * Every send writes a NotificationLog row first, then attempts delivery. A
 * failure leaves the row FAILED for the retry worker rather than throwing into
 * the request path - a booking must not fail because SMTP is down.
 *
 * With no SMTP credentials configured the transport degrades to console
 * logging and marks the row SENT (simulated), so the whole flow stays
 * demonstrable without a mail provider.
 */

let cachedTransporter;
let transporterResolved = false;

const createTransporter = () => {
  if (transporterResolved) return cachedTransporter;
  transporterResolved = true;

  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  const configured =
    SMTP_HOST && SMTP_USER && SMTP_PASS && !SMTP_PASS.startsWith('your_') && !SMTP_HOST.startsWith('your_');

  if (!configured) {
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return cachedTransporter;
};

const shell = (accent, body) => `
  <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; background:#f1f5f9; padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:${accent};height:6px;"></div>
      <div style="padding:28px;color:#0f172a;">
        ${body}
        <p style="color:#94a3b8;font-size:12px;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:16px;">
          CareSync &middot; Healthcare Appointment &amp; Follow-up Manager
        </p>
      </div>
    </div>
  </div>
`;

const detailRow = (label, value) =>
  `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:14px;">${label}</td>` +
  `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;">${value}</td></tr>`;

/**
 * Dispatch one email and record the outcome.
 * @param {object} opts
 * @param {NotificationLog} [opts.existingLog] Reuse this row (retry path) instead of inserting a new one.
 */
const sendEmail = async ({ type, recipientEmail, recipientRole, subject, htmlBody, appointmentId = null, existingLog = null }) => {
  if (!recipientEmail) {
    return { success: false, error: 'No recipient email supplied' };
  }

  let logEntry = existingLog;
  if (!logEntry) {
    logEntry = new NotificationLog({
      type,
      recipientEmail,
      recipientRole,
      subject,
      body: htmlBody,
      appointmentId,
      status: 'PENDING',
      attempts: 1,
    });
  }

  const transporter = createTransporter();

  if (!transporter) {
    console.log(
      `[Email:SIMULATED] ${type} -> ${recipientEmail} | "${subject}" ` +
        '(configure SMTP_HOST/SMTP_USER/SMTP_PASS to send for real)'
    );
    logEntry.status = 'SENT';
    if (!existingLog) await logEntry.save();
    return { success: true, simulated: true };
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"CareSync Clinic" <no-reply@caresync.com>',
      to: recipientEmail,
      subject,
      html: htmlBody,
    });
    logEntry.status = 'SENT';
    logEntry.lastError = '';
    if (!existingLog) await logEntry.save();
    return { success: true };
  } catch (error) {
    console.error(`[Email:FAILED] ${type} -> ${recipientEmail}: ${error.message}`);
    logEntry.status = 'FAILED';
    logEntry.lastError = error.message;
    if (!existingLog) await logEntry.save();
    return { success: false, error: error.message };
  }
};

// ------------------------------------------------------------- templates

/**
 * Booking confirmation. The assignment requires both sides to be told, so this
 * sends a patient-facing copy and a doctor-facing copy in one call.
 */
const sendBookingConfirmationEmail = async ({
  patientEmail,
  patientName,
  doctorEmail,
  doctorName,
  date,
  startTime,
  endTime,
  roomNumber,
  chiefComplaint,
  urgencyLevel,
  appointmentId,
  googleEventLink,
}) => {
  const patientBody = shell(
    '#0284c7',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">Your appointment is confirmed</h2>
    <p style="font-size:14px;color:#475569;">Dear <strong>${patientName}</strong>, your appointment has been scheduled.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      ${detailRow('Doctor', `Dr. ${doctorName}`)}
      ${detailRow('Date', date)}
      ${detailRow('Time', `${startTime} &ndash; ${endTime}`)}
      ${roomNumber ? detailRow('Room', roomNumber) : ''}
    </table>
    ${
      googleEventLink
        ? `<p><a href="${googleEventLink}" target="_blank" style="background:#0284c7;color:#fff;padding:11px 20px;text-decoration:none;border-radius:8px;display:inline-block;font-size:14px;font-weight:600;">View in Google Calendar</a></p>`
        : ''
    }
    <p style="font-size:13px;color:#64748b;">A calendar invitation has been sent to your email. You will receive medication reminders here after your visit.</p>
  `
  );

  const doctorBody = shell(
    '#4f46e5',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">New appointment booked</h2>
    <p style="font-size:14px;color:#475569;">Dear Dr. <strong>${doctorName}</strong>, a patient has booked a slot in your schedule.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      ${detailRow('Patient', patientName)}
      ${detailRow('Date', date)}
      ${detailRow('Time', `${startTime} &ndash; ${endTime}`)}
      ${urgencyLevel ? detailRow('AI urgency', urgencyLevel) : ''}
      ${chiefComplaint ? detailRow('Chief complaint', chiefComplaint) : ''}
    </table>
    <p style="font-size:13px;color:#64748b;">The full AI pre-visit summary and suggested questions are on your dashboard.</p>
  `
  );

  const [patientResult, doctorResult] = await Promise.all([
    sendEmail({
      type: 'BOOKING_CONFIRMATION',
      recipientEmail: patientEmail,
      recipientRole: 'PATIENT',
      subject: `Appointment confirmed with Dr. ${doctorName} on ${date}`,
      htmlBody: patientBody,
      appointmentId,
    }),
    doctorEmail
      ? sendEmail({
          type: 'BOOKING_CONFIRMATION',
          recipientEmail: doctorEmail,
          recipientRole: 'DOCTOR',
          subject: `New booking: ${patientName} on ${date} at ${startTime}`,
          htmlBody: doctorBody,
          appointmentId,
        })
      : Promise.resolve({ success: true, skipped: true }),
  ]);

  return { success: patientResult.success && doctorResult.success, patientResult, doctorResult };
};

/** Cancellation notice sent to both the patient and the doctor. */
const sendCancellationEmail = async ({
  patientEmail,
  patientName,
  doctorEmail,
  doctorName,
  date,
  startTime,
  reason,
  cancelledBy,
  appointmentId,
}) => {
  const reasonText = reason || 'Schedule adjustment';

  const patientBody = shell(
    '#dc2626',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">Appointment cancelled</h2>
    <p style="font-size:14px;color:#475569;">Dear <strong>${patientName}</strong>, your appointment with <strong>Dr. ${doctorName}</strong> on <strong>${date} at ${startTime}</strong> has been cancelled.</p>
    <p style="font-size:14px;"><strong>Reason:</strong> ${reasonText}</p>
    <p style="font-size:14px;color:#475569;">Please log in to your patient portal to book a new slot. Any calendar invitation for this appointment has been removed.</p>
  `
  );

  const doctorBody = shell(
    '#dc2626',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">Appointment cancelled</h2>
    <p style="font-size:14px;color:#475569;">Dear Dr. <strong>${doctorName}</strong>, the appointment with <strong>${patientName}</strong> on <strong>${date} at ${startTime}</strong> has been cancelled${cancelledBy ? ` (${cancelledBy})` : ''}.</p>
    <p style="font-size:14px;"><strong>Reason:</strong> ${reasonText}</p>
    <p style="font-size:14px;color:#475569;">This slot is now free for another patient to book.</p>
  `
  );

  const [patientResult, doctorResult] = await Promise.all([
    patientEmail
      ? sendEmail({
          type: 'CANCELLATION',
          recipientEmail: patientEmail,
          recipientRole: 'PATIENT',
          subject: `Appointment cancelled - ${date} at ${startTime}`,
          htmlBody: patientBody,
          appointmentId,
        })
      : Promise.resolve({ success: true, skipped: true }),
    doctorEmail
      ? sendEmail({
          type: 'CANCELLATION',
          recipientEmail: doctorEmail,
          recipientRole: 'DOCTOR',
          subject: `Cancelled: ${patientName} on ${date} at ${startTime}`,
          htmlBody: doctorBody,
          appointmentId,
        })
      : Promise.resolve({ success: true, skipped: true }),
  ]);

  return { success: patientResult.success && doctorResult.success, patientResult, doctorResult };
};

/** Reschedule notice sent to both parties. */
const sendRescheduleEmail = async ({
  patientEmail,
  patientName,
  doctorEmail,
  doctorName,
  oldDate,
  oldStartTime,
  newDate,
  newStartTime,
  newEndTime,
  appointmentId,
}) => {
  const body = (greeting, counterpart) =>
    shell(
      '#d97706',
      `
    <h2 style="margin:0 0 12px;font-size:20px;">Appointment rescheduled</h2>
    <p style="font-size:14px;color:#475569;">${greeting} the appointment with <strong>${counterpart}</strong> has been moved.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      ${detailRow('Previously', `${oldDate} at ${oldStartTime}`)}
      ${detailRow('Now', `${newDate} at ${newStartTime} &ndash; ${newEndTime}`)}
    </table>
    <p style="font-size:13px;color:#64748b;">Your Google Calendar entry has been updated automatically.</p>
  `
    );

  const [patientResult, doctorResult] = await Promise.all([
    patientEmail
      ? sendEmail({
          type: 'RESCHEDULE',
          recipientEmail: patientEmail,
          recipientRole: 'PATIENT',
          subject: `Appointment moved to ${newDate} at ${newStartTime}`,
          htmlBody: body(`Dear <strong>${patientName}</strong>,`, `Dr. ${doctorName}`),
          appointmentId,
        })
      : Promise.resolve({ success: true, skipped: true }),
    doctorEmail
      ? sendEmail({
          type: 'RESCHEDULE',
          recipientEmail: doctorEmail,
          recipientRole: 'DOCTOR',
          subject: `Rescheduled: ${patientName} now ${newDate} at ${newStartTime}`,
          htmlBody: body(`Dear Dr. <strong>${doctorName}</strong>,`, patientName),
          appointmentId,
        })
      : Promise.resolve({ success: true, skipped: true }),
  ]);

  return { success: patientResult.success && doctorResult.success, patientResult, doctorResult };
};

const sendMedicationReminderEmail = async ({
  patientEmail,
  patientName,
  medicineName,
  dosage,
  instructions,
  scheduledTime,
  appointmentId,
}) => {
  const htmlBody = shell(
    '#0284c7',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">Time for your medication</h2>
    <p style="font-size:14px;color:#475569;">Hello <strong>${patientName}</strong>, this is your ${scheduledTime ? `<strong>${scheduledTime}</strong> ` : ''}reminder.</p>
    <div style="background:#f0f9ff;padding:16px;border-left:4px solid #0284c7;border-radius:8px;margin:18px 0;">
      <div style="font-size:16px;font-weight:700;">${medicineName}${dosage ? ` &mdash; ${dosage}` : ''}</div>
      <div style="font-size:13px;color:#475569;margin-top:4px;">${instructions || 'Take as directed by your doctor'}</div>
    </div>
    <p style="font-size:13px;color:#64748b;">Complete the full course even if you start feeling better.</p>
  `
  );

  return sendEmail({
    type: 'MEDICATION_REMINDER',
    recipientEmail: patientEmail,
    recipientRole: 'PATIENT',
    subject: `Medication reminder: ${medicineName}`,
    htmlBody,
    appointmentId,
  });
};

const sendDoctorInviteEmail = async ({ doctorEmail, doctorName, tempPassword, loginUrl }) => {
  const htmlBody = shell(
    '#4f46e5',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">Welcome, Dr. ${doctorName}</h2>
    <p style="font-size:14px;color:#475569;">A clinic administrator has created your CareSync doctor account.</p>
    <div style="background:#f8fafc;padding:16px;border:1px solid #e2e8f0;border-radius:8px;margin:18px 0;font-size:14px;">
      <div style="margin:4px 0;"><strong>Email:</strong> ${doctorEmail}</div>
      <div style="margin:4px 0;"><strong>Temporary password:</strong> <code style="font-size:15px;color:#4f46e5;">${tempPassword}</code></div>
    </div>
    <p style="font-size:14px;color:#475569;">You will be asked to set your own password the first time you sign in.</p>
    <p><a href="${loginUrl}" style="background:#4f46e5;color:#fff;padding:11px 20px;text-decoration:none;border-radius:8px;display:inline-block;font-size:14px;font-weight:600;">Sign in to CareSync</a></p>
  `
  );

  return sendEmail({
    type: 'DOCTOR_INVITE',
    recipientEmail: doctorEmail,
    recipientRole: 'DOCTOR',
    subject: 'Your CareSync doctor account',
    htmlBody,
  });
};

module.exports = {
  sendEmail,
  sendBookingConfirmationEmail,
  sendCancellationEmail,
  sendRescheduleEmail,
  sendMedicationReminderEmail,
  sendDoctorInviteEmail,
};
