const { z } = require('zod');

/**
 * Zod request schemas.
 *
 * Each schema describes the whole request envelope ({ body, query, params }),
 * matching the shape the validate() middleware parses. Anything malformed is
 * rejected with a 400 listing the offending fields before a controller runs,
 * so no partially-valid payload ever reaches the database.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid MongoDB ObjectId');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'must be a real calendar date' });

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time in HH:mm format');

const email = z.string().trim().toLowerCase().email('must be a valid email address');

const password = z.string().min(6, 'must be at least 6 characters');

const dayOfWeek = z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

const workingHourEntry = z
  .object({
    dayOfWeek,
    startTime: timeOfDay.default('09:00'),
    endTime: timeOfDay.default('17:00'),
    isAvailable: z.boolean().default(true),
  })
  .refine((w) => w.startTime < w.endTime, {
    message: 'startTime must be earlier than endTime',
    path: ['startTime'],
  });

const prescriptionItem = z.object({
  medicineName: z.string().trim().min(1, 'medicine name is required').max(120),
  dosage: z.string().trim().min(1, 'dosage is required').max(60),
  frequencyPerDay: z.coerce.number().int().min(1).max(12).default(1),
  times: z.array(timeOfDay).max(12).default([]),
  durationDays: z.coerce.number().int().min(1).max(365).default(5),
  instructions: z.string().trim().max(300).optional().default(''),
});

// ------------------------------------------------------------------ auth

const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'must be at least 2 characters').max(80),
    email,
    password,
    phone: z.string().trim().max(20).optional().default(''),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(1, 'is required'),
  }),
});

const setPasswordSchema = z.object({
  body: z.object({
    newPassword: password,
  }),
});

// --------------------------------------------------------------- doctors

const createDoctorSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80),
    email,
    specialization: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(20).optional().default(''),
    slotDurationMins: z.coerce.number().int().min(15).max(120).optional().default(30),
    roomNumber: z.string().trim().max(60).optional().default('Consultation Room 1'),
    bio: z.string().trim().max(600).optional().default(''),
    workingHours: z.array(workingHourEntry).max(7).optional(),
  }),
});

const updateDoctorSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      specialization: z.string().trim().min(2).max(80).optional(),
      slotDurationMins: z.coerce.number().int().min(15).max(120).optional(),
      roomNumber: z.string().trim().max(60).optional(),
      bio: z.string().trim().max(600).optional(),
      isActive: z.boolean().optional(),
      workingHours: z.array(workingHourEntry).max(7).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'at least one field must be supplied' }),
});

const markLeaveSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    date: isoDate,
    reason: z.string().trim().max(200).optional().default('Scheduled Leave'),
  }),
});

const cancelLeaveSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ date: isoDate }),
});

const doctorIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// ---------------------------------------------------------- appointments

const availableSlotsSchema = z.object({
  query: z.object({
    doctorId: objectId,
    date: isoDate,
  }),
});

const holdSlotSchema = z.object({
  body: z.object({
    doctorId: objectId,
    date: isoDate,
    startTime: timeOfDay,
    endTime: timeOfDay,
  }),
});

const confirmBookingSchema = z.object({
  body: z.object({
    appointmentId: objectId,
    symptomsText: z
      .string()
      .trim()
      .min(10, 'please describe symptoms in at least 10 characters')
      .max(2000, 'must be under 2000 characters'),
  }),
});

const consultationSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    clinicalNotes: z.string().trim().min(10, 'must be at least 10 characters').max(5000),
    prescription: z.array(prescriptionItem).max(20).optional().default([]),
  }),
});

const cancelAppointmentSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    reason: z.string().trim().max(300).optional().default(''),
  }),
});

const rescheduleSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    newDate: isoDate,
    newStartTime: timeOfDay,
    newEndTime: timeOfDay,
  }),
});

const appointmentIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

module.exports = {
  registerSchema,
  loginSchema,
  setPasswordSchema,
  createDoctorSchema,
  updateDoctorSchema,
  markLeaveSchema,
  cancelLeaveSchema,
  doctorIdParamSchema,
  availableSlotsSchema,
  holdSlotSchema,
  confirmBookingSchema,
  consultationSchema,
  cancelAppointmentSchema,
  rescheduleSchema,
  appointmentIdParamSchema,
  // reusable primitives, exported for tests
  objectId,
  isoDate,
  timeOfDay,
};
