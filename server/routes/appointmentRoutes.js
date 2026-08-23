const express = require('express');
const router = express.Router();

const {
  getAvailableSlots,
  holdSlot,
  confirmBooking,
  getAppointments,
  getAppointmentById,
  submitPostVisitConsultation,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentStats,
} = require('../controllers/appointmentController');
const { protect, authorize, requirePasswordSet } = require('../middleware/authMiddleware');
const { llmLimiter, bookingLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validateRequest');
const {
  availableSlotsSchema,
  holdSlotSchema,
  confirmBookingSchema,
  consultationSchema,
  cancelAppointmentSchema,
  rescheduleSchema,
  appointmentIdParamSchema,
} = require('../validators/schemas');

router.get('/available-slots', validate(availableSlotsSchema), getAvailableSlots);

// Static path must be declared before '/:id' or it is swallowed as an id.
router.get('/stats', protect, authorize('ADMIN'), getAppointmentStats);

router.post(
  '/hold',
  protect,
  requirePasswordSet,
  authorize('PATIENT'),
  bookingLimiter,
  validate(holdSlotSchema),
  holdSlot
);
router.post(
  '/confirm',
  protect,
  requirePasswordSet,
  authorize('PATIENT'),
  llmLimiter,
  validate(confirmBookingSchema),
  confirmBooking
);

router.get('/', protect, getAppointments);
router.get('/:id', protect, validate(appointmentIdParamSchema), getAppointmentById);

router.post(
  '/:id/consultation',
  protect,
  requirePasswordSet,
  authorize('DOCTOR', 'ADMIN'),
  llmLimiter,
  validate(consultationSchema),
  submitPostVisitConsultation
);
router.put('/:id/cancel', protect, requirePasswordSet, validate(cancelAppointmentSchema), cancelAppointment);
router.put('/:id/reschedule', protect, requirePasswordSet, validate(rescheduleSchema), rescheduleAppointment);

module.exports = router;
